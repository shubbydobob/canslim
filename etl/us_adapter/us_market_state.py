"""
US 지수(S&P500 / Nasdaq) → market_state 시딩 (오닐 방식)

KR market_state_seeder.py 재사용:
  - 오닐 시그널·M점수·upsert 로직(_compute_oneil_signals / _upsert_states)은 시장 무관 → import 재사용.
  - 지수 OHLCV 소스만 pykrx → yfinance(^GSPC / ^IXIC)로 교체.

벤치마크 매핑(market_state.market 컬럼 값):
  SPX → ^GSPC (S&P 500)   ← M-게이트 기본 벤치마크(UsMarketDataAdapter가 조회)
  NDX → ^IXIC (Nasdaq Composite)
"""
import logging
import os
from datetime import datetime

os.environ.setdefault("PYTHONUTF8", "1")

import pandas as pd
import yfinance as yf

# 오닐 계산·적재 로직은 KR 시더에서 그대로 재사용(시장 무관)
from ..kr_adapter.market_state_seeder import _compute_oneil_signals, _upsert_states

logger = logging.getLogger(__name__)

_PROXY_TICKER = {
    "SPX": "^GSPC",
    "NDX": "^IXIC",
}

_START_DATE = "20210101"


def _fetch_index_ohlcv(proxy_ticker: str, start: str, end: str) -> pd.DataFrame:
    """yfinance 지수 OHLCV → [close, volume] DataFrame (KR _fetch_index_ohlcv와 동일 형태)."""
    df = yf.Ticker(proxy_ticker).history(
        start=datetime.strptime(start, "%Y%m%d").strftime("%Y-%m-%d"),
        end=datetime.strptime(end, "%Y%m%d").strftime("%Y-%m-%d"),
        auto_adjust=False,
        actions=False,
    )
    if df is None or df.empty:
        return pd.DataFrame()

    result = df[["Close", "Volume"]].copy()
    result.columns = ["close", "volume"]
    result.index = pd.to_datetime(result.index).tz_localize(None)
    result = result[~result.index.duplicated(keep="last")].sort_index()
    return result


def seed(market: str = "SPX", start_date: str = _START_DATE, end_date: str = None) -> None:
    """지정 US 벤치마크 market_state 시딩."""
    if end_date is None:
        end_date = datetime.today().strftime("%Y%m%d")

    proxy = _PROXY_TICKER.get(market)
    if not proxy:
        raise ValueError(f"지원하지 않는 US 벤치마크: {market}. 지원: {list(_PROXY_TICKER)}")

    logger.info("[%s] 지수(%s) 데이터 로드 (%s ~ %s)...", market, proxy, start_date, end_date)
    df = _fetch_index_ohlcv(proxy, start_date, end_date)
    if df.empty:
        logger.warning("[%s] 지수 데이터 없음", market)
        return

    logger.info("[%s] 오닐 시그널 계산 중...", market)
    df = _compute_oneil_signals(df)

    # MA200 워밍업 이전 구간 제외(KR과 동일)
    df = df[df.index >= "2022-01-01"]

    count = _upsert_states(market, df)
    logger.info("[%s] market_state 적재 완료: %d건", market, count)


def seed_all(start_date: str = _START_DATE, end_date: str = None) -> None:
    for market in _PROXY_TICKER:
        seed(market, start_date=start_date, end_date=end_date)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    seed_all()
