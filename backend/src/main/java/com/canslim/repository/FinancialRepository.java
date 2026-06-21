package com.canslim.repository;

import com.canslim.domain.Financial;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface FinancialRepository extends JpaRepository<Financial, Long> {

    /**
     * 분기 재무 조회 — 연결 우선, 없으면 별도.
     * 함정: 같은 분기에 연결/별도 모두 있을 수 있음. 연결(is_consolidated=TRUE) 우선 필터.
     */
    @Query(value = """
        SELECT * FROM financials
        WHERE security_id = :sid AND period_type = 'QUARTER'
          AND is_consolidated = (
              SELECT MAX(is_consolidated::int)::boolean FROM financials
              WHERE security_id = :sid AND period_type = 'QUARTER'
          )
        ORDER BY period_end_date DESC
        LIMIT :n
        """, nativeQuery = true)
    List<Financial> findQuarterlyConsolidatedFirst(
            @Param("sid") Long securityId, @Param("n") int n);

    @Query(value = """
        SELECT * FROM financials
        WHERE security_id = :sid AND period_type = 'ANNUAL'
          AND is_consolidated = (
              SELECT MAX(is_consolidated::int)::boolean FROM financials
              WHERE security_id = :sid AND period_type = 'ANNUAL'
          )
        ORDER BY fiscal_year DESC
        LIMIT :n
        """, nativeQuery = true)
    List<Financial> findAnnualConsolidatedFirst(
            @Param("sid") Long securityId, @Param("n") int n);
}
