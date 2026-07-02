-- ============================================================
-- CANSLIM Screener — PostgreSQL DDL v2
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 1. industry_groups (instruments FK 선행)
-- ============================================================
CREATE TABLE industry_groups (
    id            BIGSERIAL PRIMARY KEY,
    code          VARCHAR(50)  NOT NULL UNIQUE,
    name          VARCHAR(200) NOT NULL,
    market        VARCHAR(10)  NOT NULL,
    parent_sector VARCHAR(100),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_industry_groups_market ON industry_groups (market);

-- ============================================================
-- 2. instruments
-- ============================================================
CREATE TABLE instruments (
    id                BIGSERIAL PRIMARY KEY,
    ticker            VARCHAR(20)  NOT NULL,
    market            VARCHAR(10)  NOT NULL,  -- 'KOSPI','KOSDAQ','NYSE','NASDAQ'
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

-- ============================================================
-- 3. price_daily (연도별 범위 파티션)
-- 2027까지 수동 파티션. 이후 연도는 V3 패턴으로 파티션 추가.
-- ============================================================
CREATE TABLE price_daily (
    id             BIGSERIAL,
    security_id    BIGINT       NOT NULL REFERENCES instruments(id),
    trade_date     DATE         NOT NULL,
    open           NUMERIC(18,4),
    high           NUMERIC(18,4),
    low            NUMERIC(18,4),
    close          NUMERIC(18,4) NOT NULL,
    close_adj      NUMERIC(18,4),
    volume         BIGINT,
    turnover       NUMERIC(22,4),
    is_trading_day BOOLEAN      NOT NULL DEFAULT TRUE,
    PRIMARY KEY (id, trade_date),
    CONSTRAINT uq_price_daily_sec_date UNIQUE (security_id, trade_date)
) PARTITION BY RANGE (trade_date);

CREATE TABLE price_daily_2020 PARTITION OF price_daily FOR VALUES FROM ('2020-01-01') TO ('2021-01-01');
CREATE TABLE price_daily_2021 PARTITION OF price_daily FOR VALUES FROM ('2021-01-01') TO ('2022-01-01');
CREATE TABLE price_daily_2022 PARTITION OF price_daily FOR VALUES FROM ('2022-01-01') TO ('2023-01-01');
CREATE TABLE price_daily_2023 PARTITION OF price_daily FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');
CREATE TABLE price_daily_2024 PARTITION OF price_daily FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE price_daily_2025 PARTITION OF price_daily FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE price_daily_2026 PARTITION OF price_daily FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE price_daily_2027 PARTITION OF price_daily FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

CREATE INDEX idx_price_daily_sec_date ON price_daily (security_id, trade_date DESC);
CREATE INDEX idx_price_daily_date     ON price_daily (trade_date DESC);

-- ============================================================
-- 4. financials — DART 원본만 저장 (누적 그대로)
-- 단독분기값과 YoY는 Python ETL이 derived_metrics에 적재
-- ============================================================
CREATE TABLE financials (
    id               BIGSERIAL PRIMARY KEY,
    security_id      BIGINT      NOT NULL REFERENCES instruments(id),
    period_type      VARCHAR(10) NOT NULL,  -- 'QUARTER', 'ANNUAL'
    fiscal_year      SMALLINT    NOT NULL,
    fiscal_quarter   SMALLINT,
    period_end_date  DATE        NOT NULL,
    report_date      DATE,
    revenue          NUMERIC(22,4),
    operating_income NUMERIC(22,4),
    net_income       NUMERIC(22,4),
    eps              NUMERIC(14,6),         -- DART 원본 EPS
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
CREATE INDEX idx_financials_sec_period    ON financials (security_id, period_type, fiscal_year, fiscal_quarter);
CREATE INDEX idx_financials_period_end    ON financials (security_id, period_end_date DESC);
CREATE INDEX idx_financials_consolidated  ON financials (security_id, is_consolidated DESC, period_end_date DESC);

-- ============================================================
-- 5. derived_metrics
-- Python 담당: eps_* , roe_latest
-- Java 담당: rs_percentile, volume_ratio_20d, pct_from_52w_high, inst_*
-- ============================================================
CREATE TABLE derived_metrics (
    id                      BIGSERIAL PRIMARY KEY,
    security_id             BIGINT    NOT NULL REFERENCES instruments(id),
    as_of_date              DATE      NOT NULL,

    -- Python ETL 담당 (재무)
    eps_standalone_latest   NUMERIC(14,6),
    eps_standalone_prev_yq  NUMERIC(14,6),
    eps_qoq_yoy_pct         NUMERIC(10,4),
    eps_qoq_accel           NUMERIC(10,4),
    eps_3yr_cagr            NUMERIC(10,4),
    eps_annual_consistency  NUMERIC(6,4),
    roe_latest              NUMERIC(8,4),

    -- Java DerivedMetricsJob 담당 (가격)
    pct_from_52w_high       NUMERIC(8,4),
    price_vs_base_breakout  BOOLEAN,
    volume_ratio_20d        NUMERIC(10,4),
    buyback_flag            BOOLEAN DEFAULT FALSE,
    rs_percentile           NUMERIC(6,4),
    industry_rs_rank        INTEGER,
    inst_net_buy_10d        NUMERIC(22,4),
    foreign_net_buy_10d     NUMERIC(22,4),
    program_net_buy_10d     NUMERIC(22,4),
    after_hours_close       NUMERIC(14,2),
    after_hours_change_pct  NUMERIC(8,4),
    inst_trend_flag         SMALLINT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_derived_metrics_sec_date UNIQUE (security_id, as_of_date)
);
CREATE INDEX idx_derived_metrics_sec_date ON derived_metrics (security_id, as_of_date DESC);
CREATE INDEX idx_derived_metrics_date     ON derived_metrics (as_of_date DESC);
CREATE INDEX idx_derived_metrics_rs       ON derived_metrics (as_of_date DESC, rs_percentile DESC);

-- ============================================================
-- 6. canslim_scores — M 서브스코어 없음 (게이트로 분리)
-- ============================================================
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

-- ============================================================
-- 7. industry_scores
-- ============================================================
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

-- ============================================================
-- 8. market_state (M 게이트 전이 지원)
-- ============================================================
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

-- ============================================================
-- 9. ingestion_meta
-- ============================================================
CREATE TABLE ingestion_meta (
    id            BIGSERIAL PRIMARY KEY,
    source_name   VARCHAR(100) NOT NULL,
    market        VARCHAR(10),
    target_date   DATE         NOT NULL,
    status        VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    rows_inserted INTEGER      DEFAULT 0,
    rows_updated  INTEGER      DEFAULT 0,
    error_message TEXT,
    run_id        UUID         NOT NULL DEFAULT gen_random_uuid(),
    CONSTRAINT uq_ingestion_meta_source_date UNIQUE (source_name, target_date)
);
CREATE INDEX idx_ingestion_meta_source ON ingestion_meta (source_name, target_date DESC);
CREATE INDEX idx_ingestion_meta_status ON ingestion_meta (status) WHERE status IN ('PENDING','FAILED');

-- ============================================================
-- 10. market_config (weight_m 없음, CHECK constraint)
-- ============================================================
CREATE TABLE market_config (
    id                       BIGSERIAL PRIMARY KEY,
    market                   VARCHAR(10)  NOT NULL,
    version                  INTEGER      NOT NULL DEFAULT 1,
    is_active                BOOLEAN      NOT NULL DEFAULT TRUE,

    c_eps_growth_threshold   NUMERIC(8,4) DEFAULT 0.25,
    c_use_percentile         BOOLEAN      DEFAULT FALSE,
    c_percentile_min         NUMERIC(6,4),
    c_neg_growth_score_cap   NUMERIC(6,2) DEFAULT 20.0,
    c_accel_max_bonus        NUMERIC(6,2) DEFAULT 20.0,

    a_eps_cagr_threshold     NUMERIC(8,4) DEFAULT 0.25,
    a_roe_min                NUMERIC(8,4) DEFAULT 0.17,
    a_min_years              SMALLINT     DEFAULT 3,

    n_max_pct_from_high      NUMERIC(8,4) DEFAULT 0.10,
    n_breakout_vol_min       NUMERIC(8,4) DEFAULT 1.40,

    s_float_max_billions     NUMERIC(14,4),
    s_vol_surge_threshold    NUMERIC(8,4) DEFAULT 1.50,

    l_rs_min_percentile      NUMERIC(6,4) DEFAULT 80.0,
    l_rs_window_days         SMALLINT     DEFAULT 252,

    i_net_buy_window_days    SMALLINT     DEFAULT 10,
    i_net_buy_threshold      NUMERIC(22,4),

    m_distribution_day_limit SMALLINT     DEFAULT 4,
    m_gate_phases            VARCHAR(50)  DEFAULT 'BEAR',

    -- 가중치 합 = 1.0 (M 제외 6개)
    weight_c                 NUMERIC(6,4) DEFAULT 0.25,
    weight_a                 NUMERIC(6,4) DEFAULT 0.20,
    weight_n                 NUMERIC(6,4) DEFAULT 0.15,
    weight_s                 NUMERIC(6,4) DEFAULT 0.10,
    weight_l                 NUMERIC(6,4) DEFAULT 0.20,
    weight_i                 NUMERIC(6,4) DEFAULT 0.10,

    effective_from           DATE         NOT NULL,
    effective_to             DATE,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_market_config_market_version UNIQUE (market, version),
    -- 새 버전 INSERT 시에만 가중치 합 검증
    CONSTRAINT chk_weights_sum CHECK (
        ABS(weight_c + weight_a + weight_n + weight_s + weight_l + weight_i - 1.0) < 0.001
    )
);
CREATE INDEX idx_market_config_active ON market_config (market, is_active) WHERE is_active = TRUE;
