package com.canslim.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "canslim_scores")
public class CanslimScore {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "security_id", nullable = false)
    private Long securityId;

    @Column(name = "score_date", nullable = false)
    private LocalDate scoreDate;

    @Column(nullable = false, length = 10)
    private String market;

    @Column(name = "c_score", precision = 6, scale = 2) private BigDecimal cScore;
    @Column(name = "a_score", precision = 6, scale = 2) private BigDecimal aScore;
    @Column(name = "n_score", precision = 6, scale = 2) private BigDecimal nScore;
    @Column(name = "s_score", precision = 6, scale = 2) private BigDecimal sScore;
    @Column(name = "l_score", precision = 6, scale = 2) private BigDecimal lScore;
    @Column(name = "i_score", precision = 6, scale = 2) private BigDecimal iScore;
    @Column(name = "m_score", precision = 6, scale = 2) private BigDecimal mScore;

    @Column(name = "composite_score", nullable = false, precision = 6, scale = 2)
    private BigDecimal compositeScore;

    @Column(name = "market_rank")      private Integer marketRank;
    @Column(name = "market_percentile") private BigDecimal marketPercentile;
    @Column(name = "config_version")   private Integer configVersion;

    // 가격 스냅샷 (ScoringJob이 채점 후 price_daily에서 복사)
    @Column(name = "close_price")  private BigDecimal closePrice;
    @Column(name = "prev_close")   private BigDecimal prevClose;
    @Column(name = "change_rate")  private BigDecimal changeRate;
    @Column(name = "volume")       private Long priceVolume;
    @Column(name = "turnover")     private BigDecimal turnover;
    @Column(name = "market_cap")   private BigDecimal marketCap;

    @Column(name = "created_at")       private LocalDateTime createdAt;

    // ── factory ──────────────────────────────────────────────
    public static CanslimScore of(Long securityId, LocalDate scoreDate, String market,
                                  Double cScore, Double aScore, Double nScore,
                                  Double sScore, Double lScore, Double iScore,
                                  double compositeScore, Integer configVersion) {
        CanslimScore s = new CanslimScore();
        s.securityId     = securityId;
        s.scoreDate      = scoreDate;
        s.market         = market;
        s.cScore         = bd(cScore);
        s.aScore         = bd(aScore);
        s.nScore         = bd(nScore);
        s.sScore         = bd(sScore);
        s.lScore         = bd(lScore);
        s.iScore         = bd(iScore);
        s.compositeScore = BigDecimal.valueOf(compositeScore);
        s.configVersion  = configVersion;
        s.createdAt      = LocalDateTime.now();
        return s;
    }

    private static BigDecimal bd(Double v) {
        return v == null ? null : BigDecimal.valueOf(v);
    }

    // ── getters ──────────────────────────────────────────────
    public Long getId()               { return id; }
    public Long getSecurityId()       { return securityId; }
    public LocalDate getScoreDate()   { return scoreDate; }
    public String getMarket()         { return market; }
    public BigDecimal getCScore()     { return cScore; }
    public BigDecimal getAScore()     { return aScore; }
    public BigDecimal getNScore()     { return nScore; }
    public BigDecimal getSScore()     { return sScore; }
    public BigDecimal getLScore()     { return lScore; }
    public BigDecimal getIScore()     { return iScore; }
    public BigDecimal getMScore()     { return mScore; }
    public BigDecimal getCompositeScore() { return compositeScore; }
    public void setMScore(BigDecimal m) { this.mScore = m; }
    public Integer getMarketRank()    { return marketRank; }
    public BigDecimal getMarketPercentile() { return marketPercentile; }
    public Integer getConfigVersion() { return configVersion; }

    public BigDecimal getClosePrice()  { return closePrice; }
    public BigDecimal getPrevClose()   { return prevClose; }
    public BigDecimal getChangeRate()  { return changeRate; }
    public Long getPriceVolume()       { return priceVolume; }
    public BigDecimal getTurnover()    { return turnover; }
    public BigDecimal getMarketCap()   { return marketCap; }

    public void setMarketRank(Integer rank)              { this.marketRank = rank; }
    public void setMarketPercentile(BigDecimal pct)      { this.marketPercentile = pct; }
    public void setClosePrice(BigDecimal v)  { this.closePrice = v; }
    public void setPrevClose(BigDecimal v)   { this.prevClose = v; }
    public void setChangeRate(BigDecimal v)  { this.changeRate = v; }
    public void setPriceVolume(Long v)       { this.priceVolume = v; }
    public void setTurnover(BigDecimal v)    { this.turnover = v; }
    public void setMarketCap(BigDecimal v)   { this.marketCap = v; }
}
