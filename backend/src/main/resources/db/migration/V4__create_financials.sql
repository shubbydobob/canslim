CREATE TABLE financials (
    id               BIGSERIAL PRIMARY KEY,
    security_id      BIGINT      NOT NULL REFERENCES instruments(id),
    period_type      VARCHAR(10) NOT NULL,
    fiscal_year      SMALLINT    NOT NULL,
    fiscal_quarter   SMALLINT,
    period_end_date  DATE        NOT NULL,
    report_date      DATE,
    revenue          NUMERIC(22,4),
    operating_income NUMERIC(22,4),
    net_income       NUMERIC(22,4),
    eps              NUMERIC(14,6),
    shares_diluted   BIGINT,
    roe              NUMERIC(8,4),
    is_cumulative    BOOLEAN     NOT NULL DEFAULT FALSE,
    is_consolidated  BOOLEAN     NOT NULL DEFAULT TRUE,
    currency         VARCHAR(3)  NOT NULL DEFAULT 'KRW',
    data_source      VARCHAR(50),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_financials_raw
        UNIQUE (security_id, period_type, fiscal_year, fiscal_quarter,
                is_consolidated, is_cumulative)
);
CREATE INDEX idx_financials_sec_period   ON financials (security_id, period_type, fiscal_year, fiscal_quarter);
CREATE INDEX idx_financials_period_end   ON financials (security_id, period_end_date DESC);
CREATE INDEX idx_financials_consolidated ON financials (security_id, is_consolidated DESC, period_end_date DESC);
