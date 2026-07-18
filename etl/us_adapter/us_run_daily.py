"""
US 일별 ETL 진입점 — OS/서버 스케줄러에서 호출
실행:
  python -m etl.us_adapter.us_run_daily [YYYYMMDD]        # 일배치
  python -m etl.us_adapter.us_run_daily --backfill        # 초기 백필(가격 2년 + 재무 전량)

파이프라인 순서 (KR run_daily 미러, 수급 단계 제외):
  1. 종목 목록 갱신 (월요일 / 백필 시)   — us_instrument_loader
  2. 가격 수집 (price_daily)              — us_price_loader (yfinance)
  3. [수급 스킵 — US MVP 미지원]
  4. 재무 수집 (financials)               — edgar_financial_loader (SEC EDGAR, 월1회 갱신)
  5. financial_normalizer (EPS/ROE → derived_metrics)   ← KR 로직 재사용(단독분기 분기)
  6. derived_metrics 가격 컬럼 계산 (rs_percentile 등)  ← KR 로직 재사용
  7. market_state 갱신 (SPX/NDX 국면)      — us_market_state (yfinance)
  8. 스코어링 트리거 (Spring Boot REST)    — 엔진이 KR·US 전체 재채점

EC2 cron (KST): US 장 마감(16:00 ET ≈ 06:00 KST) 이후.
  30 6 * * 2-6  us_run_daily   (ET 평일 → KST 화~토 아침)
"""
import os
import sys
import logging
import requests
from datetime import date, datetime, timedelta

