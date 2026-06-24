"""
KR 일별 ETL 진입점 — OS 스케줄러에서 호출
실행: python -m etl.kr_adapter.run_daily [YYYYMMDD]

파이프라인 순서:
  1. 종목 목록 갱신 (월요일만)
  2. 당일 가격 수집 (price_daily)
  3. KIS 수급 수집 (derived_metrics: inst/foreign_net_buy_10d)
  4. derived_metrics 가격 컬럼 계산 (pct_from_52w_high, rs_percentile, volume_ratio_20d)
  5. 스코어링 트리거 (Spring Boot REST API)

Windows 작업 스케줄러 설정:
  트리거: 매일 오후 4:10 (장 마감 3:30 + 여유)
  작업:   pythonw -m etl.kr_adapter.run_daily  (C:\\Projects\\canslim 디렉터리)
"""
import os
import sys
import logging
import requests
from datetime import date, datetime

os.environ.setdefault("PYTHONUTF8", "1")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("etl_daily.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

SCORING_URL = os.environ.get("SCORING_URL", "http://localhost:8080/api/admin/scoring/run")


def trigger_scoring() -> bool:
    try:
        r = requests.post(SCORING_URL, timeout=300)
        if r.ok:
            data = r.json()
            logger.info("스코어링 완료: %s", data)
            return True
        logger.warning("스코어링 응답 오류: %s %s", r.status_code, r.text[:200])
    except Exception as e:
        logger.error("스코어링 트리거 실패: %s", e)
    return False


def main():
    if len(sys.argv) > 1:
        target_date = datetime.strptime(sys.argv[1], "%Y%m%d").date()
    else:
        target_date = date.today()

    logger.info("=" * 60)
    logger.info("KR 일별 ETL 시작: %s", target_date)
    logger.info("=" * 60)

    # ── 1. 종목 목록 갱신 (월요일) ─────────────────────────────
    if target_date.weekday() == 0:
        logger.info("[1/5] 종목 목록 갱신 (월요일)")
        from .instrument_loader import load as load_instruments
        load_instruments(target_date)
    else:
        logger.info("[1/5] 종목 목록 갱신 생략 (월요일 아님)")

    # ── 2. 당일 가격 수집 ──────────────────────────────────────
    logger.info("[2/5] 가격 수집 시작")
    from .price_loader import load_daily
    load_daily(target_date)
    logger.info("[2/5] 가격 수집 완료")

    # ── 3. KIS 수급 수집 ───────────────────────────────────────
    logger.info("[3/5] KIS 수급 수집 시작")
    from .investor_flow_loader import load_investor_flow
    load_investor_flow(as_of_date=target_date)
    logger.info("[3/5] KIS 수급 수집 완료")

    # ── 4. derived_metrics 가격 컬럼 계산 ─────────────────────
    logger.info("[4/5] derived_metrics 계산 시작")
    from .derived_metrics_calculator import calculate as calc_derived
    updated = calc_derived(target_date)
    logger.info("[4/5] derived_metrics 계산 완료: %d 행", updated)

    # ── 5. 스코어링 트리거 ─────────────────────────────────────
    logger.info("[5/5] 스코어링 트리거")
    ok = trigger_scoring()
    if ok:
        logger.info("[5/5] 스코어링 완료")
    else:
        logger.warning("[5/5] 스코어링 실패 — 수동 트리거 필요")

    logger.info("=" * 60)
    logger.info("KR 일별 ETL 완료: %s", target_date)
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
