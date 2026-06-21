package com.canslim.api.dto;

import com.canslim.domain.DerivedMetric;
import com.canslim.domain.Instrument;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * 종목 상세 응답 DTO — 기본 정보 + 최신 파생 지표.
 */
public record InstrumentDetailResponse(
        Long id,
        String ticker,
        String name,
        String market,
        String sector,
        String securityType,
        Long floatShares,
        Long totalShares,
        LocalDate listingDate,

        // derived_metrics (최신)
        LocalDate metricsDate,
        BigDecimal epsQoqYoyPct,
        BigDecimal epsQoqAccel,
        BigDecimal eps3yrCagr,
        BigDecimal epsAnnualConsistency,
        BigDecimal roeLatest,
        BigDecimal pctFrom52wHigh,
        Boolean priceVsBaseBreakout,
        BigDecimal volumeRatio20d,
        BigDecimal rsPercentile
) {
    public static InstrumentDetailResponse of(Instrument inst, DerivedMetric dm) {
        if (dm == null) {
            return new InstrumentDetailResponse(
                    inst.getId(), inst.getTicker(), inst.getName(),
                    inst.getMarket(), inst.getSector(), inst.getSecurityType(),
                    inst.getFloatShares(), inst.getTotalShares(), inst.getListingDate(),
                    null, null, null, null, null, null, null, null, null, null
            );
        }
        return new InstrumentDetailResponse(
                inst.getId(), inst.getTicker(), inst.getName(),
                inst.getMarket(), inst.getSector(), inst.getSecurityType(),
                inst.getFloatShares(), inst.getTotalShares(), inst.getListingDate(),
                dm.getAsOfDate(),
                dm.getEpsQoqYoyPct(), dm.getEpsQoqAccel(),
                dm.getEps3yrCagr(), dm.getEpsAnnualConsistency(), dm.getRoeLatest(),
                dm.getPctFrom52wHigh(), dm.getPriceVsBaseBreakout(),
                dm.getVolumeRatio20d(), dm.getRsPercentile()
        );
    }
}
