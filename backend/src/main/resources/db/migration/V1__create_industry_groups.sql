CREATE TABLE industry_groups (
    id            BIGSERIAL PRIMARY KEY,
    code          VARCHAR(50)  NOT NULL UNIQUE,
    name          VARCHAR(200) NOT NULL,
    market        VARCHAR(10)  NOT NULL,
    parent_sector VARCHAR(100),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_industry_groups_market ON industry_groups (market);
