"""
10년치 국장 전체 백필 마스터 스크립트
실행:
  python -m etl.kr_adapter.run_backfill_10yr             # 안전 모드(기본): 덮어쓰기만, 기존 데이터 유지
  python -m etl.kr_adapter.run_backfill_10yr --rebuild   # 전체 재구축: TRUNCATE 후 처음부터 (파괴적)
  python -m etl.kr_adapter.run_backfill_10yr --shutdown  # 완료 후 Windows 종료

⚠️ 이 스크립트는 매일 스케줄로 돌리는 물건이 아님. 매일 증분 갱신은 run_daily.py 사용.
   --rebuild 없이 실행하면 모든 스텝이 upsert(덮어쓰기)라, 중간에 끊겨도 기존 운영 데이터가 살아있음.

순서:
  1. (--rebuild 일 때만) DB 전체 TRUNCATE
  2. instruments 적재 (COMMON, DART corp_code 있는 종목만)
  3. 섹터 데이터 적재 (pykrx)
  4. price_daily 백필 2016-01-04 ~ 오늘
  5. financials 백필 2016~2025 (DART 10년치)
  6. financial_normalizer 최신일 실행
  7. Spring Boot admin API → 채점
  8. (--shutdown 일 때만) Windows 종료
"""
import os
import sys
import logging
import time
import requests
from datetime import date, datetime

