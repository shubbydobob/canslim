package com.canslim.scoring.model;

/**
 * 단일 종목 CANSLIM 채점 결과.
 * null score = 해당 팩터 데이터 부족으로 채점 불가.
 * mGateBlocked = true이면 M-게이트에 막혀 모든 score가 null이고 compositeScore = 0.
 */
public record ScoringResult(
        Double cScore,
        Double aScore,
        Double nScore,
        Double sScore,
        Double lScore,
        Double iScore,
        double compositeScore,
        boolean mGateBlocked,
        Double mScore
) {
    public static ScoringResult blocked() {
        return new ScoringResult(null, null, null, null, null, null, 0.0, true, null);
    }
}
