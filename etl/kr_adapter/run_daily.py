"""
KR 일별 ETL 진입점 — OS cron에서 호출
실행: python -m etl.kr_adapter.run_daily [YYYYMMDD]

스케줄 권장 (crontab):
  0 6 * * 1-5  PYTHONUTF8=1 python -m etl.kr_adapter.run_daily
"""
import os
import sys
import logging
from datetime import date, datetime

os.environ.setdefault("PYTHONUTF8", "1")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
logger = logging.getLogger(__name__)


def main():
    if len(sys.argv) > 1:
        target_date = datetime.strptime(sys.argv[1], "%Y%m%d").date()
    else:
        target_date = date.today()

    logger.info("=== KR 일별 ETL 시작: %s ===", target_date)

    from .instrument_loader import load as load_instruments
    from .price_loader import load as load_prices

    # 1. 종목 목록 갱신 (월요일 또는 수동 실행 시)
    if target_date.weekday() == 0:  # 월요일
        logger.info("월요일 — 종목 목록 갱신")
        load_instruments(target_date)

    # 2. 당일 가격 수집
    load_prices(target_date, lookback_days=1)

    logger.info("=== KR 일별 ETL 완료 ===")


if __name__ == "__main__":
    main()
