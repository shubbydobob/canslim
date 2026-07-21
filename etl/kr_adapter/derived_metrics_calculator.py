"""
derived_metrics — 가격 기반 컬럼 자동 계산

price_daily 데이터로부터:
  - pct_from_52w_high : 52주 고점 대비 현재가 %
  - rs_percentile     : 1년 수익률 기준 전체 종목 내 백분위
  - volume_ratio_20d  : 당일 거래량 / 20일 평균 거래량

실행: python -m etl.kr_adapter.derived_metrics_calculator [YYYYMMDD]
"""
import logging
import sys
from datetime import date, datetime
from sqlalchemy import text
from ..shared.db_writer import get_session

logger = logging.getLogger(__name__)


# 재무 컬럼을 전날 행에서 복사 (EPS는 DART 로드 시에만 갱신, 매일 carry-forward)
CARRY_FORWARD_SQL = """
UPDATE derived_metrics dm
SET
    eps_standalone_latest  = prev.eps_standalone_latest,
    eps_standalone_prev_yq = prev.eps_standalone_prev_yq,
    eps_qoq_yoy_pct        = prev.eps_qoq_yoy_pct,
    eps_qoq_accel          = prev.eps_qoq_accel,
    eps_3yr_cagr           = prev.eps_3yr_cagr,
    eps_annual_consistency = prev.eps_annual_consistency,
    roe_latest             = prev.roe_latest
FROM (
    SELECT DISTINCT ON (security_id)
        security_id,
        eps_standalone_latest, eps_standalone_prev_yq,
        eps_qoq_yoy_pct, eps_qoq_accel,
        eps_3yr_cagr, eps_annual_consistency, roe_latest
    FROM derived_metrics
    WHERE as_of_date < :as_of_date
      AND eps_standalone_latest IS NOT NULL
    ORDER BY security_id, as_of_date DESC
) prev
WHERE dm.security_id = prev.security_id
  AND dm.as_of_date  = :as_of_date
  AND dm.eps_standalone_latest IS NULL
"""

FLOW_CARRY_FORWARD_SQL = """
UPDATE derived_metrics dm
SET
    inst_net_buy_10d    = prev.inst_net_buy_10d,
    foreign_net_buy_10d = prev.foreign_net_buy_10d
FROM (
    SELECT DISTINCT ON (security_id)
        security_id, inst_net_buy_10d, foreign_net_buy_10d
    FROM derived_metrics
    WHERE as_of_date < :as_of_date
      AND inst_net_buy_10d IS NOT NULL
    ORDER BY security_id, as_of_date DESC
) prev
WHERE dm.security_id = prev.security_id
  AND dm.as_of_date  = :as_of_date
  AND dm.inst_net_buy_10d IS NULL
"""

# 기관(13F) 컬럼 carry-forward (US inst_pct_held 등. 13F는 분기 공시라 매일 재조회 불필요 →
# 종목갱신 주기(주1회)에만 로드하고 그 사이 날짜는 직전 값을 이월. 없으면 I 팩터가 매일 null).
INST_CARRY_FORWARD_SQL = """
UPDATE derived_metrics dm
SET
    inst_pct_held      = prev.inst_pct_held,
    inst_holders_count = prev.inst_holders_count,
    inst_accum_breadth = prev.inst_accum_breadth
FROM (
    SELECT DISTINCT ON (security_id)
        security_id, inst_pct_held, inst_holders_count, inst_accum_breadth
    FROM derived_metrics
    WHERE as_of_date < :as_of_date
      AND inst_pct_held IS NOT NULL
    ORDER BY security_id, as_of_date DESC
) prev
WHERE dm.security_id = prev.security_id
  AND dm.as_of_date  = :as_of_date
  AND dm.inst_pct_held IS NULL
"""

