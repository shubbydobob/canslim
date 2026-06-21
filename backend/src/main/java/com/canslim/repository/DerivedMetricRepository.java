package com.canslim.repository;

import com.canslim.domain.DerivedMetric;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDate;
import java.util.Optional;

public interface DerivedMetricRepository extends JpaRepository<DerivedMetric, Long> {

    @Query("SELECT d FROM DerivedMetric d WHERE d.securityId = :sid AND d.asOfDate <= :date ORDER BY d.asOfDate DESC LIMIT 1")
    Optional<DerivedMetric> findLatestBySecurityIdAndDate(
            @Param("sid") Long securityId,
            @Param("date") LocalDate date);
}
