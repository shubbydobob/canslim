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
        BigDecimal iScore,
        BigDecimal mScore,
        BigDecimal closePrice,
        BigDecimal changeRate,
        BigDecimal weekHigh52,
        BigDecimal volume,
        BigDecimal turnover,
        BigDecimal instNetBuy10d,
        BigDecimal foreignNetBuy10d,
        BigDecimal programNetBuy10d,
        BigDecimal afterHoursPrice,
        BigDecimal afterHoursChangeRate,
        BigDecimal marketCap,
        String sector,
        BigDecimal scoreDelta,
        boolean breakoutToday,
        Integer baseDays
) {
    /** idx: [0]=close [1]=inst [2]=foreign [3]=changeRate [4]=52wHigh [5]=volume [6]=turnover [7]=marketCap [8]=program [9]=ahClose [10]=ahChg */
    public static ScreenerItemResponse of(CanslimScore score, Instrument inst, BigDecimal[] pf) {
        return new ScreenerItemResponse(
                inst.getId(), inst.getTicker(), inst.getName(),
                score.getMarket(), score.getScoreDate(),
                score.getMarketRank(), score.getMarketPercentile(),
                score.getCompositeScore(),
                score.getCScore(), score.getAScore(), score.getNScore(),
                score.getSScore(), score.getLScore(), score.getIScore(), score.getMScore(),
                pf[0], pf[3], pf[4], pf[5], pf[6], pf[1], pf[2], pf[8], pf[9], pf[10], pf[7],
                inst.getSector(), null, false, null
        );
    }

    public static ScreenerItemResponse of(CanslimScore score, Instrument inst, BigDecimal[] pf, BigDecimal scoreDelta) {
        return new ScreenerItemResponse(
                inst.getId(), inst.getTicker(), inst.getName(),
                score.getMarket(), score.getScoreDate(),
                score.getMarketRank(), score.getMarketPercentile(),
                score.getCompositeScore(),
                score.getCScore(), score.getAScore(), score.getNScore(),
                score.getSScore(), score.getLScore(), score.getIScore(), score.getMScore(),
                pf[0], pf[3], pf[4], pf[5], pf[6], pf[1], pf[2], pf[8], pf[9], pf[10], pf[7],
                inst.getSector(), scoreDelta, false, null
        );
    }

    public static ScreenerItemResponse of(CanslimScore score, Instrument inst, BigDecimal[] pf,
                                          BigDecimal scoreDelta, boolean breakoutToday, Integer baseDays) {
        return new ScreenerItemResponse(
                inst.getId(), inst.getTicker(), inst.getName(),
                score.getMarket(), score.getScoreDate(),
                score.getMarketRank(), score.getMarketPercentile(),
                score.getCompositeScore(),
                score.getCScore(), score.getAScore(), score.getNScore(),
                score.getSScore(), score.getLScore(), score.getIScore(), score.getMScore(),
                pf[0], pf[3], pf[4], pf[5], pf[6], pf[1], pf[2], pf[8], pf[9], pf[10], pf[7],
                inst.getSector(), scoreDelta, breakoutToday, baseDays
        );
    }
}
