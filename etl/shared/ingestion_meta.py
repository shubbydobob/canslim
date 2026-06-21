"""
ingestion_meta 테이블 관리 — ETL 실행 추적 및 멱등성 지원
"""
import uuid
from datetime import date
from sqlalchemy import text
from .db_writer import get_session


def start_run(source_name: str, target_date: date, market: str = None) -> str:
    """
    ETL 실행 시작 기록. run_id 반환.
    이미 SUCCESS 상태면 스킵 신호로 None 반환.
    """
    run_id = str(uuid.uuid4())

    check_sql = text("""
        SELECT status FROM ingestion_meta
        WHERE source_name = :source AND target_date = :td
    """)
    upsert_sql = text("""
        INSERT INTO ingestion_meta (source_name, market, target_date, status, started_at, run_id)
        VALUES (:source, :market, :td, 'RUNNING', NOW(), :run_id)
        ON CONFLICT (source_name, target_date) DO UPDATE SET
            status     = 'RUNNING',
            started_at = NOW(),
            run_id     = :run_id,
            error_message = NULL
        WHERE ingestion_meta.status != 'SUCCESS'
    """)

    with get_session() as session:
        existing = session.execute(check_sql, {"source": source_name, "td": target_date}).fetchone()
        if existing and existing.status == "SUCCESS":
            return None  # 이미 성공 처리됨 → 스킵
        session.execute(upsert_sql, {
            "source": source_name, "market": market,
            "td": target_date, "run_id": run_id
        })
    return run_id


def finish_run(source_name: str, target_date: date,
               rows_inserted: int = 0, rows_updated: int = 0):
    sql = text("""
        UPDATE ingestion_meta SET
            status = 'SUCCESS', completed_at = NOW(),
            rows_inserted = :ins, rows_updated = :upd
        WHERE source_name = :source AND target_date = :td
    """)
    with get_session() as session:
        session.execute(sql, {
            "source": source_name, "td": target_date,
            "ins": rows_inserted, "upd": rows_updated
        })


def fail_run(source_name: str, target_date: date, error: str):
    sql = text("""
        UPDATE ingestion_meta SET
            status = 'FAILED', completed_at = NOW(), error_message = :err
        WHERE source_name = :source AND target_date = :td
    """)
    with get_session() as session:
        session.execute(sql, {"source": source_name, "td": target_date, "err": error[:2000]})
