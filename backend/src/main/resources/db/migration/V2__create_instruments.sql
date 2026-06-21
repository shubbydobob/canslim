CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE instruments (
    id                BIGSERIAL PRIMARY KEY,
    ticker            VARCHAR(20)  NOT NULL,
    market            VARCHAR(10)  NOT NULL,
    name              VARCHAR(200) NOT NULL,
    listing_date      DATE,
    float_shares      BIGINT,
    total_shares      BIGINT,
    industry_group_id BIGINT       REFERENCES industry_groups(id),
    sector            VARCHAR(100),
    -- COMMON / PREFERRED / REIT / SPAC / ETF / ETN / OTHER
    security_type     VARCHAR(20)  NOT NULL DEFAULT 'COMMON',
    currency          VARCHAR(3)   NOT NULL DEFAULT 'KRW',
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_instruments_ticker_market UNIQUE (ticker, market)
);
CREATE INDEX idx_instruments_market         ON instruments (market);
CREATE INDEX idx_instruments_industry_group ON instruments (industry_group_id);
CREATE INDEX idx_instruments_active         ON instruments (is_active) WHERE is_active = TRUE;
