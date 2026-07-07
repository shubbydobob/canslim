-- ============================================================
-- V3 마이그레이션: canslim_scores에 가격 스냅샷 컬럼 추가
-- 실행: psql -U canslim_user -d canslim -f migrate_v3_price_snapshot.sql
-- ============================================================

-- 1. canslim_scores 가격 컬럼 추가
ALTER TABLE canslim_scores ADD COLUMN IF NOT EXISTS close_price NUMERIC(18,4);
ALTER TABLE canslim_scores ADD COLUMN IF NOT EXISTS prev_close  NUMERIC(18,4);
ALTER TABLE canslim_scores ADD COLUMN IF NOT EXISTS change_rate NUMERIC(8,4);
ALTER TABLE canslim_scores ADD COLUMN IF NOT EXISTS volume      BIGINT;
ALTER TABLE canslim_scores ADD COLUMN IF NOT EXISTS turnover    NUMERIC(22,4);
ALTER TABLE canslim_scores ADD COLUMN IF NOT EXISTS market_cap  NUMERIC(22,4);

-- 2. 가격 정렬용 인덱스
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canslim_scores_turnover
    ON canslim_scores (score_date DESC, market, turnover DESC NULLS LAST);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canslim_scores_chg_rate
    ON canslim_scores (score_date DESC, market, change_rate DESC NULLS LAST);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canslim_scores_mkt_cap
    ON canslim_scores (score_date DESC, market, market_cap DESC NULLS LAST);

-- 3. 기존 데이터 백필 (최신 score_date만)
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
