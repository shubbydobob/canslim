"""
DART 재무제표 → financials 테이블 적재

설계:
  - 연간(11011) + 분기(11013/11012/11014) 보고서 수집
  - CFS(연결)·OFS(별도) 한 번에 수집 (DART API가 양쪽 반환)
  - fiscal_quarter=4 for 연간 (NULL 방지 → UNIQUE constraint 동작)
  - 종목별 ingestion_meta resume: source=DART_FIN_KR_{ticker}, target=오늘
  - DART 일일 한도 10,000건. 중단 후 재실행 시 SUCCESS 종목 스킵.

보고서 코드 → DB 매핑:
  11013 (Q1) : period_type=QUARTER, fiscal_quarter=1, is_cumulative=True
  11012 (H1) : period_type=QUARTER, fiscal_quarter=2, is_cumulative=True
  11014 (9M) : period_type=QUARTER, fiscal_quarter=3, is_cumulative=True
  11011 (연간): period_type=ANNUAL,  fiscal_quarter=4, is_cumulative=False
"""
import os
import logging
from datetime import date
from calendar import monthrange
from typing import Optional

os.environ.setdefault("PYTHONUTF8", "1")

from ..shared.dart_client import download_corp_codes, fetch_financial_statement, extract_is_accounts
from ..shared.db_writer import get_all_active_security_ids, upsert_financials, get_session
from ..shared.ingestion_meta import start_run, finish_run, fail_run
from sqlalchemy import text

logger = logging.getLogger(__name__)

SOURCE_PREFIX = "DART_FIN_KR_"

# (reprt_code, period_type, fiscal_quarter, is_cumulative)
_REPORT_SCHEDULE = [
    ("11013", "QUARTER", 1, True),   # Q1 — 3개월 누적
    ("11012", "QUARTER", 2, True),   # H1 — 6개월 누적
    ("11014", "QUARTER", 3, True),   # 9M — 9개월 누적
    ("11011", "ANNUAL",  4, False),  # 연간 — 12개월 (fiscal_quarter=4, NULL 방지)
]

_FETCH_YEARS = [2022, 2023, 2024, 2025]

_QUARTER_END = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}


def _period_end_date(fiscal_year: int, fiscal_quarter: int) -> date:
    month, day = _QUARTER_END[fiscal_quarter]
    last_day = monthrange(fiscal_year, month)[1]
    return date(fiscal_year, month, min(day, last_day))


def _get_total_shares(security_id: int) -> Optional[int]:
    """instruments.total_shares 조회 (EPS 근사 계산용)."""
    with get_session() as session:
        row = session.execute(
            text("SELECT total_shares FROM instruments WHERE id = :id"),
            {"id": security_id},
        ).fetchone()
    return int(row.total_shares) if row and row.total_shares else None


def _calc_eps(net_income: Optional[float], total_shares: Optional[int]) -> Optional[float]:
    """EPS 근사: net_income / total_shares. DART API가 EPS 미제공으로 사용."""
    if net_income is None or not total_shares or total_shares <= 0:
        return None
    return net_income / total_shares


def _build_rows(
    security_id: int,
    items: list[dict],
    fiscal_year: int,
    reprt_code: str,
    period_type: str,
    fiscal_quarter: int,
    is_cumulative: bool,
    total_shares: Optional[int] = None,
) -> list[dict]:
    """CFS·OFS 각각 추출하여 row 리스트 반환.

    EPS: DART fnlttSinglAcnt 미제공 → net_income / total_shares 근사.
    """
    rows = []
    for fs_div, is_consolidated in (("CFS", True), ("OFS", False)):
        accts = extract_is_accounts(items, fs_div)
        if all(v is None for v in accts.values()):
            continue
        eps = accts["eps"] or _calc_eps(accts["net_income"], total_shares)
        rows.append({
            "security_id":      security_id,
            "period_type":      period_type,
            "fiscal_year":      fiscal_year,
            "fiscal_quarter":   fiscal_quarter,
            "period_end_date":  _period_end_date(fiscal_year, fiscal_quarter),
            "report_date":      None,
            "revenue":          accts["revenue"],
            "operating_income": accts["operating_income"],
            "net_income":       accts["net_income"],
            "eps":              eps,
            "shares_diluted":   total_shares,
            "roe":              None,
            "is_cumulative":    is_cumulative,
            "is_consolidated":  is_consolidated,
            "currency":         "KRW",
            "data_source":      f"DART_{reprt_code}",
        })
    return rows


def load(target_date: date = None, delay_sec: float = 0.35) -> None:
    """
    전 종목 DART 재무 데이터 수집 및 적재. Resume 가능.

    DART 일일 한도 고려:
      2558종목 × 4보고서 × 4년 = 41,000건. 여러 날에 걸쳐 완료됨.
      매일 재실행 시 SUCCESS 종목 스킵 → 자동으로 이어서 수집.
    """
    if target_date is None:
        target_date = date.today()

    logger.info("DART corp_code 매핑 로드...")
    corp_map = download_corp_codes()   # {ticker: corp_code}

    securities = (
        get_all_active_security_ids("KOSPI") +
        get_all_active_security_ids("KOSDAQ")
    )
    total = len(securities)
    logger.info("DART 재무 수집 시작: %d 종목", total)

    done = skipped = failed = empty = 0

    for idx, (security_id, ticker) in enumerate(securities, 1):
        source = f"{SOURCE_PREFIX}{ticker}"
        run_id = start_run(source, target_date, market="KR")
        if run_id is None:
            skipped += 1
            continue

        corp_code = corp_map.get(ticker)
        if not corp_code:
            logger.debug("[%d/%d] %s corp_code 없음 (비상장·매핑 누락)", idx, total, ticker)
            fail_run(source, target_date, "corp_code not found")
            failed += 1
            continue

        total_shares = _get_total_shares(security_id)
        all_rows = []
        try:
            for reprt_code, period_type, fiscal_quarter, is_cum in _REPORT_SCHEDULE:
                for year in _FETCH_YEARS:
                    items = fetch_financial_statement(
                        corp_code, year, reprt_code, delay_sec=delay_sec
                    )
                    if not items:
                        empty += 1
                        continue
                    rows = _build_rows(
                        security_id, items, year,
                        reprt_code, period_type, fiscal_quarter, is_cum,
                        total_shares=total_shares,
                    )
                    all_rows.extend(rows)

            ins, upd = upsert_financials(all_rows)
            finish_run(source, target_date, rows_inserted=ins, rows_updated=upd)
            done += 1

        except Exception as e:
            logger.warning("[%d/%d] %s 실패: %s", idx, total, ticker, e)
            fail_run(source, target_date, str(e))
            failed += 1

        if idx % 50 == 0:
            logger.info(
                "[%d/%d] 완료 %d / 스킵 %d / 빈응답 %d / 실패 %d",
                idx, total, done, skipped, empty, failed,
            )

    logger.info(
        "DART 수집 완료 — 완료 %d / 스킵(기완료) %d / 빈응답 %d / 실패 %d",
        done, skipped, empty, failed,
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    load()
