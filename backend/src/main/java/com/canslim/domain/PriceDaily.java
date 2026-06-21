package com.canslim.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;

@Entity
@Table(name = "price_daily")
public class PriceDaily {

    @EmbeddedId
    private PriceDailyId id;

    @Column(name = "security_id", insertable = false, updatable = false)
    private Long securityId;

    @Column(name = "trade_date", insertable = false, updatable = false)
    private LocalDate tradeDate;

    private BigDecimal open;
    private BigDecimal high;
    private BigDecimal low;
    private BigDecimal close;

    /**
     * 수정주가. 현재는 close와 동일(미조정).
     * 함정: 수정주가 미적용 시 분할 종목 RS 계산 왜곡. Phase 3에서 수정.
     */
    @Column(name = "close_adj")
    private BigDecimal closeAdj;

    private Long volume;
    private BigDecimal turnover;

    @Column(name = "is_trading_day")
    private boolean tradingDay;

    public Long getSecurityId() { return securityId; }
    public LocalDate getTradeDate() { return tradeDate; }
    public BigDecimal getOpen() { return open; }
    public BigDecimal getHigh() { return high; }
    public BigDecimal getLow() { return low; }
    public BigDecimal getClose() { return close; }
    public BigDecimal getCloseAdj() { return closeAdj; }
    public Long getVolume() { return volume; }
    public BigDecimal getTurnover() { return turnover; }
    public boolean isTradingDay() { return tradingDay; }

    @Embeddable
    public static class PriceDailyId implements java.io.Serializable {
        @Column(name = "id")
        private Long id;
        @Column(name = "trade_date")
        private LocalDate tradeDate;

        public PriceDailyId() {}
        public PriceDailyId(Long id, LocalDate tradeDate) {
            this.id = id;
            this.tradeDate = tradeDate;
        }
    }
}
