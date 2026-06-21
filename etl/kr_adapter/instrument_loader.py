"""
KR 종목 목록 → instruments 테이블 적재
데이터 소스: FinanceDataReader (pykrx get_market_ticker_list 대체)
  - pykrx 1.0.51의 get_market_ticker_list는 KRX 인증 변경으로 HTTP 400
  - FinanceDataReader.StockListing()은 동일 데이터를 인증 없이 제공

security_type 분류 규칙 (우선순위 순):
  1. 종목명에 '스팩'/'SPAC' → SPAC
  2. 종목명에 '리츠' → REIT
  3. 종목명에 'ETF' → ETF
  4. 종목명에 'ETN' → ETN
  5. Code 끝자리 '5' 또는 'K' → PREFERRED
  6. Code 끝자리 '0' → COMMON
  7. 그 외 → OTHER

instruments에 적재 대상: COMMON만 (기본값).
REIT는 향후 별도 스크리너 시 include_reit=True로 확장 가능.

함정 기록:
  - KOSDAQ 스팩 코드 중 '0072Z0' 등 특수 형식은 이름 기반 필터가 우선이므로 정상 처리.
  - float_shares = total_shares (Stocks 컬럼)로 근사. Phase 3에서 개선.
  - FDR은 상장일(listing_date) 미제공.
"""
import os
import logging
import re

os.environ.setdefault("PYTHONUTF8", "1")

import FinanceDataReader as fdr
from ..shared.db_writer import upsert_instruments
from ..shared.ingestion_meta import start_run, finish_run, fail_run

logger = logging.getLogger(__name__)

SOURCE_NAME = "FDR_INSTRUMENTS_KR"

# 보통주로 적재할 security_type 목록 (기본)
LOAD_TYPES = {"COMMON"}

_SPAC_PATTERN = re.compile(r'스팩|SPAC', re.IGNORECASE)
_REIT_PATTERN = re.compile(r'리츠')
_ETF_PATTERN  = re.compile(r'ETF',  re.IGNORECASE)
_ETN_PATTERN  = re.compile(r'ETN',  re.IGNORECASE)


def classify_security_type(code: str, name: str) -> str:
    """종목 코드와 이름으로 security_type 결정."""
    # 이름 기반 (코드보다 우선)
    if _SPAC_PATTERN.search(name):
        return "SPAC"
    if _REIT_PATTERN.search(name):
        return "REIT"
    if _ETF_PATTERN.search(name):
        return "ETF"
    if _ETN_PATTERN.search(name):
        return "ETN"

    # 코드 끝자리 기반
    if code and len(code) >= 1:
        suffix = code[-1]
        if suffix in ("5", "K"):
            return "PREFERRED"
        if suffix == "0":
            return "COMMON"

    return "OTHER"


def _normalize_market(row: dict) -> str:
    market_id = str(row.get("MarketId", "")).upper()
    market    = str(row.get("Market",   "")).upper()
    if market_id == "STK" or market == "KOSPI":
        return "KOSPI"
    if market_id == "KSQ" or market == "KOSDAQ":
        return "KOSDAQ"
    return market


def load(target_date=None, load_types: set = LOAD_TYPES) -> None:
    """
    KR 종목 목록 수집 및 적재.

    Args:
        load_types: 적재할 security_type 집합. 기본 {"COMMON"}.
                    REIT 포함 시 {"COMMON", "REIT"} 전달.
    """
    from datetime import date
    if target_date is None:
        target_date = date.today()

    run_id = start_run(SOURCE_NAME, target_date, market="KR")
    if run_id is None:
        logger.info("이미 처리됨: %s %s, 스킵", SOURCE_NAME, target_date)
        return

    try:
        logger.info("FinanceDataReader KOSPI/KOSDAQ 종목 목록 수집 시작")

        kospi_df  = fdr.StockListing("KOSPI")
        kosdaq_df = fdr.StockListing("KOSDAQ")

        total_seen = skipped = 0
        rows = []

        for df in [kospi_df, kosdaq_df]:
            for _, row in df.iterrows():
                ticker = str(row["Code"]).strip()
                name   = str(row["Name"]).strip()
                total_seen += 1

                # 종목 코드 기본 유효성 (비어있거나 6자리 미만 제외)
                if not ticker or len(ticker) < 6:
                    skipped += 1
                    continue

                security_type = classify_security_type(ticker, name)

                if security_type not in load_types:
                    skipped += 1
                    logger.debug("스킵 [%s] %s %s", security_type, ticker, name)
                    continue

                market       = _normalize_market(row.to_dict())
                total_shares = int(row["Stocks"]) if row.get("Stocks") and row["Stocks"] > 0 else None

                rows.append({
                    "ticker":        ticker,
                    "market":        market,
                    "name":          name,
                    "security_type": security_type,
                    "listing_date":  None,
                    "float_shares":  total_shares,   # 근사값
                    "total_shares":  total_shares,
                    "sector":        None,
                    "currency":      "KRW",
                })

        logger.info(
            "분류 완료: 전체 %d → 적재 대상 %d, 스킵 %d (유형: %s)",
            total_seen, len(rows), skipped, load_types
        )

        inserted, updated = upsert_instruments(rows)
        logger.info("종목 적재 완료: 신규 %d, 갱신 %d", inserted, updated)
        finish_run(SOURCE_NAME, target_date,
                   rows_inserted=inserted, rows_updated=updated)

    except Exception as e:
        logger.exception("종목 적재 실패")
        fail_run(SOURCE_NAME, target_date, str(e))
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    load()
