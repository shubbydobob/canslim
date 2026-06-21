CREATE TABLE canslim_scores (
    id                BIGSERIAL PRIMARY KEY,
    security_id       BIGINT      NOT NULL REFERENCES instruments(id),
    score_date        DATE        NOT NULL,
    market            VARCHAR(10) NOT NULL,
    c_score           NUMERIC(6,2),
    a_score           NUMERIC(6,2),
    n_score           NUMERIC(6,2),
    s_score           NUMERIC(6,2),
    l_score           NUMERIC(6,2),
    i_score           NUMERIC(6,2),
    composite_score   NUMERIC(6,2) NOT NULL,
    market_rank       INTEGER,
    market_percentile NUMERIC(6,4),
    config_version    INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_canslim_scores_sec_date UNIQUE (security_id, score_date)
);
CREATE INDEX idx_canslim_scores_sec_date  ON canslim_scores (security_id, score_date DESC);
CREATE INDEX idx_canslim_scores_date_rank ON canslim_scores (score_date DESC, market, market_rank);
CREATE INDEX idx_canslim_scores_composite ON canslim_scores (score_date DESC, composite_score DESC);
