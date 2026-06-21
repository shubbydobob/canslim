CREATE TABLE industry_scores (
    id                BIGSERIAL PRIMARY KEY,
    industry_group_id BIGINT    NOT NULL REFERENCES industry_groups(id),
    score_date        DATE      NOT NULL,
    avg_composite     NUMERIC(6,2),
    median_composite  NUMERIC(6,2),
    avg_rs_percentile NUMERIC(6,4),
    stock_count       INTEGER,
    industry_rank     INTEGER,
    CONSTRAINT uq_industry_scores_grp_date UNIQUE (industry_group_id, score_date)
);
CREATE INDEX idx_industry_scores_date_rank ON industry_scores (score_date DESC, industry_rank);
