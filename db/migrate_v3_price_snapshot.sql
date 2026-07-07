-- ============================================================
-- V3 가격 스냅샷 백필 (Flyway V17이 컬럼+인덱스 생성 후 실행)
-- 실행: psql -U canslim_user -d canslim -f migrate_v3_price_snapshot.sql
-- ============================================================

-- 기존 최신 score_date 데이터에 가격 백필
WITH ranked AS (
    SELECT security_id, close_adj, volume, turnover,
           ROW_NUMBER() OVER (PARTITION BY security_id ORDER BY trade_date DESC) rn,
           LEAD(close_adj) OVER (PARTITION BY security_id ORDER BY trade_date DESC) AS prev_close
    FROM price_daily
    WHERE trade_date >= CURRENT_DATE - INTERVAL '14 days'
),
cur AS (
    SELECT security_id, close_adj, prev_close, volume, turnover
    FROM ranked WHERE rn = 1
)
UPDATE canslim_scores cs SET
    close_price = cur.close_adj,
    prev_close  = cur.prev_close,
    change_rate = CASE WHEN cur.prev_close > 0
                  THEN ROUND(CAST((cur.close_adj - cur.prev_close) / cur.prev_close * 100 AS NUMERIC), 2)
                  END,
    volume      = cur.volume,
    turnover    = cur.turnover,
    market_cap  = cur.close_adj * i.total_shares
FROM cur
JOIN instruments i ON i.id = cur.security_id
WHERE cs.security_id = cur.security_id
  AND cs.score_date = (SELECT MAX(score_date) FROM canslim_scores);
