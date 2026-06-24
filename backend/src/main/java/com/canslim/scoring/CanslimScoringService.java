package com.canslim.scoring;

import com.canslim.domain.*;
import com.canslim.repository.CanslimScoreRepository;
import com.canslim.repository.InstrumentRepository;
import com.canslim.scoring.model.ScoringResult;
import com.canslim.scoring.port.MarketDataPort;
import com.canslim.scoring.scorer.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/**
 * CANSLIM 채점 서비스.
 *
 * 실행 순서 (ScoringJob 에서 호출):
 *   1. DerivedMetricsJob 완료 후 이 서비스 실행.
 *   2. M-게이트 확인 → BEAR 등 차단 phase이면 전 종목 blocked.
 *   3. 활성 종목 순회 → 각 scorer 호출 → composite 계산.
 *   4. canslim_scores upsert.
 *   5. updateRankings() 호출.
 *
 * composite 계산:
 *   null score는 해당 팩터를 제외하고 남은 가중치로 정규화.
 *   데이터 부족 종목도 가용 팩터 기준 비교 가능한 점수를 부여.
 */
@Service
public class CanslimScoringService {

    private static final Logger log = LoggerFactory.getLogger(CanslimScoringService.class);

    private final List<MarketDataPort> marketAdapters;
    private final CanslimScoreRepository scoreRepository;
    private final MGateChecker mGateChecker;
    private final CScorer cScorer;
    private final AScorer aScorer;
    private final NScorer nScorer;
    private final SScorer sScorer;
    private final LScorer lScorer;
    private final IScorer iScorer;

    public CanslimScoringService(List<MarketDataPort> marketAdapters,
                                 CanslimScoreRepository scoreRepository,
                                 MGateChecker mGateChecker,
                                 CScorer cScorer, AScorer aScorer, NScorer nScorer,
                                 SScorer sScorer, LScorer lScorer, IScorer iScorer) {
        this.marketAdapters  = marketAdapters;
        this.scoreRepository = scoreRepository;
        this.mGateChecker    = mGateChecker;
        this.cScorer = cScorer;
        this.aScorer = aScorer;
        this.nScorer = nScorer;
        this.sScorer = sScorer;
        this.lScorer = lScorer;
        this.iScorer = iScorer;
    }

    /** 전체 시장 채점 실행. ScoringJob에서 호출. */
    @Transactional
    public void scoreAll(LocalDate scoreDate) {
        for (MarketDataPort port : marketAdapters) {
            try {
                scoreMarket(port, scoreDate);
            } catch (Exception e) {
                log.error("[{}] 채점 실패: {}", port.getMarket(), e.getMessage(), e);
            }
        }
    }

    @Transactional
    public void scoreMarket(MarketDataPort port, LocalDate scoreDate) {
        String market = port.getMarket();
        MarketConfig cfg = port.getActiveConfig();

        Optional<MarketState> stateOpt = port.getLatestMarketState();
        boolean blocked = mGateChecker.isBlocked(stateOpt, cfg);

        if (blocked) {
            log.info("[{}] M-게이트 차단 (phase={}). 전 종목 blocked.", market,
                    stateOpt.map(MarketState::getMarketPhase).orElse("UNKNOWN"));
        }

        List<Instrument> instruments = port.getActiveInstruments();
        log.info("[{}] 채점 시작: {}종목 (scoreDate={})", market, instruments.size(), scoreDate);

        // M 점수: 시장 내 52주 고점 -15% 이내 종목 비율 (시장 전체 공통값)
        Double mScore = null;
        try {
            mScore = scoreRepository.computeMarketBreadth(scoreDate, port.getDbMarkets());
            log.info("[{}] M 점수(시장 건전도): {}", market, mScore);
        } catch (Exception e) {
            log.warn("[{}] M 점수 계산 실패: {}", market, e.getMessage());
        }

        int done = 0, skipped = 0;
        for (Instrument inst : instruments) {
            try {
                ScoringResult result;
                if (blocked) {
                    result = ScoringResult.blocked();
                } else {
                    Optional<DerivedMetric> dmOpt =
                            port.getLatestDerivedMetric(inst.getId(), scoreDate);
                    DerivedMetric dm = dmOpt.orElse(null);
                    result = computeScores(inst, dm, cfg);
                }

                scoreRepository.upsert(
                        inst.getId(), scoreDate, market,
                        result.cScore(), result.aScore(), result.nScore(),
                        result.sScore(), result.lScore(), result.iScore(),
                        mScore,
                        result.compositeScore(), cfg.getVersion());
                done++;
            } catch (Exception e) {
                log.warn("[{}] {} 채점 오류: {}", market, inst.getTicker(), e.getMessage());
                skipped++;
            }
        }

        scoreRepository.updateRankings(scoreDate, market);
        log.info("[{}] 채점 완료: {}건 저장, {}건 오류", market, done, skipped);
    }

    private ScoringResult computeScores(Instrument inst, DerivedMetric dm, MarketConfig cfg) {
        Double c = cScorer.score(dm, cfg);
        Double a = aScorer.score(dm, cfg);
        Double n = nScorer.score(dm, cfg);
        Double s = sScorer.score(inst, dm, cfg);
        Double l = lScorer.score(dm, cfg);
        Double i = iScorer.score(dm, cfg);

        double composite = weightedComposite(cfg,
                new double[]{nullOr(c), nullOr(a), nullOr(n), nullOr(s), nullOr(l), nullOr(i)},
                new boolean[]{c != null, a != null, n != null, s != null, l != null, i != null});

        return new ScoringResult(c, a, n, s, l, i, composite, false, null);
    }

    /**
     * null score는 해당 팩터 가중치를 제외하고 남은 가중치 합으로 정규화.
     * 모든 score null → 0 반환.
     */
    private double weightedComposite(MarketConfig cfg, double[] scores, boolean[] present) {
        double[] weights = {
                safeWeight(cfg.getWeightC()),
                safeWeight(cfg.getWeightA()),
                safeWeight(cfg.getWeightN()),
                safeWeight(cfg.getWeightS()),
                safeWeight(cfg.getWeightL()),
                safeWeight(cfg.getWeightI()),
        };

        double sumWScore = 0.0;
        double sumW      = 0.0;
        for (int idx = 0; idx < scores.length; idx++) {
            if (present[idx]) {
                sumWScore += scores[idx] * weights[idx];
                sumW      += weights[idx];
            }
        }
        return sumW == 0.0 ? 0.0 : sumWScore / sumW;
    }

    private double nullOr(Double v) { return v == null ? 0.0 : v; }

    private double safeWeight(java.math.BigDecimal bd) {
        return bd == null ? 0.0 : bd.doubleValue();
    }
}
