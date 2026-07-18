"""
US 종목 시가총액·거래소 보강 로더 (yfinance)

목적:
  1. instruments.total_shares 적재 → marketCap 파생(close_adj × total_shares) 활성화.
     us_instrument_loader는 Wikipedia/Slickcharts라 shares 미제공 → 여기서 보강.
  2. instruments.exchange 적재(KIS EXCD: NAS/NYS/AMS) → US 실시간 시세 TR 조회에 필요.

소스: yfinance Ticker.info (sharesOutstanding, floatShares, exchange).

실행:
  python -m etl.us_adapter.us_shares_loader            # 전량
  python -m etl.us_adapter.us_shares_loader --limit 10 # 디버그

빈도: 월 1회(us_run_daily 종목 갱신과 함께). shares는 자주 안 변함.

함정:
  - yfinance .info는 종목당 네트워크 왕복 → 518종목 수 분 소요. 종목별 try/except 비치명적.
  - Yahoo 레이트리밋 방지 위해 소량 슬립.
  - 신주발행/분할로 shares 변동 → COALESCE 아닌 최신값 우선(update_instrument_market_data는
    NULL만 보존하고 값이 있으면 갱신).
"""
import os
import time
import logging

os.environ.setdefault("PYTHONUTF8", "1")

from ..shared.db_writer import get_all_active_security_ids, update_instrument_market_data

logger = logging.getLogger(__name__)

# yfinance 거래소 코드 → KIS 해외주식 EXCD 매핑.
# KIS EXCD: NAS(나스닥)/NYS(뉴욕)/AMS(아멕스·NYSE American).
_EXCD_MAP = {
    "NMS": "NAS", "NGM": "NAS", "NCM": "NAS", "NSC": "NAS",
    "NAS": "NAS", "NASDAQ": "NAS", "NASDAQGS": "NAS", "NASDAQGM": "NAS", "NASDAQCM": "NAS",
    "NYQ": "NYS", "NYS": "NYS", "NYSE": "NYS",
    "ASE": "AMS", "AMS": "AMS", "AMEX": "AMS", "PCX": "AMS", "ARCA": "AMS",
    "NYSEARCA": "AMS", "BATS": "AMS",
}


def _to_excd(yf_exchange: str | None) -> str | None:
    if not yf_exchange:
        return None
    return _EXCD_MAP.get(str(yf_exchange).strip().upper())


def _fetch_one(ticker: str) -> dict:
    """yfinance로 단일 종목의 shares/exchange 조회. 실패 시 빈 dict."""
    import yfinance as yf
    try:
        info = yf.Ticker(ticker).info or {}
    except Exception as e:
        logger.warning("yfinance info 실패 %s: %s", ticker, e)
        return {}

    total = info.get("sharesOutstanding")
    flt = info.get("floatShares")
    excd = _to_excd(info.get("exchange"))
    return {
        "total_shares": int(total) if total else None,
        "float_shares": int(flt) if flt else None,
        "exchange": excd,
    }


def load(limit: int | None = None, sleep: float = 0.15) -> int:
    """US 활성 종목의 total_shares/float_shares/exchange를 yfinance로 보강."""
    universe = get_all_active_security_ids("US")
    if limit:
        universe = universe[:limit]
    if not universe:
        logger.warning("US 활성 종목 없음 — 종목 로더 선행 필요")
        return 0

    logger.info("US shares/exchange 보강 시작: %d 종목", len(universe))
    rows: list[dict] = []
    ok_shares = ok_excd = 0
    for i, (sid, ticker) in enumerate(universe, 1):
        data = _fetch_one(ticker)
        if not data:
            continue
        if data.get("total_shares"):
            ok_shares += 1
        if data.get("exchange"):
            ok_excd += 1
        rows.append({"id": sid, **data})
        if i % 50 == 0:
            logger.info("  진행 %d/%d (shares=%d, excd=%d)", i, len(universe), ok_shares, ok_excd)
        if sleep:
            time.sleep(sleep)

    updated = update_instrument_market_data(rows)
    logger.info("US shares/exchange 보강 완료: %d행 갱신 (shares %d, exchange %d)",
                updated, ok_shares, ok_excd)
    return updated


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="상위 N 종목만(디버그)")
    parser.add_argument("--sleep", type=float, default=0.15, help="종목간 슬립(초)")
    args = parser.parse_args()
    load(limit=args.limit, sleep=args.sleep)
