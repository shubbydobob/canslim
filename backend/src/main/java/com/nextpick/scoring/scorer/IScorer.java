package com.nextpick.scoring.scorer;

import com.nextpick.domain.DerivedMetric;
import com.nextpick.domain.MarketConfig;
import org.springframework.stereotype.Component;

/**
 * I — Institutional Sponsorship (기관 스폰서십).
 *
 * ── KR (일별 외인/기관 순매수) — 채점 (기준점 50):
 *   instBuyScore   = clamp((instNetBuy10d  / iNetBuyThreshold) × 30, -30, +30)
 *   foreignScore   = clamp((foreignNetBuy10d / iNetBuyThreshold) × 20, -20, +20)
 *   trendBonus     = instTrendFlag × 5  (-1→-5, 0→0, 1→+5, 2→+10)
 *   최종 = clamp(50 + instBuyScore + foreignScore + trendBonus, 0, 100)
 *
 * ── US (13F 분기 기관보유 + A/D 실시간 프록시 블렌드) — 채점 (기준점 50):
 *   ownership      = clamp(50 + clamp((instPctHeld-0.5)×40,±20) + clamp(breadth/10×15,±15), 0,100)
 *   accum          = accumDistScore (0~100, DerivedMetricsJob가 price·volume로 매일 계산)
 *   최종 = 13F 있으면 0.5·ownership + 0.5·accum,  13F 없으면(예: CBOE) accum 단독.
 *   근거: US는 일별 기관 플로우가 무료로 없어 13F(분기·45일 지연)만으론 느림. 오닐/IBD의
 *   Accumulation-Distribution(가격·거래량 매집 추정)을 블렌드해 I를 분기→일 단위로 신선화하고
 *   13F 결측 종목의 I null도 제거. (진짜 실시간 기관 순매수는 유료 소스 필요.)
 *
 * ── 폴백: 13F·KR순매수 모두 없어도 accum이 있으면 accum 단독(가격만 있으면 I 산출). 전부 없으면 null.
 * 데이터 없음 → null 반환. weightedComposite의 "null 분모 제외"로 정규화(50 고정 시 랭킹 왜곡).
 * iNetBuyThreshold: 유의미한 순매수로 간주할 기준 금액(또는 수량). DB 설정값.
 */
@Component
public class IScorer {

    public Double score(DerivedMetric dm, MarketConfig cfg) {
        if (dm == null) return null;

        // A/D 실시간 프록시(가격·거래량). 시장 무관으로 채워짐. US 블렌드/폴백에 사용.
        Double accum = dm.getAccumDistScore() != null ? dm.getAccumDistScore().doubleValue() : null;

        // ── US 13F 분기 (inst_pct_held가 채워진 종목) + A/D 블렌드 ──
        if (dm.getInstPctHeld() != null) {
            double pct = dm.getInstPctHeld().doubleValue();          // 0~1
            double ownershipScore = clamp((pct - 0.5) * 40.0, -20.0, 20.0);
            double breadthScore = 0.0;
            if (dm.getInstAccumBreadth() != null) {
                breadthScore = clamp(dm.getInstAccumBreadth() / 10.0 * 15.0, -15.0, 15.0);
            }
            double ownership = clamp(50.0 + ownershipScore + breadthScore, 0.0, 100.0);
            // 구조적 13F + 실시간 A/D 반반 블렌드. accum 없으면 ownership 단독.
            return accum != null ? clamp(0.5 * ownership + 0.5 * accum, 0.0, 100.0) : ownership;
        }

        // ── KR 일별 순매수 — 데이터가 전혀 없으면 A/D 폴백, 그것도 없으면 null ──
        if (dm.getInstNetBuy10d() == null
                && dm.getForeignNetBuy10d() == null
                && dm.getInstTrendFlag() == null) {
            return accum;  // 가격만 있으면 A/D 단독(예: US CBOE 13F 결측) — I null 제거. 전부 없으면 null.
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

    private static double clamp(double v, double lo, double hi) {
        return Math.min(hi, Math.max(lo, v));
    }
}
