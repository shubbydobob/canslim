package com.nextpick.domain;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "instruments")
public class Instrument {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 20)
    private String ticker;

    @Column(nullable = false, length = 10)
    private String market;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "listing_date")
    private LocalDate listingDate;

    @Column(name = "float_shares")
    private Long floatShares;

    @Column(name = "total_shares")
    private Long totalShares;

    /** US 실시간(KIS 해외주식) 조회용 거래소코드 EXCD: NAS/NYS/AMS. KR은 null. */
    @Column(length = 8)
    private String exchange;

/** COMMON / PREFERRED / REIT / SPAC / ETF / ETN / OTHER */
    @Column(name = "security_type", nullable = false, length = 20)
    private String securityType;

    @Column(length = 100)
    private String sector;

    @Column(nullable = false, length = 3)
    private String currency;

    @Column(name = "is_active", nullable = false)
    private boolean active;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public String getTicker() { return ticker; }
    public String getMarket() { return market; }
    public String getName() { return name; }
    public LocalDate getListingDate() { return listingDate; }
    public Long getFloatShares() { return floatShares; }
    public Long getTotalShares() { return totalShares; }
    public String getExchange() { return exchange; }
public String getSecurityType() { return securityType; }
    public String getSector() { return sector; }
    public String getCurrency() { return currency; }
    public boolean isActive() { return active; }
}
