package com.canslim.scoring.scorer;

import com.canslim.domain.DerivedMetric;
import com.canslim.domain.MarketConfig;
import org.springframework.stereotype.Component;

/**
 * C — Current Quarterly Earnings (당분기 EPS YoY 성장률).
 *
 * 채점:
 *   base  = clamp(20 + yoyPct × 0.8, negCap, 100)
 *           yoy=0%→20, threshold(25%)→40, 100%→100
 *   accel = 가속도 보너스: accel>0 이면 min(cAccelMaxBonus, cAccelMaxBonus × accel/30)
 *   최종  = clamp(base + accel, 0, 100)
 *
 * null 반환 조건: epsQoqYoyPct 누락 (분기 데이터 공백).
 */
@Component
public class CScorer {

    public Double score(DerivedMetric dm, MarketConfig cfg) {
        if (dm == null || dm.getEpsQoqYoyPct() == null) return null;

        double yoy     = dm.getEpsQoqYoyPct().doubleValue();
        double negCap  = cfg.getCNegGrowthScoreCap() != null ? cfg.getCNegGrowthScoreCap().doubleValue() : 0.0;
        double maxBonus= cfg.getCAccelMaxBonus()      != null ? cfg.getCAccelMaxBonus().doubleValue()     : 10.0;

        double base = 20.0 + yoy * 0.8;
        base = Math.min(100.0, Math.max(negCap, base));

        double accel = 0.0;
        if (dm.getEpsQoqAccel() != null) {
            double a = dm.getEpsQoqAccel().doubleValue();
            if (a > 0) {
                accel = Math.min(maxBonus, maxBonus * a / 30.0);
            }
        }

        return Math.min(100.0, Math.max(0.0, base + accel));
    }
}
