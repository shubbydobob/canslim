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
