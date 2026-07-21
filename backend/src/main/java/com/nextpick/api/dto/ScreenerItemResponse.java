package com.nextpick.api.dto;

import com.nextpick.domain.NextpickScore;
import com.nextpick.domain.Instrument;

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
        Integer baseDays,
        String[] statuses,   // 거래정지·주의·경고·위험·과열·관리·정리매매 (없으면 null)
        BigDecimal per,      // KIS EOD 밸류에이션 스냅샷 (장외 폴백; 장중엔 실시간 오버레이)
        BigDecimal pbr,
        BigDecimal eps,
        BigDecimal bps,
        String exchange      // US 전용: KIS EXCD(NAS/NYS/AMS). KR은 null. 프론트 TradingView 심볼 프리픽스용.
) {
    /** idx: [0]=close [1]=inst [2]=foreign [3]=changeRate [4]=52wHigh [5]=volume [6]=turnover [7]=marketCap [8]=program [9]=ahClose [10]=ahChg [11]=per [12]=pbr [13]=eps [14]=bps */
    public static ScreenerItemResponse of(NextpickScore score, Instrument inst, BigDecimal[] pf, String[] statuses) {
        return new ScreenerItemResponse(
                inst.getId(), inst.getTicker(), inst.getName(),
                score.getMarket(), score.getScoreDate(),
                score.getMarketRank(), score.getMarketPercentile(),
                score.getCompositeScore(),
                score.getCScore(), score.getAScore(), score.getNScore(),
                score.getSScore(), score.getLScore(), score.getIScore(), score.getMScore(),
                pf[0], pf[3], pf[4], pf[5], pf[6], pf[1], pf[2], pf[8], pf[9], pf[10], pf[7],
                inst.getSector(), null, false, null, statuses,
                pf[11], pf[12], pf[13], pf[14], inst.getExchange()
        );
    }

    public static ScreenerItemResponse of(NextpickScore score, Instrument inst, BigDecimal[] pf, BigDecimal scoreDelta, String[] statuses) {
        return new ScreenerItemResponse(
                inst.getId(), inst.getTicker(), inst.getName(),
                score.getMarket(), score.getScoreDate(),
                score.getMarketRank(), score.getMarketPercentile(),
                score.getCompositeScore(),
                score.getCScore(), score.getAScore(), score.getNScore(),
                score.getSScore(), score.getLScore(), score.getIScore(), score.getMScore(),
                pf[0], pf[3], pf[4], pf[5], pf[6], pf[1], pf[2], pf[8], pf[9], pf[10], pf[7],
                inst.getSector(), scoreDelta, false, null, statuses,
                pf[11], pf[12], pf[13], pf[14], inst.getExchange()
        );
    }

    public static ScreenerItemResponse of(NextpickScore score, Instrument inst, BigDecimal[] pf,
                                          BigDecimal scoreDelta, boolean breakoutToday, Integer baseDays,
                                          String[] statuses) {
        return new ScreenerItemResponse(
                inst.getId(), inst.getTicker(), inst.getName(),
                score.getMarket(), score.getScoreDate(),
                score.getMarketRank(), score.getMarketPercentile(),
                score.getCompositeScore(),
                score.getCScore(), score.getAScore(), score.getNScore(),
                score.getSScore(), score.getLScore(), score.getIScore(), score.getMScore(),
                pf[0], pf[3], pf[4], pf[5], pf[6], pf[1], pf[2], pf[8], pf[9], pf[10], pf[7],
                inst.getSector(), scoreDelta, breakoutToday, baseDays, statuses,
                pf[11], pf[12], pf[13], pf[14], inst.getExchange()
        );
    }
}
