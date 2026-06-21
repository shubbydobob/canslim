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
