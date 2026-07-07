-- canslim_scores에 가격 스냅샷 컬럼 추가 (정렬 인덱스용)
ALTER TABLE canslim_scores ADD COLUMN IF NOT EXISTS close_price NUMERIC(18,4);
ALTER TABLE canslim_scores ADD COLUMN IF NOT EXISTS prev_close  NUMERIC(18,4);
ALTER TABLE canslim_scores ADD COLUMN IF NOT EXISTS change_rate NUMERIC(8,4);
ALTER TABLE canslim_scores ADD COLUMN IF NOT EXISTS volume      BIGINT;
ALTER TABLE canslim_scores ADD COLUMN IF NOT EXISTS turnover    NUMERIC(22,4);
ALTER TABLE canslim_scores ADD COLUMN IF NOT EXISTS market_cap  NUMERIC(22,4);

-- 가격 정렬용 인덱스
CREATE INDEX IF NOT EXISTS idx_canslim_scores_turnover
    ON canslim_scores (score_date DESC, market, turnover DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_canslim_scores_chg_rate
    ON canslim_scores (score_date DESC, market, change_rate DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_canslim_scores_mkt_cap
    ON canslim_scores (score_date DESC, market, market_cap DESC NULLS LAST);
