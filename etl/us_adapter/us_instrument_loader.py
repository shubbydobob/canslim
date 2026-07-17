"""
US 종목 목록 → instruments 테이블 적재
데이터 소스: Wikipedia S&P 500 + Nasdaq-100 구성종목 (pandas.read_html)

MVP 유니버스: S&P 500 ∪ Nasdaq-100 (~550 고유). 추후 전체 US 상장으로 확장.

KR instrument_loader.py 미러:
  - market='US' 단일값(거래소 세분 NYSE/NASDAQ 미구분, MVP 단순화).
  - currency='USD', security_type='COMMON'.
  - shared/db_writer.upsert_instruments 재사용, ingestion_meta 멱등성.

티커 정규화:
  - Wikipedia는 'BRK.B' 형식 → yfinance/SEC는 'BRK-B'(dash) 형식.
    dot→dash로 통일 저장(가격·재무 로더가 이 티커로 조회).
  - total_shares: Wikipedia 미제공 → None(추후 yfinance로 보강). market_cap 파생은
    total_shares 필요하나 MVP 표시엔 비필수.

함정:
  - Wikipedia HTML 구조 변경 시 read_html 실패 가능 → 컬럼명 방어적 탐색.
  - read_html은 lxml 필요(requirements 추가).
  - PYTHONUTF8=1 권장.
"""
import os
import logging

os.environ.setdefault("PYTHONUTF8", "1")

import pandas as pd
from ..shared.db_writer import upsert_instruments
from ..shared.ingestion_meta import start_run, finish_run, fail_run

logger = logging.getLogger(__name__)

SOURCE_NAME = "WIKI_INSTRUMENTS_US"

_SP500_URL     = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
# Nasdaq-100: Wikipedia 구성종목 표는 현재 read_html로 추출 불가(렌더링 구조) →
# Slickcharts(안정적 Symbol/Company 표)를 1차 소스로 사용.
_NASDAQ100_URL = "https://www.slickcharts.com/nasdaq100"

# read_html은 User-Agent 없으면 403 가능 → pandas 4.x는 storage_options 지원.
_HEADERS = {"User-Agent": "Mozilla/5.0 (NEXTPICK ETL)"}


def _normalize_ticker(sym: str) -> str:
    """Wikipedia 'BRK.B' → yfinance/SEC 'BRK-B' 통일."""
    return str(sym).strip().upper().replace(".", "-")


def _pick_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    """컬럼명 후보 중 존재하는 것 반환(방어적)."""
    cols = {str(c).strip().lower(): c for c in df.columns}
    for cand in candidates:
        if cand.lower() in cols:
            return cols[cand.lower()]
    return None


def _read_wiki_tables(url: str) -> list[pd.DataFrame]:
    try:
        return pd.read_html(url, storage_options=_HEADERS)
    except TypeError:
        # 구버전 pandas: storage_options 미지원 → 헤더 없이 재시도
        return pd.read_html(url)


def _fetch_sp500() -> list[dict]:
    """S&P 500: Symbol, Security(name), GICS Sector."""
    tables = _read_wiki_tables(_SP500_URL)
    df = tables[0]
    sym_col    = _pick_col(df, ["Symbol", "Ticker"])
    name_col   = _pick_col(df, ["Security", "Company"])
    sector_col = _pick_col(df, ["GICS Sector", "Sector"])
    if sym_col is None:
        raise RuntimeError("S&P500 테이블에서 Symbol 컬럼을 찾지 못함")

    rows = []
    for _, r in df.iterrows():
        ticker = _normalize_ticker(r[sym_col])
        if not ticker:
            continue
        rows.append({
            "ticker": ticker,
            "name":   str(r[name_col]).strip() if name_col else ticker,
            "sector": str(r[sector_col]).strip() if sector_col else None,
        })
    return rows


def _fetch_nasdaq100() -> list[dict]:
    """Nasdaq-100 구성종목 (Slickcharts): Symbol, Company. 섹터 미제공(None).
    Symbol/Company 컬럼을 가진 ~100행 표를 탐색."""
    tables = _read_wiki_tables(_NASDAQ100_URL)
    rows = []
    for df in tables:
        sym_col  = _pick_col(df, ["Symbol", "Ticker"])
        name_col = _pick_col(df, ["Company", "Security", "Name"])
        if sym_col is None or name_col is None:
            continue
        if len(df) < 50:   # 구성종목 표(~100행)만
            continue
        for _, r in df.iterrows():
            ticker = _normalize_ticker(r[sym_col])
            if not ticker or ticker.lower() == "nan":
                continue
            rows.append({
                "ticker": ticker,
                "name":   str(r[name_col]).strip(),
                "sector": None,   # Slickcharts 섹터 미제공(S&P500 중복분은 그쪽 섹터 유지)
            })
        if rows:
            break
    return rows


def _build_universe() -> list[dict]:
    """S&P500 ∪ Nasdaq100, 티커 기준 중복 제거(S&P500 우선)."""
    by_ticker: dict[str, dict] = {}

    try:
        for row in _fetch_sp500():
            by_ticker.setdefault(row["ticker"], row)
        logger.info("S&P500 수집: %d 종목", len(by_ticker))
    except Exception as e:
        logger.warning("S&P500 수집 실패: %s", e)

    before = len(by_ticker)
    try:
        for row in _fetch_nasdaq100():
            by_ticker.setdefault(row["ticker"], row)
        logger.info("Nasdaq100 병합: +%d 신규 (누적 %d)", len(by_ticker) - before, len(by_ticker))
    except Exception as e:
        logger.warning("Nasdaq100 수집 실패: %s", e)

    return list(by_ticker.values())


def load(target_date=None, limit: int | None = None) -> None:
    """
    US 종목 목록 수집 및 적재.

    Args:
        limit: 디버그/로컬 검증용 상위 N 종목만 적재(기본 전량).
    """
    from datetime import date
    if target_date is None:
        target_date = date.today()

    run_id = start_run(SOURCE_NAME, target_date, market="US")
    if run_id is None:
        logger.info("이미 처리됨: %s %s, 스킵", SOURCE_NAME, target_date)
        return

    try:
        universe = _build_universe()
        if limit:
            universe = universe[:limit]

        if not universe:
            raise RuntimeError("US 유니버스가 비어있음(Wikipedia 소스 확인 필요)")

        rows = [{
            "ticker":        u["ticker"],
            "market":        "US",
            "name":          u["name"],
            "security_type": "COMMON",
            "listing_date":  None,
            "float_shares":  None,
            "total_shares":  None,   # Wikipedia 미제공 → 추후 yfinance 보강
            "sector":        u.get("sector"),
            "currency":      "USD",
        } for u in universe]

        inserted, updated = upsert_instruments(rows)
        logger.info("US 종목 적재 완료: 신규 %d, 갱신 %d (전체 %d)", inserted, updated, len(rows))
        finish_run(SOURCE_NAME, target_date, rows_inserted=inserted, rows_updated=updated)

    except Exception as e:
        logger.exception("US 종목 적재 실패")
        fail_run(SOURCE_NAME, target_date, str(e))
        raise


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="상위 N 종목만 적재(디버그)")
    args = parser.parse_args()
    load(limit=args.limit)
