-- canslim_scores.m_score: CanslimScore entity 및 ScoringService에서 사용 중이나 DDL에서 누락됨
ALTER TABLE canslim_scores ADD COLUMN m_score NUMERIC(6,2);
