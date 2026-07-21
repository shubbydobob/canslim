package com.nextpick.scoring.job;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Java 담당 DerivedMetric 가격 컬럼 배치 계산.
 *
 * Python ETL이 재무 컬럼(eps_*, roe_latest)을 적재한 뒤,
 * 이 Job이 가격 컬럼을 계산하여 derived_metrics를 보완한다.
 *
 * 계산 항목:
 *   pct_from_52w_high      : (close_adj - 52주 고점) / 52주 고점 × 100  (음수)
 *   price_vs_base_breakout : close_adj > 50일 MA AND 거래량 > 50일 평균 × 1.5
 *   volume_ratio_20d       : 오늘 거래량 / 20일 평균 거래량
 *   rs_percentile          : 252거래일 수익률 PERCENT_RANK() × 100 (시장 내)
 *
 * 설계:
 *   - 종목별 루프 없이 SQL 배치 2쿼리로 처리 (성능).
 *   - 각 쿼리는 DerivedMetricsTxHelper 를 통해 독립 트랜잭션(REQUIRES_NEW) 실행.
 *     → price_metrics 성공 후 rs_percentile 실패해도 price_metrics 커밋 유지.
 *   - score_date 기준 price_daily 행이 없는 종목은 자동 제외.
 */
@Component
public class DerivedMetricsJob {

    private static final Logger log = LoggerFactory.getLogger(DerivedMetricsJob.class);

    private final DerivedMetricsTxHelper txHelper;

    public DerivedMetricsJob(DerivedMetricsTxHelper txHelper) {
        this.txHelper = txHelper;
    }

    /**
     * 채점/파생 기준일을 해당 시장의 실제 마지막 거래일로 앵커링.
     *
     * 배경: 안전망 @Scheduled(21:30 KST)나 admin(LocalDate.now, 서버 UTC)이 KST/UTC '오늘'로
     * 채점하면, 미국장은 그 날짜의 세션이 아직 없어(미 마감) 미래 날짜가 됨 → DerivedMetricsJob이
     * 가격 없는(그리고 inst 없는) 그림자 행을 그 날짜에 만들어 완전한 최신행을 가리고 I 팩터가
     * null이 됨. scoreDate 이하 최신 거래일로 되돌리면 그림자 없이 실제 세션을 멱등 재채점한다.
     * (KR은 당일 세션이 이미 있으므로 보통 scoreDate 그대로.)
     *
     * @return min(scoreDate, 최신 거래일). 가격이 없거나 조회 실패 시 scoreDate 그대로.
     */
    public LocalDate resolveEffectiveDate(List<String> dbMarkets, LocalDate scoreDate) {
        String marketIn = dbMarkets.stream()
                .map(m -> "'" + m + "'")
                .collect(Collectors.joining(","));
        try {
            LocalDate latest = txHelper.latestTradeDate(marketIn, scoreDate);
            return (latest != null && latest.isBefore(scoreDate)) ? latest : scoreDate;
        } catch (Exception e) {
            log.warn("최신 거래일 앵커 조회 실패({}) — scoreDate {} 사용: {}", dbMarkets, scoreDate, e.getMessage());
            return scoreDate;
        }
    }

    /**
     * 지정 시장의 가격 파생 지표 전체 재계산. ScoringJob 에서 먼저 호출.
     *
     * @param market    어댑터 식별자 (예: "KR")
     * @param dbMarkets instruments.market 컬럼 실제 값 목록 (예: ["KOSPI","KOSDAQ"])
     * @param scoreDate 채점 기준일
     */
    public void computeForMarket(String market, List<String> dbMarkets, LocalDate scoreDate) {
        log.info("[{}] DerivedMetricsJob 시작 (scoreDate={}, dbMarkets={})", market, scoreDate, dbMarkets);

        // IN 절용 리터럴 — 내부 코드에서 오는 값이므로 SQL injection 위험 없음
        String marketIn = dbMarkets.stream()
                .map(m -> "'" + m + "'")
                .collect(Collectors.joining(","));

        int priceRows = 0;
        int rsRows    = 0;
        int adRows    = 0;
        try {
            priceRows = txHelper.upsertPriceMetrics(marketIn, scoreDate);
        } catch (Exception e) {
            log.warn("[{}] price_metrics 계산 실패: {}", market, e.getMessage());
        }
        try {
            rsRows = txHelper.upsertRsPercentile(marketIn, scoreDate);
        } catch (Exception e) {
            log.warn("[{}] rs_percentile 계산 실패: {}", market, e.getMessage());
        }
        try {
            adRows = txHelper.upsertAccumDist(marketIn, scoreDate);
        } catch (Exception e) {
            log.warn("[{}] accum_dist 계산 실패: {}", market, e.getMessage());
        }

        log.info("[{}] DerivedMetricsJob 완료 — price_metrics {}건, rs_percentile {}건, accum_dist {}건",
                market, priceRows, rsRows, adRows);
    }
}
