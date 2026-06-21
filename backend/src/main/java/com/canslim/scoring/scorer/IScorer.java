package com.canslim.scoring.scorer;

import com.canslim.domain.DerivedMetric;
import com.canslim.domain.MarketConfig;
import org.springframework.stereotype.Component;

/**
 * I — Institutional Sponsorship (기관·외국인 순매수).
 *
 * 채점 (기준점 50):
 *   instBuyScore   = clamp((instNetBuy10d  / iNetBuyThreshold) × 30, -30, +30)
 *   foreignScore   = clamp((foreignNetBuy10d / iNetBuyThreshold) × 20, -20, +20)
 *   trendBonus     = instTrendFlag × 5  (-1→-5, 0→0, 1→+5, 2→+10)
 *   최종 = clamp(50 + instBuyScore + foreignScore + trendBonus, 0, 100)
 *
 * 데이터 없음(KR 기관 데이터 미적재 상태) → 50 반환 (중립).
 * iNetBuyThreshold: 유의미한 순매수로 간주할 기준 금액(또는 수량). DB 설정값.
 */
@Component
public class IScorer {

    public Double score(DerivedMetric dm, MarketConfig cfg) {
        // 기관 데이터가 전혀 없으면 null → weightedComposite의 "null 분모 제외" 로직을 탐
        // 50 고정 시 전 종목 상수 +5점이 되어 랭킹이 왜곡됨
        if (dm == null
                || (dm.getInstNetBuy10d() == null
                    && dm.getForeignNetBuy10d() == null
                    && dm.getInstTrendFlag() == null)) {
            return null;
        }

        double threshold = cfg.getINetBuyThreshold() != null
                ? cfg.getINetBuyThreshold().doubleValue()
                : 1.0;

        double instScore = 0.0;
        if (dm.getInstNetBuy10d() != null && threshold != 0) {
            double raw = dm.getInstNetBuy10d().doubleValue() / threshold * 30.0;
            instScore = Math.min(30.0, Math.max(-30.0, raw));
        }

        double foreignScore = 0.0;
        if (dm.getForeignNetBuy10d() != null && threshold != 0) {
            double raw = dm.getForeignNetBuy10d().doubleValue() / threshold * 20.0;
            foreignScore = Math.min(20.0, Math.max(-20.0, raw));
        }

        double trendBonus = 0.0;
        if (dm.getInstTrendFlag() != null) {
            trendBonus = dm.getInstTrendFlag() * 5.0;
        }

        return Math.min(100.0, Math.max(0.0, 50.0 + instScore + foreignScore + trendBonus));
    }
}