os.environ.setdefault("PYTHONUTF8", "1")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("etl_us_daily.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

SCORING_URL = os.environ.get("SCORING_URL", "http://localhost:8080/api/admin/scoring/run")


def _latest_us_trade_date(fallback: date) -> date:
    """price_daily의 최신 US 거래일. 채점일(=최신 가격일)과 정규화 as_of_date를 정렬해
    주말/휴일 배치가 캘린더 today에 EPS를 적재해 채점일과 어긋나는 것을 방지."""
    from ..shared.db_writer import get_session
    from sqlalchemy import text
    try:
        with get_session() as sess:
            row = sess.execute(text("""
                SELECT MAX(p.trade_date)
                FROM price_daily p JOIN instruments i ON i.id = p.security_id
                WHERE i.market = 'US'
            """)).fetchone()
        return row[0] if row and row[0] else fallback
    except Exception:
        return fallback


def _maybe_reset_us_financials(target_date: date) -> None:
    """매월 첫 주(1~7일 평일)에 EDGAR 재무 ingestion_meta 리셋 → 신규 공시 재수집."""
    if target_date.day > 7 or target_date.weekday() >= 5:
        return
    from ..shared.db_writer import get_session
    from sqlalchemy import text
    with get_session() as sess:
        deleted = sess.execute(text("""
            DELETE FROM ingestion_meta
            WHERE source_name LIKE 'EDGAR_FIN_US_%' AND status = 'SUCCESS'
        """)).rowcount
    if deleted > 0:
        logger.info("US 재무 ingestion_meta 월별 리셋: %d건 삭제(EDGAR 재수집 예약)", deleted)


def trigger_scoring() -> bool:
    try:
        r = requests.post(SCORING_URL, timeout=600)
        if r.ok:
            logger.info("스코어링 완료: %s", r.json())
            return True
        logger.warning("스코어링 응답 오류: %s %s", r.status_code, r.text[:200])
    except Exception as e:
        logger.error("스코어링 트리거 실패: %s", e)
    return False


def _run_pipeline(target_date: date, *, backfill: bool, refresh_universe: bool,
                  backfill_years: int = 2) -> None:
    from datetime import timedelta as _td

    # ── 1. 종목 목록 ──────────────────────────────────────────
    if refresh_universe:
        logger.info("[1/8] US 종목 목록 갱신")
        try:
            from .us_instrument_loader import load as load_instruments
            load_instruments(target_date)
        except Exception as e:
            logger.error("[1/8] 종목 목록 갱신 실패(비치명적, 기존 유지): %s", e)
    else:
        logger.info("[1/8] 종목 목록 갱신 생략")

    # ── 1b. 시총/거래소 보강(yfinance) — 종목 갱신 시에만 ─────
    if refresh_universe:
        logger.info("[1b/8] shares/exchange 보강(yfinance)")
        try:
            from .us_shares_loader import load as load_shares
            load_shares()
        except Exception as e:
            logger.error("[1b/8] shares/exchange 보강 실패(비치명적): %s", e)

    # ── 2. 가격 ──────────────────────────────────────────────
    logger.info("[2/8] 가격 수집 시작")
    try:
        from . import us_price_loader
        if backfill:
            start = date(target_date.year - backfill_years, target_date.month, target_date.day)
            us_price_loader.backfill(start, target_date)
        else:
            us_price_loader.load_daily(target_date)
        logger.info("[2/8] 가격 수집 완료")
    except Exception as e:
        logger.warning("[2/8] 가격 수집 실패(비치명적): %s", e)

    # 정규화/파생/채점 정렬용 as_of = 최신 US 거래일(캘린더 today 아님).
    as_of = _latest_us_trade_date(target_date)
    if as_of != target_date:
        logger.info("as_of 정렬: 최신 US 거래일 %s (target_date=%s)", as_of, target_date)

    # ── 3. 수급: US MVP 미지원(스킵) ─────────────────────────
    logger.info("[3/8] 수급 수집 스킵(US MVP)")

    # ── 4. 재무(EDGAR) ───────────────────────────────────────
    logger.info("[4/8] EDGAR 재무 수집 시작")
    try:
        _maybe_reset_us_financials(target_date)
        from .edgar_financial_loader import load as load_edgar
        load_edgar(target_date)
        logger.info("[4/8] EDGAR 재무 수집 완료")
    except Exception as e:
        logger.warning("[4/8] EDGAR 재무 수집 실패(비치명적): %s", e)

    # ── 5. financial_normalizer (KR 로직 재사용) ─────────────
    logger.info("[5/8] financial_normalizer 시작")
    try:
        from ..kr_adapter.financial_normalizer import normalize_all
        normalize_all(as_of)
        logger.info("[5/8] financial_normalizer 완료")
    except Exception as e:
        logger.warning("[5/8] financial_normalizer 실패(비치명적): %s", e)

    # ── 6. derived_metrics 가격 컬럼(KR 로직 재사용) ─────────
    logger.info("[6/8] derived_metrics 계산 시작")
    try:
        from ..kr_adapter.derived_metrics_calculator import calculate as calc_derived
        updated = calc_derived(as_of)
        logger.info("[6/8] derived_metrics 계산 완료: %d 행", updated)
    except Exception as e:
        logger.warning("[6/8] derived_metrics 계산 실패(비치명적): %s", e)

    # ── 7. market_state (SPX/NDX) ────────────────────────────
    logger.info("[7/8] market_state 갱신 시작")
    try:
        start_str = (as_of - _td(days=400 if backfill else 300)).strftime("%Y%m%d")
        end_str   = as_of.strftime("%Y%m%d")
        from .us_market_state import seed as seed_state
        seed_state("SPX", start_date=start_str, end_date=end_str)
        seed_state("NDX", start_date=start_str, end_date=end_str)
        logger.info("[7/8] market_state 갱신 완료")
    except Exception as e:
        logger.warning("[7/8] market_state 갱신 실패(비치명적): %s", e)

    # ── 8. 스코어링 트리거 ───────────────────────────────────
    logger.info("[8/8] 스코어링 트리거")
    if trigger_scoring():
        logger.info("[8/8] 스코어링 완료")
    else:
        logger.warning("[8/8] 스코어링 실패 — 수동 트리거 필요")


def main():
    args = [a for a in sys.argv[1:]]
    backfill = "--backfill" in args
    limit_date = next((a for a in args if not a.startswith("--")), None)

    if limit_date:
        target_date = datetime.strptime(limit_date, "%Y%m%d").date()
    else:
        target_date = date.today()

    logger.info("=" * 60)
    logger.info("US 일별 ETL 시작: %s (backfill=%s)", target_date, backfill)
    logger.info("=" * 60)

    # 백필이거나 월요일이면 종목 목록 갱신
    refresh_universe = backfill or target_date.weekday() == 0
    _run_pipeline(target_date, backfill=backfill, refresh_universe=refresh_universe)

    logger.info("=" * 60)
    logger.info("US 일별 ETL 완료: %s", target_date)
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
