-- US 시장 채점 활성화
-- V11에서 is_active=FALSE로 시드된 US market_config를 활성화한다.
-- 활성화 후 UsMarketDataAdapter.getActiveConfig()가 성공하고,
-- NextpickScoringService.scoreAll이 US 마켓을 독립 트랜잭션으로 채점한다.
--
-- 주의: US instruments/price_daily/financials/derived_metrics 데이터가 ETL로
-- 적재되기 전에는 US 종목 0건으로 채점(무해). 백필 후 정상 산출.
UPDATE market_config SET is_active = TRUE WHERE market = 'US';
