package com.canslim.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "financials")
public class Financial {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "security_id", nullable = false)
    private Long securityId;

    @Column(name = "period_type", nullable = false, length = 10)
    private String periodType;    // QUARTER / ANNUAL

    @Column(name = "fiscal_year", nullable = false)
    private Short fiscalYear;

    @Column(name = "fiscal_quarter")
    private Short fiscalQuarter;

    @Column(name = "period_end_date", nullable = false)
    private LocalDate periodEndDate;

    @Column(name = "report_date")
    private LocalDate reportDate;

    private BigDecimal revenue;

    @Column(name = "operating_income")
    private BigDecimal operatingIncome;

    @Column(name = "net_income")
    private BigDecimal netIncome;

    /** DART 원본 EPS. KR 누적분기면 누적값. 단독분기값은 derived_metrics 참조. */
    private BigDecimal eps;

    @Column(name = "shares_diluted")
    private Long sharesDiluted;

    private BigDecimal roe;

    /**
     * KR DART 누적 여부. TRUE면 Q2=H1, Q3=9M 누적.
     * 단독분기 변환은 Python ETL이 담당 → derived_metrics에 적재.
     */
    @Column(name = "is_cumulative", nullable = false)
    private boolean cumulative;

    /** TRUE=연결, FALSE=별도. 스코어링 시 연결 우선 사용. */
    @Column(name = "is_consolidated", nullable = false)
    private boolean consolidated;

    @Column(nullable = false, length = 3)
    private String currency;

    @Column(name = "data_source", length = 50)
    private String dataSource;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public Long getSecurityId() { return securityId; }
    public String getPeriodType() { return periodType; }
    public Short getFiscalYear() { return fiscalYear; }
    public Short getFiscalQuarter() { return fiscalQuarter; }
    public LocalDate getPeriodEndDate() { return periodEndDate; }
    public BigDecimal getEps() { return eps; }
    public BigDecimal getRoe() { return roe; }
    public boolean isCumulative() { return cumulative; }
    public boolean isConsolidated() { return consolidated; }
    public String getCurrency() { return currency; }
}
