-- rs_percentile: NUMERIC(6,4) → NUMERIC(7,4)
-- PERCENT_RANK() * 100 의 최대값 100.0000 은 NUMERIC(6,4) 초과 (정수부 3자리 필요)
ALTER TABLE derived_metrics
    ALTER COLUMN rs_percentile TYPE NUMERIC(7, 4);
