package com.canslim.scoring.scorer;

import com.canslim.domain.DerivedMetric;
import com.canslim.domain.MarketConfig;
import org.springframework.stereotype.Component;

/**
 * L — Leader or Laggard (RS 백분위 기반 시장 리더십).
 *
 * 채점:
 *   rs = rsPercentile (0~100, 높을수록 시장 대비 강세)
 *   rsPercentile >= lRsMinPercentile(70) → score = rs
 *   rsPercentile <  lRsMinPercentile     → score = rs × 0.5 (laggard 페널티)
 *
 * null 반환: rsPercentile 누락 (상장 252일 미만 or 가격 데이터 공백).
 *
 * 주의: 상장 252일 미만 신규주는 rsPercentile=NULL — 단기 수익률로 대체하지 말 것.
 */
@Component
public class LScorer {

    public Double score(DerivedMetric dm, MarketConfig cfg) {
        if (dm == null || dm.getRsPercentile() == null) return null;

        double rs    = dm.getRsPercentile().doubleValue();
        double minRs = cfg.getLRsMinPercentile() != null ? cfg.getLRsMinPercentile().doubleValue() : 70.0;

        double score = (rs >= minRs) ? rs : rs * 0.5;
        return Math.min(100.0, Math.max(0.0, score));
    }
}
