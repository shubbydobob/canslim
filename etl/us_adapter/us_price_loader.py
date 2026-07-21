"""
US 일별 주가 → price_daily 적재
데이터 소스: yfinance (NYSE/NASDAQ 캘린더 자동)

KR price_loader.py 미러:
  - close = 원종가(Close), close_adj = 수정종가(Adj Close).
    yfinance auto_adjust=False → Close(원본) + 'Adj Close'(분할·배당 조정) 둘 다 제공.
    52주 고점 계산이 close_adj 기준이라 조정가 매핑 중요.
  - turnover = close × volume 근사(yfinance 거래대금 미제공).
  - 백필: 종목별 ingestion_meta(source=YF_PRICE_US_{ticker}, target=end_date) resume.
  - load_daily: 당일 배치.

함정:
  - yfinance end는 배타적(exclusive) → to_date + 1일로 조회.
  - 티커는 dash 형식(BRK-B). instruments.ticker와 일치(us_instrument_loader가 정규화).
  - 비공식 API → 과도 병렬/요청 시 rate limit. 요청 간 딜레이 유지.
  - 신규상장/상폐 구간은 빈 응답 → 정상 스킵.
"""
import os
import time
import logging
from datetime import date, timedelta

os.environ.setdefault("PYTHONUTF8", "1")

import yfinance as yf
from ..shared.db_writer import get_all_active_security_ids, upsert_price_daily
from ..shared.ingestion_meta import start_run, finish_run, fail_run

logger = logging.getLogger(__name__)

SOURCE_DAILY           = "YF_PRICE_US"
SOURCE_BACKFILL_PREFIX = "YF_PRICE_US_"   # + ticker


def _fetch_ohlcv(ticker: str, from_date: date, to_date: date) -> list[dict]:
    """
    yfinance OHLCV 수집 → dict 리스트.
    빈 응답(상폐·신규상장 전) 시 빈 리스트.
    """
    try:
        df = yf.Ticker(ticker).history(
            start=from_date.strftime("%Y-%m-%d"),
            end=(to_date + timedelta(days=1)).strftime("%Y-%m-%d"),  # end 배타적
            auto_adjust=False,
            actions=False,
        )
    except Exception as e:
        logger.debug("%s yfinance 조회 오류: %s", ticker, e)
        return []

    if df is None or df.empty:
        return []

    # 컬럼 방어적 매핑
    has_adj = "Adj Close" in df.columns
    rows = []
    for idx, row in df.iterrows():
        try:
            close_val = float(row["Close"])
            if close_val != close_val:  # NaN
                continue
            adj_val = float(row["Adj Close"]) if has_adj else close_val
            volume_val = int(row["Volume"]) if row["Volume"] == row["Volume"] else 0
        except (KeyError, ValueError, TypeError):
            continue
        trade_date = idx.date() if hasattr(idx, "date") else idx
        rows.append({
            "trade_date": trade_date,
            "open":       float(row["Open"]),
            "high":       float(row["High"]),
            "low":        float(row["Low"]),
            "close":      close_val,
            "close_adj":  adj_val,
            "volume":     volume_val,
            "turnover":   close_val * volume_val,  # yfinance 거래대금 미제공 → 근사
        })
    return rows


def _get_all_securities() -> list[tuple[int, str]]:
    return get_all_active_security_ids(market="US")


def backfill(start_date: date, end_date: date, delay_sec: float = 0.2) -> None:
    """
    start_date ~ end_date 전 종목 가격 백필. 종목별 resume 가능.
    ingestion_meta key: (YF_PRICE_US_{ticker}, end_date). SUCCESS 종목 스킵.
    """
    securities = _get_all_securities()
    total = len(securities)
    logger.info("US 백필 시작: %d 종목, %s ~ %s, 딜레이 %.1fs", total, start_date, end_date, delay_sec)

    done = skipped = failed = empty_count = 0

    for idx, (security_id, ticker) in enumerate(securities, 1):
        source = f"{SOURCE_BACKFILL_PREFIX}{ticker}"
        run_id = start_run(source, end_date, market="US")

        if run_id is None:
            skipped += 1
            continue

        try:
            rows = _fetch_ohlcv(ticker, start_date, end_date)
            if not rows:
                empty_count += 1
                finish_run(source, end_date, rows_inserted=0, rows_updated=0)
            else:
                for row in rows:
                    row["security_id"] = security_id
                ins, upd = upsert_price_daily(rows)
                finish_run(source, end_date, rows_inserted=ins, rows_updated=upd)
            done += 1
        except Exception as e:
            failed += 1
            logger.warning("[%d/%d] %s 실패: %s", idx, total, ticker, e)
            fail_run(source, end_date, str(e))

        if idx % 50 == 0:
            logger.info("[%d/%d] 처리 %d / 스킵 %d / 빈응답 %d / 실패 %d",
                        idx, total, done, skipped, empty_count, failed)
        time.sleep(delay_sec)

    logger.info("US 백필 완료 — 처리 %d / 스킵(기완료) %d / 빈응답 %d / 실패 %d",
                done, skipped, empty_count, failed)


def load_daily(target_date: date = None, lookback_days: int = 7) -> None:
    """당일 가격 수집 (일배치용). source=YF_PRICE_US, target=수집일.

    ⚠️ target_date 하나만 조회하면 안 됨: EC2 크론은 KST 06:30에 도는데 그 시각 미국은
    아직 전일 장중~마감 직후라 date.today()(KST)는 미국에 존재하지 않는 미래 거래일이 됨
    → yfinance 빈 응답 → 매 실행 0건. 트레일링 창(기본 7일)으로 조회해 주말/휴일/타임존
    갭을 자가치유한다. yfinance 캘린더는 실제 거래일만 반환하고 upsert가 중복을 제거하므로
    이미 있는 날은 갱신 0으로 안전."""
    if target_date is None:
        target_date = date.today()
    from_date = target_date - timedelta(days=lookback_days)

    run_id = start_run(SOURCE_DAILY, target_date, market="US")
    if run_id is None:
        logger.info("이미 처리됨: %s %s, 스킵", SOURCE_DAILY, target_date)
        return

    try:
        securities = _get_all_securities()
        logger.info("US 일별 가격 수집(트레일링 %d일): %d 종목, %s ~ %s",
                    lookback_days, len(securities), from_date, target_date)

        total_ins = total_upd = 0
        for security_id, ticker in securities:
            rows = _fetch_ohlcv(ticker, from_date, target_date)
            for row in rows:
                row["security_id"] = security_id
            ins, upd = upsert_price_daily(rows)
            total_ins += ins
            total_upd += upd
            time.sleep(0.1)

        logger.info("US 일별 가격 적재 완료: 신규 %d, 갱신 %d", total_ins, total_upd)
        finish_run(SOURCE_DAILY, target_date, rows_inserted=total_ins, rows_updated=total_upd)

    except Exception as e:
        logger.exception("US 일별 가격 적재 실패")
        fail_run(SOURCE_DAILY, target_date, str(e))
        raise


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill", action="store_true", help="1년 백필")
    parser.add_argument("--years", type=int, default=2, help="백필 연수(기본 2)")
    args = parser.parse_args()
    if args.backfill:
        end = date.today()
        start = date(end.year - args.years, end.month, end.day)
        backfill(start, end)
    else:
        load_daily()
