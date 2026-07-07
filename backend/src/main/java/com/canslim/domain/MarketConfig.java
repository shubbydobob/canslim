package com.canslim.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "market_config")
public class MarketConfig {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 10)
    private String market;

    @Column(nullable = false)
    private Integer version;

    @Column(name = "is_active", nullable = false)
    private boolean active;

    // C
    @Column(name = "c_eps_growth_threshold")
    private BigDecimal cEpsGrowthThreshold;
    @Column(name = "c_use_percentile")
    private boolean cUsePercentile;
    @Column(name = "c_neg_growth_score_cap")
    private BigDecimal cNegGrowthScoreCap;
    @Column(name = "c_accel_max_bonus")
    private BigDecimal cAccelMaxBonus;

    // A
    @Column(name = "a_eps_cagr_threshold")
    private BigDecimal aEpsCagrThreshold;
    @Column(name = "a_roe_min")
    private BigDecimal aRoeMin;
    @Column(name = "a_min_years")
    private Short aMinYears;

    // N
    @Column(name = "n_max_pct_from_high")
    private BigDecimal nMaxPctFromHigh;
    @Column(name = "n_breakout_vol_min")
    private BigDecimal nBreakoutVolMin;

    // S
    @Column(name = "s_cap_max_tril")
    private BigDecimal sCapMaxTril;
    @Column(name = "s_vol_surge_threshold")
    private BigDecimal sVolSurgeThreshold;

    // L
    @Column(name = "l_rs_min_percentile")
    private BigDecimal lRsMinPercentile;
    @Column(name = "l_rs_window_days")
    private Short lRsWindowDays;

    // I
    @Column(name = "i_net_buy_window_days")
    private Short iNetBuyWindowDays;
    @Column(name = "i_net_buy_threshold")
    private BigDecimal iNetBuyThreshold;

    // M (게이트)
    @Column(name = "m_gate_phases", length = 50)
    private String mGatePhases;

    // 가중치 (6개, 합=1.0)
    @Column(name = "weight_c")
    private BigDecimal weightC;
    @Column(name = "weight_a")
    private BigDecimal weightA;
    @Column(name = "weight_n")
    private BigDecimal weightN;
    @Column(name = "weight_s")
    private BigDecimal weightS;
    @Column(name = "weight_l")
    private BigDecimal weightL;
    @Column(name = "weight_i")
    private BigDecimal weightI;

    /** m_gate_phases 문자열 파싱 → 게이트 대상 phase 목록 */
    public java.util.Set<String> getGatePhaseSet() {
        if (mGatePhases == null || mGatePhases.isBlank()) return java.util.Set.of();
        return java.util.Arrays.stream(mGatePhases.split(","))
                .map(String::trim).collect(java.util.stream.Collectors.toSet());
    }

    // getters
    public String getMarket() { return market; }
    public Integer getVersion() { return version; }
    public boolean isActive() { return active; }
    public BigDecimal getCEpsGrowthThreshold() { return cEpsGrowthThreshold; }
    public boolean isCUsePercentile() { return cUsePercentile; }
    public BigDecimal getCNegGrowthScoreCap() { return cNegGrowthScoreCap; }
    public BigDecimal getCAccelMaxBonus() { return cAccelMaxBonus; }
    public BigDecimal getAEpsCagrThreshold() { return aEpsCagrThreshold; }
    public BigDecimal getARoeMin() { return aRoeMin; }
    public Short getAMinYears() { return aMinYears; }
    public BigDecimal getNMaxPctFromHigh() { return nMaxPctFromHigh; }
    public BigDecimal getNBreakoutVolMin() { return nBreakoutVolMin; }
    public BigDecimal getSCapMaxTril() { return sCapMaxTril; }
    public BigDecimal getSVolSurgeThreshold() { return sVolSurgeThreshold; }
    public BigDecimal getLRsMinPercentile() { return lRsMinPercentile; }
    public Short getLRsWindowDays() { return lRsWindowDays; }
    public Short getINetBuyWindowDays() { return iNetBuyWindowDays; }
    public BigDecimal getINetBuyThreshold() { return iNetBuyThreshold; }
    public String getMGatePhases() { return mGatePhases; }
    public BigDecimal getWeightC() { return weightC; }
    public BigDecimal getWeightA() { return weightA; }
    public BigDecimal getWeightN() { return weightN; }
    public BigDecimal getWeightS() { return weightS; }
    public BigDecimal getWeightL() { return weightL; }
    public BigDecimal getWeightI() { return weightI; }
}
