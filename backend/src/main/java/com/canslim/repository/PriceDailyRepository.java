package com.canslim.repository;

import com.canslim.domain.PriceDaily;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface PriceDailyRepository extends JpaRepository<PriceDaily, PriceDaily.PriceDailyId> {

    @Query("""
        SELECT p FROM PriceDaily p
        WHERE p.securityId = :sid AND p.tradeDate BETWEEN :from AND :to
        ORDER BY p.tradeDate ASC
        """)
    List<PriceDaily> findBySecurityIdAndDateRange(
            @Param("sid") Long securityId,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    @Query(value = """
        SELECT * FROM price_daily
        WHERE security_id = :sid
        ORDER BY trade_date DESC
        LIMIT :n
        """, nativeQuery = true)
    List<PriceDaily> findRecentN(@Param("sid") Long securityId, @Param("n") int n);

    @Query(value = """
        SELECT MAX(close_adj) FROM price_daily
        WHERE security_id = :sid AND trade_date BETWEEN :from AND :to
        """, nativeQuery = true)
    Optional<Double> findMaxCloseAdj(
            @Param("sid") Long securityId,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    @Query(value = """
        SELECT AVG(volume) FROM (
            SELECT volume FROM price_daily
            WHERE security_id = :sid
            ORDER BY trade_date DESC
            LIMIT :n
        ) sub
        """, nativeQuery = true)
    Optional<Double> findAvgVolumeRecentN(@Param("sid") Long securityId, @Param("n") int n);

    @Query(value = """
        SELECT DISTINCT trade_date FROM price_daily
        WHERE security_id = (
            SELECT id FROM instruments WHERE ticker='1001' AND market='KOSPI' LIMIT 1
        ) AND trade_date BETWEEN :from AND :to
        ORDER BY trade_date ASC
        """, nativeQuery = true)
    List<LocalDate> findKrxTradingDates(
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    boolean existsBySecurityIdAndTradeDate(Long securityId, LocalDate tradeDate);
}