UPSERT_SQL = """
WITH price_stats AS (
    SELECT
        p.security_id,
        p.close_adj                                          AS latest_close,
        p52.high_52w,
        pv.avg_vol_20d,
        p.volume                                             AS latest_vol,
        p.close_adj / NULLIF(p1yr.close_adj, 0) - 1         AS return_1yr,
        CASE WHEN i.total_shares IS NOT NULL AND i.total_shares > 0
             THEN p.close_adj * i.total_shares / 1e12
        END                                                  AS market_cap_tril
    FROM (
        SELECT DISTINCT ON (security_id)
            security_id, close_adj, volume, trade_date
        FROM price_daily
        WHERE trade_date <= :as_of_date
        ORDER BY security_id, trade_date DESC
    ) p
    LEFT JOIN instruments i ON i.id = p.security_id
    LEFT JOIN LATERAL (
        SELECT MAX(close_adj) AS high_52w
        FROM price_daily p2
        WHERE p2.security_id = p.security_id
          AND p2.trade_date > p.trade_date - INTERVAL '365 days'
          AND p2.trade_date <= p.trade_date
    ) p52 ON true
    LEFT JOIN LATERAL (
        SELECT AVG(volume::numeric) AS avg_vol_20d
        FROM (
            SELECT volume FROM price_daily pv2
            WHERE pv2.security_id = p.security_id
              AND pv2.trade_date <= p.trade_date
            ORDER BY pv2.trade_date DESC LIMIT 20
        ) sub
    ) pv ON true
    LEFT JOIN LATERAL (
        SELECT close_adj FROM price_daily p3
        WHERE p3.security_id = p.security_id
          AND p3.trade_date <= p.trade_date - INTERVAL '252 days'
        ORDER BY p3.trade_date DESC LIMIT 1
    ) p1yr ON true
),
rs_ranked AS (
    SELECT
        security_id,
        CASE WHEN high_52w > 0
             THEN ROUND(CAST((latest_close - high_52w) / high_52w * 100 AS numeric), 4)
        END AS pct_from_52w,
        CASE WHEN avg_vol_20d > 0
             THEN ROUND(CAST(latest_vol / avg_vol_20d AS numeric), 4)
        END AS vol_ratio,
        ROUND(CAST(
            PERCENT_RANK() OVER (ORDER BY return_1yr NULLS FIRST) * 100
        AS numeric), 4) AS rs_pct,
        ROUND(CAST(market_cap_tril AS numeric), 4) AS market_cap_tril
    FROM price_stats
)
INSERT INTO derived_metrics (security_id, as_of_date, pct_from_52w_high, rs_percentile, volume_ratio_20d, market_cap_tril, created_at)
SELECT security_id, :as_of_date, pct_from_52w, rs_pct, vol_ratio, market_cap_tril, NOW()
FROM rs_ranked
ON CONFLICT (security_id, as_of_date) DO UPDATE SET
    pct_from_52w_high = EXCLUDED.pct_from_52w_high,
    rs_percentile     = EXCLUDED.rs_percentile,
    volume_ratio_20d  = EXCLUDED.volume_ratio_20d,
    market_cap_tril   = EXCLUDED.market_cap_tril
"""


def calculate(as_of_date: date | None = None) -> int:
    """
    지정 날짜의 derived_metrics 가격 컬럼을 계산해 업데이트.
    as_of_date=None 이면 derived_metrics의 최신 날짜 사용.
    반환값: 업데이트된 행 수
    """
    with get_session() as sess:
        if as_of_date is None:
            row = sess.execute(
                text("SELECT MAX(as_of_date) FROM derived_metrics")
            ).scalar()
            if row is None:
                logger.warning("derived_metrics 데이터 없음")
                return 0
            as_of_date = row

        # 1) 재무 컬럼 carry-forward (EPS 등 DART 데이터)
        cf = sess.execute(text(CARRY_FORWARD_SQL), {"as_of_date": as_of_date})
        logger.info("재무 컬럼 carry-forward: %d 행", cf.rowcount)

        # 1b) 수급 컬럼 carry-forward (KIS flow 데이터)
        cf2 = sess.execute(text(FLOW_CARRY_FORWARD_SQL), {"as_of_date": as_of_date})
        logger.info("수급 컬럼 carry-forward: %d 행", cf2.rowcount)

        # 2) 가격 기반 컬럼 upsert (price_daily 있는 전체 종목 대상)
        logger.info("derived_metrics upsert 중 (as_of_date=%s) ...", as_of_date)
        result = sess.execute(text(UPSERT_SQL), {"as_of_date": as_of_date})
        updated = result.rowcount
        logger.info("derived_metrics upsert 완료: %d 행", updated)

        # 3) 기관(13F) 컬럼 carry-forward — upsert로 행이 생성된 뒤 실행해야
        #    새 as_of 날짜(직전 정규화가 행을 안 만든 경우 포함)에도 확실히 채워짐.
        cf3 = sess.execute(text(INST_CARRY_FORWARD_SQL), {"as_of_date": as_of_date})
        logger.info("기관(13F) 컬럼 carry-forward: %d 행", cf3.rowcount)
        return updated


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    d = None
    if len(sys.argv) > 1:
        d = datetime.strptime(sys.argv[1], "%Y%m%d").date()
    calculate(d)
