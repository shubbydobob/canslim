package com.canslim.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;

@Entity
@Table(name = "market_state")
public class MarketState {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 10)
    private String market;

    @Column(name = "state_date", nullable = false)
    private LocalDate stateDate;

    @Column(name = "index_close")
    private BigDecimal indexClose;
    @Column(name = "index_close_adj")
    private BigDecimal indexCloseAdj;
    @Column(name = "ma_50d")
    private BigDecimal ma50d;
    @Column(name = "ma_200d")
    private BigDecimal ma200d;
    @Column(name = "distribution_day_count")
    private Short distributionDayCount;
    @Column(name = "distribution_day_today")
    private Boolean distributionDayToday;
    @Column(name = "rally_day_count")
    private Short rallyDayCount;
    @Column(name = "trend_direction", length = 10)
    private String trendDirection;  // UP / DOWN / SIDEWAYS
    @Column(name = "market_phase", length = 20)
    private String marketPhase;     // BULL / CORRECTION / RALLY_ATTEMPT / BEAR
    @Column(name = "prev_phase", length = 20)
    private String prevPhase;
    private String notes;

    public String getMarket() { return market; }
    public LocalDate getStateDate() { return stateDate; }
    public BigDecimal getIndexClose() { return indexClose; }
    public BigDecimal getMa50d() { return ma50d; }
    public BigDecimal getMa200d() { return ma200d; }
    public Short getDistributionDayCount() { return distributionDayCount; }
    public Boolean getDistributionDayToday() { return distributionDayToday; }
    public Short getRallyDayCount() { return rallyDayCount; }
    public String getTrendDirection() { return trendDirection; }
    public String getMarketPhase() { return marketPhase; }
    public String getPrevPhase() { return prevPhase; }
}
