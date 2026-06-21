CREATE TABLE derived_metrics (
    id                      BIGSERIAL PRIMARY KEY,
    security_id             BIGINT    NOT NULL REFERENCES instruments(id),
    as_of_date              DATE      NOT NULL,
    eps_standalone_latest   NUMERIC(14,6),
    eps_standalone_prev_yq  NUMERIC(14,6),
    eps_qoq_yoy_pct         NUMERIC(10,4),
    eps_qoq_accel           NUMERIC(10,4),
    eps_3yr_cagr            NUMERIC(10,4),
    eps_annual_consistency  NUMERIC(6,4),
    roe_latest              NUMERIC(8,4),
    pct_from_52w_high       NUMERIC(8,4),
    price_vs_base_breakout  BOOLEAN,
    volume_ratio_20d        NUMERIC(10,4),
    buyback_flag            BOOLEAN DEFAULT FALSE,
    rs_percentile           NUMERIC(6,4),
    industry_rs_rank        INTEGER,
    inst_net_buy_10d        NUMERIC(22,4),
    foreign_net_buy_10d     NUMERIC(22,4),
    inst_trend_flag         SMALLINT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_derived_metrics_sec_date UNIQUE (security_id, as_of_date)
);
CREATE INDEX idx_derived_metrics_sec_date ON derived_metrics (security_id, as_of_date DESC);
CREATE INDEX idx_derived_metrics_date     ON derived_metrics (as_of_date DESC);
CREATE INDEX idx_derived_metrics_rs       ON derived_metrics (as_of_date DESC, rs_percentile DESC);
