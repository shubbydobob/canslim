-- Accumulation/Distribution 점수 — I(기관 스폰서십) 팩터의 가격·거래량 기반 실시간 프록시.
-- 미국엔 무료 일별 기관 순매수 공시가 없어 I가 13F(분기·45일 지연)에만 의존했다. 오닐/IBD의
-- Accumulation-Distribution Rating(상승일 대량=기관 매집+, 하락일 대량=분산-)을 price_daily로
-- 매일 계산해 I를 분기→일 단위로 신선화하고, 13F 결측 종목(예: CBOE)의 I null도 제거한다.
-- Java DerivedMetricsJob이 rs_percentile과 같은 위치에서 채점 시마다 계산(시장 무관, scoreDate 앵커).
-- 0~100 (50=중립). IScorer US 분기가 13F ownership과 0.5:0.5 블렌드.
ALTER TABLE derived_metrics
    ADD COLUMN IF NOT EXISTS accum_dist_score NUMERIC(6,2);