os.environ.setdefault("PYTHONUTF8", "1")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("backfill_10yr.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# 채점/가격 백필 최신일. 기본은 오늘(최신 거래일까지 pykrx가 반환).
# 필요 시 BACKFILL_SCORE_DATE=YYYY-MM-DD 로 명시적 지정.
_env_score_date = os.environ.get("BACKFILL_SCORE_DATE")
SCORE_DATE    = datetime.strptime(_env_score_date, "%Y-%m-%d").date() if _env_score_date else date.today()
PRICE_START   = date(2016, 1, 4)
ADMIN_API     = "http://localhost:8080/api/admin/scoring/run"
SHUTDOWN_SEC  = 120                 # 채점 완료 후 종료 대기 (초)


# ─────────────────────────────────────────
# Step 1: TRUNCATE
# ─────────────────────────────────────────
def step_truncate():
    log.info("=" * 60)
    log.info("STEP 1: DB TRUNCATE")
    log.info("=" * 60)
    from ..shared.db_writer import get_session
    from sqlalchemy import text

    # instruments CASCADE → price_daily/financials/derived_metrics/canslim_scores/industry_scores 자동 삭제
    # market_config 는 채점 설정이므로 보존
    with get_session() as session:
        session.execute(text(
            "TRUNCATE instruments, ingestion_meta, market_state, industry_groups "
            "RESTART IDENTITY CASCADE"
        ))
    log.info("TRUNCATE 완료 (market_config 보존)")


# ─────────────────────────────────────────
# Step 2: instruments (DART 필터)
# ─────────────────────────────────────────
def step_instruments():
    log.info("=" * 60)
    log.info("STEP 2: instruments 적재 (DART corp_code 필터)")
    log.info("=" * 60)

    from .instrument_loader import load as load_instruments
    load_instruments()

    # DART corp_code 없는 종목 제거
    from ..shared.dart_client import download_corp_codes
    from ..shared.db_writer import get_session
    from sqlalchemy import text

    log.info("DART corp_codes 다운로드...")
    corp_map = download_corp_codes()  # {ticker: corp_code}
    covered_tickers = set(corp_map.keys())
    log.info("DART 커버 종목: %d개", len(covered_tickers))

    with get_session() as session:
        result = session.execute(text("SELECT id, ticker FROM instruments")).fetchall()
        to_delete = [r.id for r in result if r.ticker not in covered_tickers]

        if to_delete:
            session.execute(
                text("DELETE FROM instruments WHERE id = ANY(:ids)"),
                {"ids": to_delete},
            )
            log.info("DART 미커버 종목 제거: %d개 → 남은 종목: %d개",
                     len(to_delete), len(result) - len(to_delete))
        else:
            log.info("모든 종목이 DART 커버. 제거 없음.")


# ─────────────────────────────────────────
# Step 3: 섹터 데이터
# ─────────────────────────────────────────
def step_sector():
    log.info("=" * 60)
    log.info("STEP 3: 섹터 데이터 적재 (pykrx)")
    log.info("=" * 60)
    from pykrx import stock as pstock
    from ..shared.db_writer import get_session
    from sqlalchemy import text

    ref_date = SCORE_DATE.strftime("%Y%m%d")
    sector_map: dict[str, str] = {}

    for market in ("KOSPI", "KOSDAQ"):
        try:
            df = pstock.get_market_sector_classifications(ref_date, market)
            if df is None or df.empty:
                continue
            ticker_col  = df.columns[0]   # '티커' 또는 첫 번째 컬럼
            sector_col  = df.columns[-1]  # '섹터' 또는 마지막 컬럼
            for _, row in df.iterrows():
                t = str(row[ticker_col]).strip()
                s = str(row[sector_col]).strip()
                if t and s:
                    sector_map[t] = s
        except Exception as e:
            log.warning("pykrx 섹터 조회 실패 (%s): %s", market, e)

    if not sector_map:
        log.warning("섹터 데이터 없음 — 건너뜀")
        return

    with get_session() as session:
        updated = 0
        for ticker, sector in sector_map.items():
            r = session.execute(
                text("UPDATE instruments SET sector = :s WHERE ticker = :t"),
                {"s": sector, "t": ticker},
            )
            updated += r.rowcount
    log.info("섹터 갱신: %d종목", updated)


# ─────────────────────────────────────────
# Step 4: price_daily 백필
# ─────────────────────────────────────────
def step_price():
    log.info("=" * 60)
    log.info("STEP 4: price_daily 백필 %s ~ %s", PRICE_START, SCORE_DATE)
    log.info("=" * 60)
    from .price_loader import backfill
    backfill(PRICE_START, SCORE_DATE, delay_sec=0.3)


# ─────────────────────────────────────────
# Step 5: financials 백필 (DART 10년)
# ─────────────────────────────────────────
def step_financials():
    log.info("=" * 60)
    log.info("STEP 5: financials 백필 (DART 2016~2025)")
    log.info("=" * 60)
    from .dart_loader import load as load_dart
    load_dart(target_date=date.today())


# ─────────────────────────────────────────
# Step 6: financial_normalizer
# ─────────────────────────────────────────
def step_normalize():
    log.info("=" * 60)
    log.info("STEP 6: financial_normalizer (as_of=%s)", SCORE_DATE)
    log.info("=" * 60)
    from .financial_normalizer import normalize_all
    normalize_all(SCORE_DATE)


# ─────────────────────────────────────────
# Step 7: Spring Boot 채점
# ─────────────────────────────────────────
def step_scoring():
    log.info("=" * 60)
    log.info("STEP 7: Spring Boot 채점 (date=%s)", SCORE_DATE)
    log.info("=" * 60)

    # Spring Boot 기동 대기 (최대 60초)
    for i in range(12):
        try:
            r = requests.get("http://localhost:8080/api/screener?market=KR&limit=1", timeout=5)
            if r.status_code in (200, 404):
                log.info("Spring Boot 정상 확인")
                break
        except Exception:
            pass
        log.info("Spring Boot 대기 중... (%d/12)", i + 1)
        time.sleep(5)
    else:
        log.error("Spring Boot 응답 없음 — 채점 건너뜀")
        return

    try:
        r = requests.post(
            ADMIN_API,
            params={"date": SCORE_DATE.isoformat()},
            timeout=1800,   # 30분 타임아웃
        )
        if r.ok:
            log.info("채점 완료: %s", r.json())
        else:
            log.error("채점 API 오류: %d %s", r.status_code, r.text[:200])
    except Exception as e:
        log.error("채점 API 호출 실패: %s", e)


# ─────────────────────────────────────────
# Step 8: Windows 종료
# ─────────────────────────────────────────
def step_shutdown():
    log.info("=" * 60)
    log.info("STEP 8: 전체 완료 — %d초 후 Windows 종료", SHUTDOWN_SEC)
    log.info("=" * 60)
    import subprocess
    subprocess.run(["shutdown", "/s", "/t", str(SHUTDOWN_SEC)], check=False)


# ─────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────
def main():
    t_start = time.time()
    rebuild  = "--rebuild" in sys.argv
    shutdown = "--shutdown" in sys.argv

    mode = "전체 재구축(REBUILD)" if rebuild else "안전 모드(덮어쓰기)"
    log.info("★ 10년치 백필 시작 (SCORE_DATE=%s, mode=%s) ★", SCORE_DATE, mode)

    if rebuild:
        log.warning("⚠️ --rebuild: 시작 시 전체 TRUNCATE 후 재적재 (기존 데이터 삭제).")
    else:
        log.info("안전 모드: TRUNCATE 생략, 모든 스텝 upsert. 중단돼도 기존 데이터 유지.")
        log.info("전체 재구축이 필요하면 --rebuild 플래그로 실행하세요.")

    steps = []
    if rebuild:
        steps.append(("TRUNCATE", step_truncate))   # 파괴적 — --rebuild 일 때만
    steps += [
        ("instruments",    step_instruments),
        ("sector",         step_sector),
        ("price",          step_price),
        ("financials",     step_financials),
        ("normalize",      step_normalize),
        ("scoring",        step_scoring),
    ]
    if shutdown:
        steps.append(("shutdown", step_shutdown))   # Windows 종료 — --shutdown 일 때만

    for name, fn in steps:
        t0 = time.time()
        try:
            fn()
        except Exception as e:
            log.error("[%s] 실패: %s", name, e, exc_info=True)
            log.error("중단 — 이후 단계 건너뜀")
            break
        log.info("[%s] 완료 (%.1f분)", name, (time.time() - t0) / 60)

    total = (time.time() - t_start) / 3600
    log.info("★ 전체 소요: %.2f시간 ★", total)


if __name__ == "__main__":
    main()
