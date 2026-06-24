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


UPDATE_SQL = """
WITH price_stats AS (
    SELECT
        p.security_id,
        p.close_adj                                          AS latest_close,
        p52.high_52w,
        pv.avg_vol_20d,
        p.volume                                             AS latest_vol,
        p.close_adj / NULLIF(p1yr.close_adj, 0) - 1         AS return_1yr
    FROM (
        SELECT DISTINCT ON (security_id)
            security_id, close_adj, volume, trade_date
        FROM price_daily
        WHERE trade_date <= :as_of_date
        ORDER BY security_id, trade_date DESC
    ) p
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
        AS numeric), 4) AS rs_pct
    FROM price_stats
)
UPDATE derived_metrics dm
SET
    pct_from_52w_high = rs.pct_from_52w,
    rs_percentile     = rs.rs_pct,
    volume_ratio_20d  = rs.vol_ratio
FROM rs_ranked rs
WHERE dm.security_id = rs.security_id
  AND dm.as_of_date  = :as_of_date
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

        logger.info("derived_metrics 계산 중 (as_of_date=%s) ...", as_of_date)
        result = sess.execute(text(UPDATE_SQL), {"as_of_date": as_of_date})
        updated = result.rowcount
        logger.info("derived_metrics 업데이트 완료: %d 행", updated)
        return updated


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    d = None
    if len(sys.argv) > 1:
        d = datetime.strptime(sys.argv[1], "%Y%m%d").date()
    calculate(d)
