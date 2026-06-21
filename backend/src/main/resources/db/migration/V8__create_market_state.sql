CREATE TABLE market_state (
    id                      BIGSERIAL PRIMARY KEY,
    market                  VARCHAR(10) NOT NULL,
    state_date              DATE        NOT NULL,
    index_close             NUMERIC(14,4),
    index_close_adj         NUMERIC(14,4),
    ma_50d                  NUMERIC(14,4),
    ma_200d                 NUMERIC(14,4),
    distribution_day_count  SMALLINT    DEFAULT 0,
    distribution_day_today  BOOLEAN     DEFAULT FALSE,
    rally_day_count         SMALLINT    DEFAULT 0,
    trend_direction         VARCHAR(10),
    market_phase            VARCHAR(20),
    prev_phase              VARCHAR(20),
    notes                   TEXT,
    CONSTRAINT uq_market_state_market_date UNIQUE (market, state_date)
);
CREATE INDEX idx_market_state_market_date ON market_state (market, state_date DESC);
