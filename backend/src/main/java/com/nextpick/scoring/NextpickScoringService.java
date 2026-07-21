package com.nextpick.scoring;

import com.nextpick.domain.*;
import com.nextpick.repository.NextpickScoreRepository;
import com.nextpick.repository.InstrumentRepository;
import com.nextpick.scoring.job.DerivedMetricsJob;
import com.nextpick.scoring.model.ScoringResult;
import com.nextpick.scoring.port.MarketDataPort;
import com.nextpick.scoring.scorer.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/**
 * 팩터 채점 서비스.
 *
 * 실행 순서 (ScoringJob 에서 호출):
 *   1. DerivedMetricsJob 완료 후 이 서비스 실행.
 *   2. M-게이트 확인 → BEAR 등 차단 phase이면 전 종목 blocked.
 *   3. 활성 종목 순회 → 각 scorer 호출 → composite 계산.
 *   4. nextpick_scores upsert.
 *   5. updateRankings() 호출.
 *
 * composite 계산:
 *   null score는 해당 팩터를 제외하고 남은 가중치로 정규화.
 *   데이터 부족 종목도 가용 팩터 기준 비교 가능한 점수를 부여.
 */
@Service
public class NextpickScoringService {

    private static final Logger log = LoggerFactory.getLogger(NextpickScoringService.class);

    private final List<MarketDataPort> marketAdapters;
    private final NextpickScoreRepository scoreRepository;
    private final DerivedMetricsJob derivedMetricsJob;
    private final MGateChecker mGateChecker;
    private final CScorer cScorer;
    private final AScorer aScorer;
    private final NScorer nScorer;
    private final SScorer sScorer;
    private final LScorer lScorer;
    private final IScorer iScorer;
    /**
     * 자기 자신의 프록시 참조. scoreAll → scoreMarket 을 프록시 경유로 호출해야
     * REQUIRES_NEW(마켓별 독립 트랜잭션)가 적용된다. 직접 this 호출은 self-invocation
     * 이라 트랜잭션 어드바이스가 무시됨. 생성자 순환을 피하려고 ObjectProvider 로 지연 조회.
     */
    private final ObjectProvider<NextpickScoringService> selfProvider;

    public NextpickScoringService(List<MarketDataPort> marketAdapters,
                                 NextpickScoreRepository scoreRepository,
                                 DerivedMetricsJob derivedMetricsJob,
                                 MGateChecker mGateChecker,
                                 CScorer cScorer, AScorer aScorer, NScorer nScorer,
                                 SScorer sScorer, LScorer lScorer, IScorer iScorer,
                                 ObjectProvider<NextpickScoringService> selfProvider) {
        this.marketAdapters  = marketAdapters;
        this.scoreRepository = scoreRepository;
        this.derivedMetricsJob = derivedMetricsJob;
        this.mGateChecker    = mGateChecker;
        this.cScorer = cScorer;
        this.aScorer = aScorer;
        this.nScorer = nScorer;
        this.sScorer = sScorer;
        this.lScorer = lScorer;
        this.iScorer = iScorer;
        this.selfProvider = selfProvider;
    }

    /**
     * 전체 시장 채점 실행. ScoringJob에서 호출.
     *
     * 마켓별로 독립 트랜잭션(REQUIRES_NEW)으로 분리한다. 한 마켓 실패(예: US
     * 미활성 예외, SQL 오류)가 다른 마켓 커밋을 롤백시키지 않도록 하기 위함.
     * scoreAll 자체는 트랜잭션 없이 오케스트레이션만 담당한다.
     */
    public void scoreAll(LocalDate scoreDate) {
        NextpickScoringService self = selfProvider.getObject();
        for (MarketDataPort port : marketAdapters) {
            String market = port.getMarket();

            // 채점일을 시장별 실제 최신 거래일로 앵커링(파생 단계와 동일). 미래 날짜의
            // 그림자 점수행(inst null → I 사망, MAX(score_date) 왜곡) 생성을 방지.
            LocalDate eff = derivedMetricsJob.resolveEffectiveDate(port.getDbMarkets(), scoreDate);
            if (!eff.equals(scoreDate)) {
                log.info("[{}] 채점일 {} → 최신 거래일 {} 앵커", market, scoreDate, eff);
            }

            // 1) 점수 산출 + 랭킹 — 마켓 단위 독립 트랜잭션
            try {
                self.scoreMarket(port, eff);
            } catch (Exception e) {
                log.error("[{}] 채점 실패 (해당 마켓만 롤백): {}", market, e.getMessage(), e);
                continue; // 점수 커밋 실패 시 스냅샷은 무의미
            }

            // 2) 가격 스냅샷 — 점수 커밋 후 별도 트랜잭션(비치명적).
            //    같은 트랜잭션에 두면 스냅샷 실패가 그 마켓 점수를 롤백시키므로 분리.
            try {
                self.updatePriceSnapshot(eff, market);
                log.info("[{}] 가격 스냅샷 적재 완료", market);
            } catch (Exception e) {
                log.warn("[{}] 가격 스냅샷 적재 실패 (비치명적): {}", market, e.getMessage());
            }
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
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

    /**
     * 가격 스냅샷 일괄 적재 (정렬 인덱스용). 점수 커밋 후 별도 트랜잭션에서 실행되므로
     * 실패해도 이미 저장된 점수에는 영향이 없다(비치명적).
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void updatePriceSnapshot(LocalDate scoreDate, String market) {
        scoreRepository.updatePriceSnapshot(scoreDate, market);
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

        // completeness discount: 핵심 재무 팩터 누락 시 감산
        double discount = 0.0;
        if (c == null) discount += 5.0;   // 분기실적 누락
        if (a == null) discount += 3.0;   // 연간성장 누락
        composite = Math.max(0.0, composite - discount);

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
