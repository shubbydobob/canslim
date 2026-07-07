package com.canslim.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "derived_metrics")
public class DerivedMetric {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "security_id", nullable = false)
    private Long securityId;

    @Column(name = "as_of_date", nullable = false)
    private LocalDate asOfDate;

    // Python ETL 담당 (재무)
    @Column(name = "eps_standalone_latest")
    private BigDecimal epsStandaloneLatest;
    @Column(name = "eps_standalone_prev_yq")
    private BigDecimal epsStandalonePrevYq;
    /**
     * 단독분기 EPS YoY 성장률. Python ETL이 적재.
     * 함정: Q1 누락 시 Q2 단독분기 계산 불가 → NULL. 절대 0으로 대체하지 말 것.
     */
    @Column(name = "eps_qoq_yoy_pct")
    private BigDecimal epsQoqYoyPct;
    /**
     * 가속도 = 이번Q YoY - 직전Q YoY. 두 분기 모두 standalone 존재할 때만 유효.
     */
    @Column(name = "eps_qoq_accel")
    private BigDecimal epsQoqAccel;
    @Column(name = "eps_3yr_cagr")
    private BigDecimal eps3yrCagr;
    @Column(name = "eps_annual_consistency")
    private BigDecimal epsAnnualConsistency;
    @Column(name = "roe_latest")
    private BigDecimal roeLatest;

    // Java DerivedMetricsJob 담당 (가격)
    /**
     * 52주 고점 대비 위치. close_adj 기준.
     * 함정: close_adj 미조정 시 분할 종목 왜곡. Phase 3에서 수정.
     */
    @Column(name = "pct_from_52w_high")
    private BigDecimal pctFrom52wHigh;
    @Column(name = "price_vs_base_breakout")
    private Boolean priceVsBaseBreakout;
    @Column(name = "volume_ratio_20d")
    private BigDecimal volumeRatio20d;
    /**
     * RS 백분위. close_adj 기준 252일 수익률로 계산.
     * 함정: 상장 252일 미만 신규주 → NULL. 단기 수익률로 대체 금지.
     */
    @Column(name = "rs_percentile")
    private BigDecimal rsPercentile;
    @Column(name = "market_cap_tril")
    private BigDecimal marketCapTril;

    @Column(name = "inst_net_buy_10d")
    private BigDecimal instNetBuy10d;
    @Column(name = "foreign_net_buy_10d")
    private BigDecimal foreignNetBuy10d;
    @Column(name = "inst_trend_flag")
    private Short instTrendFlag;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    public Long getSecurityId() { return securityId; }
    public LocalDate getAsOfDate() { return asOfDate; }
    public BigDecimal getEpsQoqYoyPct() { return epsQoqYoyPct; }
    public BigDecimal getEpsQoqAccel() { return epsQoqAccel; }
    public BigDecimal getEps3yrCagr() { return eps3yrCagr; }
    public BigDecimal getEpsAnnualConsistency() { return epsAnnualConsistency; }
    public BigDecimal getRoeLatest() { return roeLatest; }
    public BigDecimal getPctFrom52wHigh() { return pctFrom52wHigh; }
    public Boolean getPriceVsBaseBreakout() { return priceVsBaseBreakout; }
    public BigDecimal getVolumeRatio20d() { return volumeRatio20d; }
    public BigDecimal getRsPercentile() { return rsPercentile; }
    public BigDecimal getMarketCapTril() { return marketCapTril; }
    public BigDecimal getInstNetBuy10d() { return instNetBuy10d; }
    public BigDecimal getForeignNetBuy10d() { return foreignNetBuy10d; }
    public Short getInstTrendFlag() { return instTrendFlag; }
}
