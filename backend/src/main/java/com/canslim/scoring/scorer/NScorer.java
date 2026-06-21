package com.canslim.scoring.scorer;

import com.canslim.domain.DerivedMetric;
import com.canslim.domain.MarketConfig;
import org.springframework.stereotype.Component;

/**
 * N — New Price / Breakout from Base (52주 고점 근접 + 베이스 돌파).
 *
 * 채점:
 *   priceScore = clamp(100 + pctFrom52wHigh × 2.5, 0, 100)
 *                - 고점 대비 0% → 100, -10% → 75, -25% → 37.5, -40% → 0
 *   multiplier = 1.0
 *              + 0.10  if priceVsBaseBreakout = true
 *              + 0.05  if volumeRatio20d >= nBreakoutVolMin
 *   최종 = clamp(priceScore × multiplier, 0, 100)
 *
 * null 반환: pctFrom52wHigh 누락 (52주 가격 데이터 미확보).
 */
@Component
public class NScorer {

    public Double score(DerivedMetric dm, MarketConfig cfg) {
        if (dm == null || dm.getPctFrom52wHigh() == null) return null;

        double pct        = dm.getPctFrom52wHigh().doubleValue();   // 음수 (예: -5.0)
        double volMin     = cfg.getNBreakoutVolMin() != null ? cfg.getNBreakoutVolMin().doubleValue() : 1.5;

        double priceScore = Math.min(100.0, Math.max(0.0, 100.0 + pct * 2.5));

        double multiplier = 1.0;
        if (Boolean.TRUE.equals(dm.getPriceVsBaseBreakout())) {
            multiplier += 0.10;
        }
        if (dm.getVolumeRatio20d() != null
                && dm.getVolumeRatio20d().doubleValue() >= volMin) {
            multiplier += 0.05;
        }

        return Math.min(100.0, Math.max(0.0, priceScore * multiplier));
    }
}
