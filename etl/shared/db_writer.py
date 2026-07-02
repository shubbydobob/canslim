"""
공유 DB 쓰기 헬퍼 — SQLAlchemy 기반 upsert
모든 ETL 어댑터가 이 모듈을 통해 DB에 씁니다.
"""
import os
import yaml
from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from contextlib import contextmanager

_engine = None


def _load_config() -> dict:
    config_path = Path(__file__).parent.parent / "config" / "db.yaml"
    if not config_path.exists():
        raise FileNotFoundError(
            f"DB 설정 파일 없음: {config_path}\n"
            "etl/config/db.yaml.example 을 복사해서 db.yaml 을 만드세요."
        )
    with open(config_path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def get_engine():
    global _engine
    if _engine is None:
        cfg = _load_config()
        url = (
            f"postgresql+psycopg2://{cfg['user']}:{cfg['password']}"
            f"@{cfg['host']}:{cfg['port']}/{cfg['database']}"
        )
        _engine = create_engine(url, pool_pre_ping=True, pool_size=5)
    return _engine


@contextmanager
def get_session():
    engine = get_engine()
    with Session(engine) as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


def upsert_instruments(rows: list[dict]) -> tuple[int, int]:
    """
    instruments 테이블 upsert.
    rows: [{'ticker': ..., 'market': ..., 'name': ..., ...}]
    returns: (inserted, updated)
    """
    if not rows:
        return 0, 0

    sql = text("""
        INSERT INTO instruments (ticker, market, name, security_type, listing_date,
                                 float_shares, total_shares, sector, currency, is_active, updated_at)
        VALUES (:ticker, :market, :name, :security_type, :listing_date,
                :float_shares, :total_shares, :sector, :currency, TRUE, NOW())
        ON CONFLICT (ticker, market) DO UPDATE SET
            name          = EXCLUDED.name,
            security_type = EXCLUDED.security_type,
            total_shares  = EXCLUDED.total_shares,
            float_shares  = EXCLUDED.float_shares,
            sector        = EXCLUDED.sector,
            is_active     = TRUE,
            updated_at    = NOW()
        RETURNING (xmax = 0) AS inserted
    """)

    inserted = updated = 0
    with get_session() as session:
        for row in rows:
            result = session.execute(sql, row)
            for r in result:
                if r.inserted:
                    inserted += 1
                else:
                    updated += 1
    return inserted, updated


def upsert_price_daily(rows: list[dict]) -> tuple[int, int]:
    """
    price_daily 테이블 upsert (파티션 테이블).
    rows: [{'security_id': ..., 'trade_date': ..., 'open': ..., 'high': ...,
            'low': ..., 'close': ..., 'close_adj': ..., 'volume': ..., 'turnover': ...}]

    주의: price_daily는 파티션 테이블이므로 RETURNING xmax 미지원.
    insert/update 구분 없이 처리 건수만 반환.
    close는 ON CONFLICT에서 갱신하지 않음 (원본 불변).
    """
    if not rows:
        return 0, 0

    sql = text("""
        INSERT INTO price_daily (security_id, trade_date, open, high, low, close,
                                 close_adj, volume, turnover)
        VALUES (:security_id, :trade_date, :open, :high, :low, :close,
                :close_adj, :volume, :turnover)
        ON CONFLICT (security_id, trade_date) DO UPDATE SET
            close_adj = EXCLUDED.close_adj,
            volume    = EXCLUDED.volume,
            turnover  = EXCLUDED.turnover
    """)

    with get_session() as session:
        for i in range(0, len(rows), 1000):
            session.execute(sql, rows[i:i + 1000])
    return len(rows), 0


def get_security_id(ticker: str, market: str) -> int | None:
    """ticker + market으로 instruments.id 조회"""
    sql = text("SELECT id FROM instruments WHERE ticker = :ticker AND market = :market")
    with get_session() as session:
        result = session.execute(sql, {"ticker": ticker, "market": market}).fetchone()
        return result.id if result else None


def get_all_active_security_ids(market: str) -> list[tuple[int, str]]:
    """시장별 활성 종목 (id, ticker) 목록 반환"""
    sql = text("""
        SELECT id, ticker FROM instruments
        WHERE market = :market AND is_active = TRUE
        ORDER BY id
    """)
    with get_session() as session:
        rows = session.execute(sql, {"market": market}).fetchall()
        return [(r.id, r.ticker) for r in rows]


def upsert_financials(rows: list[dict]) -> tuple[int, int]:
    """
    financials 테이블 upsert.
    ON CONFLICT: 핵심 재무 수치 갱신 (period_end_date, revenue, operating_income,
                 net_income, eps). fiscal_quarter=4 = 연간(ANNUAL) 규약.
    """
    if not rows:
        return 0, 0

    sql = text("""
        INSERT INTO financials (
            security_id, period_type, fiscal_year, fiscal_quarter,
            period_end_date, report_date, revenue, operating_income,
            net_income, eps, shares_diluted, roe,
            is_cumulative, is_consolidated, currency, data_source
        ) VALUES (
            :security_id, :period_type, :fiscal_year, :fiscal_quarter,
            :period_end_date, :report_date, :revenue, :operating_income,
            :net_income, :eps, :shares_diluted, :roe,
            :is_cumulative, :is_consolidated, :currency, :data_source
        )
        ON CONFLICT (security_id, period_type, fiscal_year, fiscal_quarter,
                     is_consolidated, is_cumulative)
        DO UPDATE SET
            revenue          = EXCLUDED.revenue,
            operating_income = EXCLUDED.operating_income,
            net_income       = EXCLUDED.net_income,
            eps              = EXCLUDED.eps,
            roe              = EXCLUDED.roe,
            period_end_date  = EXCLUDED.period_end_date,
            updated_at       = NOW()
        RETURNING (xmax = 0) AS inserted
    """)

    inserted = updated = 0
    with get_session() as session:
        for row in rows:
            result = session.execute(sql, row)
            for r in result:
                if r.inserted:
                    inserted += 1
                else:
                    updated += 1
    return inserted, updated


def upsert_investor_flow(rows: list[dict]) -> int:
    """
    derived_metrics의 투자자 흐름 컬럼만 upsert.
    행이 없으면 INSERT, 있으면 세 컬럼만 UPDATE (재무·가격 컬럼 불변).
    """
    if not rows:
        return 0

    sql = text("""
        INSERT INTO derived_metrics (
            security_id, as_of_date,
            inst_net_buy_10d, foreign_net_buy_10d, program_net_buy_10d, inst_trend_flag,
            created_at
        ) VALUES (
            :security_id, :as_of_date,
            :inst_net_buy_10d, :foreign_net_buy_10d, :program_net_buy_10d, :inst_trend_flag,
            NOW()
        )
        ON CONFLICT (security_id, as_of_date) DO UPDATE SET
            inst_net_buy_10d    = EXCLUDED.inst_net_buy_10d,
            foreign_net_buy_10d = EXCLUDED.foreign_net_buy_10d,
            program_net_buy_10d = EXCLUDED.program_net_buy_10d,
            inst_trend_flag     = EXCLUDED.inst_trend_flag
    """)

    with get_session() as session:
        for i in range(0, len(rows), 500):
            session.execute(sql, rows[i:i + 500])
    return len(rows)


def upsert_derived_metrics(rows: list[dict]) -> tuple[int, int]:
    """
    derived_metrics 테이블 upsert (Python ETL 담당 재무 컬럼만).
    Java DerivedMetricsJob이 가격 컬럼을 별도 갱신하므로 재무 컬럼만 SET.
    """
    if not rows:
        return 0, 0

    sql = text("""
        INSERT INTO derived_metrics (
            security_id, as_of_date,
            eps_standalone_latest, eps_standalone_prev_yq,
            eps_qoq_yoy_pct, eps_qoq_accel,
            eps_3yr_cagr, eps_annual_consistency, roe_latest
        ) VALUES (
            :security_id, :as_of_date,
            :eps_standalone_latest, :eps_standalone_prev_yq,
            :eps_qoq_yoy_pct, :eps_qoq_accel,
            :eps_3yr_cagr, :eps_annual_consistency, :roe_latest
        )
        ON CONFLICT (security_id, as_of_date) DO UPDATE SET
            eps_standalone_latest  = EXCLUDED.eps_standalone_latest,
            eps_standalone_prev_yq = EXCLUDED.eps_standalone_prev_yq,
            eps_qoq_yoy_pct        = EXCLUDED.eps_qoq_yoy_pct,
            eps_qoq_accel          = EXCLUDED.eps_qoq_accel,
            eps_3yr_cagr           = EXCLUDED.eps_3yr_cagr,
            eps_annual_consistency = EXCLUDED.eps_annual_consistency,
            roe_latest             = EXCLUDED.roe_latest
        RETURNING (xmax = 0) AS inserted
    """)

    inserted = updated = 0
    with get_session() as session:
        for row in rows:
            result = session.execute(sql, row)
            for r in result:
                if r.inserted:
                    inserted += 1
                else:
                    updated += 1
    return inserted, updated
