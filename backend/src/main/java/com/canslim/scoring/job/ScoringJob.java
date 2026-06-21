package com.canslim.scoring.job;

import com.canslim.scoring.CanslimScoringService;
import com.canslim.scoring.port.MarketDataPort;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

/**
 * 일별 CANSLIM 채점 스케줄러.
 *
 * 실행 순서:
 *   1. DerivedMetricsJob  — 시장별 가격 파생 지표 계산 (RS%, 52W high, 거래량 비율)
 *   2. CanslimScoringService — C/A/N/S/L/I 점수 산출 + composite + 랭킹 갱신
 *
 * KR 스케줄: 평일 18:30 (KST = UTC+9 → cron UTC 09:30)
 *   - KOSPI/KOSDAQ 정규장 15:30 종료 후 충분한 여유.
 *   - pykrx ETL이 16:00~18:00 사이 price_daily 적재 완료 전제.
 *
 * 수동 실행: runNow(date) 직접 호출 (관리자 API 또는 테스트용).
 */
@Component
public class ScoringJob {

    private static final Logger log = LoggerFactory.getLogger(ScoringJob.class);

    private final DerivedMetricsJob derivedMetricsJob;
    private final CanslimScoringService scoringService;
    private final List<MarketDataPort> marketAdapters;

    public ScoringJob(DerivedMetricsJob derivedMetricsJob,
                      CanslimScoringService scoringService,
                      List<MarketDataPort> marketAdapters) {
        this.derivedMetricsJob = derivedMetricsJob;
        this.scoringService    = scoringService;
        this.marketAdapters    = marketAdapters;
    }

    /** 평일 18:30 KST (= 09:30 UTC) 자동 실행 */
    @Scheduled(cron = "0 30 9 * * MON-FRI", zone = "UTC")
    public void scheduledRun() {
        runNow(LocalDate.now());
    }

    /** 수동/테스트 실행 진입점 */
    public void runNow(LocalDate scoreDate) {
        log.info("=== ScoringJob 시작 (scoreDate={}) ===", scoreDate);
        long t0 = System.currentTimeMillis();

        // Step 1: 가격 파생 지표 (시장별)
        for (MarketDataPort port : marketAdapters) {
            try {
                derivedMetricsJob.computeForMarket(port.getMarket(), port.getDbMarkets(), scoreDate);
            } catch (Exception e) {
                log.error("[{}] DerivedMetricsJob 실패: {}", port.getMarket(), e.getMessage(), e);
            }
        }

        // Step 2: CANSLIM 채점
        scoringService.scoreAll(scoreDate);

        long elapsed = System.currentTimeMillis() - t0;
        log.info("=== ScoringJob 완료 ({} ms) ===", elapsed);
    }
}
