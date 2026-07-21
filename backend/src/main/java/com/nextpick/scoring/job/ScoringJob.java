package com.nextpick.scoring.job;

import com.nextpick.scoring.NextpickScoringService;
import com.nextpick.scoring.port.MarketDataPort;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

/**
 * 일별 팩터 채점 스케줄러.
 *
 * 실행 순서:
 *   1. DerivedMetricsJob  — 시장별 가격 파생 지표 계산 (RS%, 52W high, 거래량 비율)
 *   2. NextpickScoringService — C/A/N/S/L/I 점수 산출 + composite + 랭킹 갱신
 *
 * KR 스케줄: 평일 21:30 KST (안전망 재채점)
 *   - ETL(run_daily) 20:05 KST 실행 → 시간외 단일가 마감(20:00) 후 확정 종가/상태 적재.
 *   - run_daily 말미에 채점을 직접 트리거하므로, 이 @Scheduled는 그 트리거가
 *     실패했을 때를 대비한 안전망. 20:05 파이프라인 완료 후 돌도록 21:30에 배치.
 *
 * 수동 실행: runNow(date) 직접 호출 (관리자 API 또는 테스트용).
 */
@Component
public class ScoringJob {

    private static final Logger log = LoggerFactory.getLogger(ScoringJob.class);

    private final DerivedMetricsJob derivedMetricsJob;
    private final NextpickScoringService scoringService;
    private final List<MarketDataPort> marketAdapters;

    public ScoringJob(DerivedMetricsJob derivedMetricsJob,
                      NextpickScoringService scoringService,
                      List<MarketDataPort> marketAdapters) {
        this.derivedMetricsJob = derivedMetricsJob;
        this.scoringService    = scoringService;
        this.marketAdapters    = marketAdapters;
    }

    /** 평일 21:30 KST 자동 재채점(안전망) — ETL(20:05 KST) 완료 후. run_daily의 채점 트리거 실패 대비. */
    @Scheduled(cron = "0 30 21 * * MON-FRI", zone = "Asia/Seoul")
    public void scheduledRun() {
        runNow(LocalDate.now(java.time.ZoneId.of("Asia/Seoul")));
    }

    /** 수동/테스트 실행 진입점 */
    public void runNow(LocalDate scoreDate) {
        log.info("=== ScoringJob 시작 (scoreDate={}) ===", scoreDate);
        long t0 = System.currentTimeMillis();

        // Step 1: 가격 파생 지표 (시장별) — 채점일을 시장별 실제 최신 거래일로 앵커링.
        //   미장은 KST/UTC '오늘'이 아직 미 마감이라 미래 날짜가 되어 그림자 행을 만드는 것을 방지.
        for (MarketDataPort port : marketAdapters) {
            LocalDate eff = derivedMetricsJob.resolveEffectiveDate(port.getDbMarkets(), scoreDate);
            if (!eff.equals(scoreDate)) {
                log.info("[{}] 파생 기준일 {} → 최신 거래일 {} 앵커", port.getMarket(), scoreDate, eff);
            }
            try {
                derivedMetricsJob.computeForMarket(port.getMarket(), port.getDbMarkets(), eff);
            } catch (Exception e) {
                log.error("[{}] DerivedMetricsJob 실패: {}", port.getMarket(), e.getMessage(), e);
            }
        }

        // Step 2: 팩터 채점
        scoringService.scoreAll(scoreDate);

        long elapsed = System.currentTimeMillis() - t0;
        log.info("=== ScoringJob 완료 ({} ms) ===", elapsed);
    }
}
