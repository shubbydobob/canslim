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


def _maybe_reset_dart_ingestion(target_date: date) -> None:
    """매월 첫 거래일(1~7일 중 월~금)에 DART ingestion_meta 리셋 → 전 종목 재수집."""
    if target_date.day > 7 or target_date.weekday() >= 5:
        return
    from ..shared.db_writer import get_session
    from sqlalchemy import text
    with get_session() as sess:
        deleted = sess.execute(
            text("DELETE FROM ingestion_meta WHERE source_name LIKE 'DART_FIN_KR_%' AND status = 'SUCCESS'")
        ).rowcount
    if deleted > 0:
        logger.info("DART ingestion_meta 월별 리셋: %d건 삭제 (재수집 예약)", deleted)


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
    try:
        from .price_loader import load_daily
        load_daily(target_date)
        logger.info("[2/5] 가격 수집 완료")
    except Exception as e:
        logger.warning("[2/5] 가격 수집 실패 (비치명적): %s", e)

    # ── 3. KIS 수급 수집 ───────────────────────────────────────
    logger.info("[3/6] KIS 수급 수집 시작")
    try:
        from .investor_flow_loader import load_investor_flow
        load_investor_flow(as_of_date=target_date)
        logger.info("[3/6] KIS 수급 수집 완료")
    except Exception as e:
        logger.warning("[3/6] KIS 수급 수집 실패 (비치명적): %s", e)

    # ── 4. DART 재무 수집 (매월 첫 거래일 리셋 후 재수집, 나머지는 resume) ─
    logger.info("[4/7] DART 재무 수집 시작")
    try:
        _maybe_reset_dart_ingestion(target_date)
        from .dart_loader import load as load_dart
        load_dart(target_date)
        logger.info("[4/7] DART 재무 수집 완료")
    except Exception as e:
        logger.warning("[4/7] DART 재무 수집 실패 (비치명적): %s", e)

    # ── 5. financial_normalizer: DART EPS/ROE → derived_metrics ──
    logger.info("[5/7] financial_normalizer 시작")
    try:
        from .financial_normalizer import normalize_all
        normalize_all(target_date)
        logger.info("[5/7] financial_normalizer 완료")
    except Exception as e:
        logger.warning("[5/7] financial_normalizer 실패 (비치명적): %s", e)

    # ── 6. derived_metrics 가격 컬럼 계산 ─────────────────────
    logger.info("[6/8] derived_metrics 계산 시작")
    try:
        from .derived_metrics_calculator import calculate as calc_derived
        updated = calc_derived(target_date)
        logger.info("[6/8] derived_metrics 계산 완료: %d 행", updated)
    except Exception as e:
        logger.warning("[6/8] derived_metrics 계산 실패 (비치명적): %s", e)

    # ── 7. market_state 갱신 (KOSPI/KOSDAQ MA50/MA200 기반 국면 판정) ──
    logger.info("[7/9] market_state 갱신 시작")
    try:
        from datetime import timedelta
        start_str = (target_date - timedelta(days=250)).strftime("%Y%m%d")
        end_str   = target_date.strftime("%Y%m%d")
        from .market_state_seeder import seed
        seed("KOSPI",  start_date=start_str, end_date=end_str)
        seed("KOSDAQ", start_date=start_str, end_date=end_str)
        logger.info("[7/9] market_state 갱신 완료")
    except Exception as e:
        logger.warning("[7/9] market_state 갱신 실패 (비치명적): %s", e)

    # ── 8. 스코어링 트리거 ─────────────────────────────────────
    logger.info("[8/9] 스코어링 트리거")
    ok = trigger_scoring()
    if ok:
        logger.info("[8/9] 스코어링 완료")
    else:
        logger.warning("[8/9] 스코어링 실패 — 수동 트리거 필요")

    # ── 9. SNS 카드 생성 + 포스팅 (스코어링 성공 시) ──────────
    if ok:
        logger.info("[9/9] SNS 카드 생성 시작")
        try:
            from ..sns_publisher.card_generator import run as generate_card
            result = generate_card(n=5)
            logger.info("[9/9] 카드 생성 완료: %s", result["image"])

            from pathlib import Path
            image_path = Path(result["image"])
            caption = Path(result["caption"]).read_text(encoding="utf-8")

            # Threads 게시 (환경변수 있을 때만)
            if os.environ.get("THREADS_USER_ID") and os.environ.get("THREADS_TOKEN"):
                try:
                    from ..sns_publisher.threads_poster import post_to_threads
                    post_id = post_to_threads(caption, image_path)
                    logger.info("[9/9] Threads 게시 완료: %s", post_id)
                except Exception as e:
                    logger.warning("[9/9] Threads 게시 실패 (비치명적): %s", e)
            else:
                logger.info("[9/9] THREADS 환경변수 미설정 — Threads 게시 생략")

            # Instagram 게시 (환경변수 있을 때만)
            if os.environ.get("INSTAGRAM_USER_ID") and os.environ.get("INSTAGRAM_TOKEN"):
                try:
                    from ..sns_publisher.instagram_poster import post_to_instagram
                    media_id = post_to_instagram(caption, image_path)
                    logger.info("[9/9] Instagram 게시 완료: media_id=%s", media_id)
                except Exception as e:
                    logger.warning("[9/9] Instagram 게시 실패 (비치명적): %s", e)
            else:
                logger.info("[9/9] INSTAGRAM 환경변수 미설정 — Instagram 게시 생략")

        except Exception as e:
            logger.warning("[9/9] SNS 카드 생성 실패 (비치명적): %s", e)
    else:
        logger.info("[9/9] 스코어링 실패로 SNS 카드 생성 생략")

    logger.info("=" * 60)
    logger.info("KR 일별 ETL 완료: %s", target_date)
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
