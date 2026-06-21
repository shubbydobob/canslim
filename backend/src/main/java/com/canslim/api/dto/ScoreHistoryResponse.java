package com.canslim.api.dto;

import com.canslim.domain.CanslimScore;

import java.math.BigDecimal;
import java.time.LocalDate;

/** 단일 종목 점수 히스토리 항목. */
public record ScoreHistoryResponse(
        LocalDate scoreDate,
        BigDecimal compositeScore,
        Integer marketRank,
        BigDecimal marketPercentile,
        BigDecimal cScore,
        BigDecimal aScore,
        BigDecimal nScore,
        BigDecimal sScore,
        BigDecimal lScore,
        BigDecimal iScore
) {
    public static ScoreHistoryResponse of(CanslimScore s) {
        return new ScoreHistoryResponse(
                s.getScoreDate(), s.getCompositeScore(),
                s.getMarketRank(), s.getMarketPercentile(),
                s.getCScore(), s.getAScore(), s.getNScore(),
                s.getSScore(), s.getLScore(), s.getIScore()
        );
    }
}
