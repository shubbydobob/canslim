"""
KOSPI/KOSDAQ 지수 → market_state 시딩 (단순 버전)

Phase 판정 규칙 (E2E 검증용 거친 버전):
  close_adj > MA200  AND  MA50 > MA200  → BULL
  close_adj > MA200  AND  MA50 <= MA200 → CORRECTION
  close_adj <= MA200                    → BEAR

trend_direction:
  MA50 > MA200  → UP
  MA50 < MA200  → DOWN
  else          → SIDEWAYS

distribution_day_count: 0 (정밀화는 E2E 이후)
rally_day_count:        0

주의: KOSPI 지수 pykrx ticker = "1001", KOSDAQ = "2001"
"""
import logging
import os
from datetime import date, datetime

os.environ.setdefault("PYTHONUTF8", "1")

import time
import pandas as pd
from pykrx import stock
from sqlalchemy import text
from ..shared.db_writer import get_session

logger = logging.getLogger(__name__)

# pykrx get_index_ohlcv_by_date는 IndexTicker 내부 버그로 동작 불가.
# ETF 프록시로 대체: get_market_ohlcv_by_date는 정상 동작.
#   KOSPI  프록시: 069500 (KODEX 200    — KOSPI 200 추종)
#   KOSDAQ 프록시: 229200 (KODEX 코스닥150 — KOSDAQ 150 추종)
_PROXY_TICKER = {
    "KOSPI":  "069500",
    "KOSDAQ": "229200",
}

_START_DATE = "20210101"  # MA200 계산에 2022분 필요하므로 여유있게 시작


def _fetch_index_ohlcv(proxy_ticker: str, start: str, end: str,
                       delay_sec: float = 0.5) -> pd.DataFrame:
    """
    ETF 프록시 가격으로 시장 방향 근사.
    get_market_ohlcv_by_date 연도별 분할 호출.
    """
    start_year = int(start[:4])
    end_year   = int(end[:4])
    frames = []

    for year in range(start_year, end_year + 1):
        y_start = f"{year}0101"
        y_end   = f"{year}1231" if year < end_year else end
        try:
            df = stock.get_market_ohlcv_by_date(y_start, y_end, proxy_ticker)
            if df is not None and not df.empty:
                frames.append(df)
        except Exception as e:
            logger.warning("프록시 %s %d년 조회 실패: %s", proxy_ticker, year, e)
        time.sleep(delay_sec)

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames)
    combined.index = pd.to_datetime(combined.index)
    combined = combined[~combined.index.duplicated(keep="last")]
    combined = combined.sort_index()

    # 종가 컬럼 추출 (pykrx 한글 컬럼명 처리)
    close_col = next(
        (c for c in combined.columns
         if "종가" in str(c) or str(c).lower() == "close"),
        combined.columns[-1]   # fallback: 마지막 컬럼 (pykrx 기본 순서상 종가)
    )
    combined = combined.rename(columns={close_col: "close"})
    return combined[["close"]].copy()


def _compute_phase(close: float, ma50: float, ma200: float) -> str:
    if pd.isna(ma200):
        return "UNKNOWN"
    if close > ma200:
        return "BULL" if (not pd.isna(ma50) and ma50 > ma200) else "CORRECTION"
    return "BEAR"


def _compute_trend(ma50: float, ma200: float) -> str:
    if pd.isna(ma50) or pd.isna(ma200):
        return "SIDEWAYS"
    if ma50 > ma200 * 1.002:
        return "UP"
    if ma50 < ma200 * 0.998:
        return "DOWN"
    return "SIDEWAYS"


def _upsert_states(market: str, df: pd.DataFrame) -> int:
    """market_state 배치 upsert. 이미 있으면 갱신."""
    sql = text("""
        INSERT INTO market_state (
            market, state_date, index_close, index_close_adj,
            ma_50d, ma_200d,
            distribution_day_count, distribution_day_today, rally_day_count,
            trend_direction, market_phase, prev_phase
        ) VALUES (
            :market, :state_date, :close, :close,
            :ma50, :ma200,
            0, FALSE, 0,
            :trend, :phase, :prev_phase
        )
        ON CONFLICT (market, state_date) DO UPDATE SET
            index_close       = EXCLUDED.index_close,
            index_close_adj   = EXCLUDED.index_close_adj,
            ma_50d            = EXCLUDED.ma_50d,
            ma_200d           = EXCLUDED.ma_200d,
            trend_direction   = EXCLUDED.trend_direction,
            market_phase      = EXCLUDED.market_phase,
            prev_phase        = EXCLUDED.prev_phase
    """)

    count = 0
    with get_session() as session:
        prev_phase = None
        for idx_date, row in df.iterrows():
            if pd.isna(row["close"]):
                continue
            state_date = idx_date.date() if hasattr(idx_date, "date") else idx_date
            phase = row["phase"]
            session.execute(sql, {
                "market":      market,
                "state_date":  state_date,
                "close":       float(row["close"]),
                "ma50":        None if pd.isna(row["ma50"])  else float(row["ma50"]),
                "ma200":       None if pd.isna(row["ma200"]) else float(row["ma200"]),
                "trend":       row["trend"],
                "phase":       phase,
                "prev_phase":  prev_phase,
            })
            prev_phase = phase
            count += 1
    return count


def seed(market: str = "KOSPI", start_date: str = _START_DATE,
         end_date: str = None) -> None:
    """지정 시장 market_state 시딩."""
    if end_date is None:
        end_date = datetime.today().strftime("%Y%m%d")

    proxy = _PROXY_TICKER.get(market)
    if not proxy:
        raise ValueError(f"지원하지 않는 시장: {market}. 지원: {list(_PROXY_TICKER)}")

    logger.info("[%s] 프록시(%s) 데이터 로드 (%s ~ %s)...", market, proxy, start_date, end_date)
    df = _fetch_index_ohlcv(proxy, start_date, end_date)
    if df.empty:
        logger.warning("[%s] 지수 데이터 없음", market)
        return

    df["ma50"]  = df["close"].rolling(50,  min_periods=1).mean()
    df["ma200"] = df["close"].rolling(200, min_periods=1).mean()
    # min_periods=200 이전은 UNKNOWN 방지: 200 미만은 NaN 유지
    df["ma200"] = df["close"].rolling(200, min_periods=200).mean()

    df["phase"] = df.apply(
        lambda r: _compute_phase(r["close"], r["ma50"], r["ma200"]), axis=1)
    df["trend"] = df.apply(
        lambda r: _compute_trend(r["ma50"], r["ma200"]), axis=1)

    # 2022-01-01 이후만 적재 (이전은 MA200 워밍업용)
    df = df[df.index >= "2022-01-01"]

    count = _upsert_states(market, df)
    logger.info("[%s] market_state 적재 완료: %d건", market, count)


def seed_all() -> None:
    """KOSPI + KOSDAQ 모두 시딩."""
    for market in _PROXY_TICKER:
        seed(market)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    seed_all()
