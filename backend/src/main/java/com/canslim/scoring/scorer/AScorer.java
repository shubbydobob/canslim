package com.canslim.scoring.scorer;

import com.canslim.domain.DerivedMetric;
import com.canslim.domain.MarketConfig;
import org.springframework.stereotype.Component;

/**
 * A — Annual Earnings Growth (연간 EPS 성장·안정성).
 *
 * 채점:
 *   cagrScore    = clamp((cagr / aEpsCagrThreshold) × 70, 0, 70)
 *                  threshold(25%)에서 70점. 50% CAGR → 100점 기준치.
 *   consistency  = epsAnnualConsistency × 15   (0~1 → 0~15점)
 *   roeBonus     = roeLatest >= aRoeMin(17%) 이면 +15점
 *   최종 = clamp(cagrScore + consistency + roeBonus, 0, 100)
 *
 * null 반환: eps3yrCagr 누락 (3년 연간 데이터 미확보).
 */
@Component
public class AScorer {

    public Double score(DerivedMetric dm, MarketConfig cfg) {
        if (dm == null || dm.getEps3yrCagr() == null) return null;

        double cagr      = dm.getEps3yrCagr().doubleValue();
        double threshold = cfg.getAEpsCagrThreshold() != null ? cfg.getAEpsCagrThreshold().doubleValue() : 0.25;
        double roeMin    = cfg.getARoeMin()            != null ? cfg.getARoeMin().doubleValue()           : 0.17;

        double cagrScore = 0.0;
        if (threshold > 0) {
            cagrScore = Math.min(70.0, Math.max(0.0, (cagr / threshold) * 70.0));
        }

        double consistency = 0.0;
        if (dm.getEpsAnnualConsistency() != null) {
            consistency = dm.getEpsAnnualConsistency().doubleValue() * 15.0;
        }

        double roeBonus = 0.0;
        if (dm.getRoeLatest() != null && dm.getRoeLatest().doubleValue() >= roeMin) {
            roeBonus = 15.0;
        }

        return Math.min(100.0, Math.max(0.0, cagrScore + consistency + roeBonus));
    }
}
