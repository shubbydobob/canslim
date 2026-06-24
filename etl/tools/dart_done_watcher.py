"""
DART 적재 완료 감시 → 스코어링 자동 트리거

실행: python -m etl.tools.dart_done_watcher
동작:
  - 2분마다 ingestion_meta에서 DART 완료 종목 수 확인
  - RUNNING 0개 + 미완료 < 50개 → 완료로 판단
  - 완료 시 Spring Boot /api/admin/scoring/run 호출
"""
import time
import logging
import requests
import psycopg2
import yaml
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

POLL_INTERVAL = 120   # 2분
SCORING_URL   = "http://localhost:8080/api/admin/scoring/run"
TOTAL_STOCKS  = 2558
DONE_THRESHOLD = TOTAL_STOCKS - 50  # 미완료 50개 이하면 완료로 간주


def get_db_conn():
    cfg_path = Path(__file__).parent.parent / "config" / "db.yaml"
    if cfg_path.exists():
        with open(cfg_path) as f:
            cfg = yaml.safe_load(f)
        return psycopg2.connect(**cfg)
    # fallback: 환경 변수 / 기본값
    return psycopg2.connect(
        host="localhost", port=5432,
        dbname="canslim", user="canslim_user", password="1234"
    )


def check_dart_status():
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END) AS success,
                    SUM(CASE WHEN status='RUNNING' THEN 1 ELSE 0 END) AS running,
                    COUNT(*) AS total
                FROM ingestion_meta
                WHERE source_name LIKE 'DART_FIN_KR_%'
            """)
            row = cur.fetchone()
            return {"success": row[0] or 0, "running": row[1] or 0, "total": row[2] or 0}


def trigger_scoring():
    log.info("스코어링 트리거 중: POST %s", SCORING_URL)
    try:
        resp = requests.post(SCORING_URL, timeout=600)
        if resp.status_code == 200:
            log.info("스코어링 완료: %s", resp.text[:200])
        else:
            log.warning("스코어링 응답 %d: %s", resp.status_code, resp.text[:200])
    except Exception as e:
        log.error("스코어링 트리거 실패: %s", e)


def main():
    log.info("DART 완료 감시 시작 (폴링 %ds)", POLL_INTERVAL)
    last_success = 0

    while True:
        try:
            status = check_dart_status()
            success = status["success"]
            running = status["running"]

            if success != last_success:
                log.info("DART 진행: %d / %d (RUNNING: %d)", success, TOTAL_STOCKS, running)
                last_success = success

            if success >= DONE_THRESHOLD and running == 0:
                log.info("DART 적재 완료 감지! (%d/%d) → 스코어링 시작", success, TOTAL_STOCKS)
                trigger_scoring()
                log.info("완료. 감시 종료.")
                break

        except Exception as e:
            log.warning("상태 확인 실패: %s", e)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
