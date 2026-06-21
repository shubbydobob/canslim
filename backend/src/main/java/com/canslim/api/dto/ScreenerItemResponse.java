package com.canslim.api.dto;

import com.canslim.domain.CanslimScore;
import com.canslim.domain.Instrument;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * 스크리너 결과 항목 응답 DTO.
 * null score = 해당 팩터 데이터 부족.
 */
public record ScreenerItemResponse(
        Long securityId,
        String ticker,
        String name,
        String market,
        LocalDate scoreDate,
        Integer marketRank,
        BigDecimal marketPercentile,
        BigDecimal compositeScore,
        BigDecimal cScore,
        BigDecimal aScore,
        BigDecimal nScore,
        BigDecimal sScore,
        BigDecimal lScore,
        BigDecimal iScore
) {
    public static ScreenerItemResponse of(CanslimScore score, Instrument inst) {
        return new ScreenerItemResponse(
                inst.getId(),
                inst.getTicker(),
                inst.getName(),
                score.getMarket(),
                score.getScoreDate(),
                score.getMarketRank(),
                score.getMarketPercentile(),
                score.getCompositeScore(),
                score.getCScore(),
                score.getAScore(),
                score.getNScore(),
                score.getSScore(),
                score.getLScore(),
                score.getIScore()
        );
    }
}
