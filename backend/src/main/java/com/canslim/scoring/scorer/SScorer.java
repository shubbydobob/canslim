package com.canslim.scoring.scorer;

import com.canslim.domain.DerivedMetric;
import com.canslim.domain.Instrument;
import com.canslim.domain.MarketConfig;
import org.springframework.stereotype.Component;

/**
 * S — Supply and Demand (유동주식 희소성 + 거래량 급증).
 *
 * 채점:
 *   floatScore  = max(0, 80 × (1 - floatShares / (sFloatMaxBillions × 10^9)))
 *                 null 유동주식 → 40점(중립)
 *   surgeScore  = volumeRatio20d >= sVolSurgeThreshold 이면
 *                 min(20, (ratio - 1) / (threshold - 1) × 20)
 *   최종 = clamp(floatScore + surgeScore, 0, 100)
 *
 * sFloatMaxBillions: 유동주식 상한 (단위: 10억주 또는 사실상 "너무 큰 주식" 기준).
 * KR 컨텍스트: 삼성전자 유동주식 약 60억 주 → threshold 10억으로 설정하면 floatScore = 0.
 */
@Component
public class SScorer {

    public Double score(Instrument instrument, DerivedMetric dm, MarketConfig cfg) {
        double maxFloatShares = cfg.getSFloatMaxBillions() != null
                ? cfg.getSFloatMaxBillions().doubleValue() * 1_000_000_000.0
                : 1_000_000_000.0;
        double surgeThreshold = cfg.getSVolSurgeThreshold() != null
                ? cfg.getSVolSurgeThreshold().doubleValue()
                : 1.5;

        double floatScore;
        if (instrument.getFloatShares() == null) {
            floatScore = 40.0;  // 데이터 없음 → 중립
        } else {
            floatScore = Math.max(0.0, 80.0 * (1.0 - instrument.getFloatShares() / maxFloatShares));
        }

        double surgeScore = 0.0;
        if (dm != null && dm.getVolumeRatio20d() != null) {
            double ratio = dm.getVolumeRatio20d().doubleValue();
            if (ratio >= surgeThreshold && surgeThreshold > 1.0) {
                surgeScore = Math.min(20.0, (ratio - 1.0) / (surgeThreshold - 1.0) * 20.0);
            }
        }

        return Math.min(100.0, Math.max(0.0, floatScore + surgeScore));
    }
}
