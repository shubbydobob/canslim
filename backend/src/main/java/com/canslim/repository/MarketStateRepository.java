package com.canslim.repository;

import com.canslim.domain.MarketState;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface MarketStateRepository extends JpaRepository<MarketState, Long> {

    Optional<MarketState> findTopByMarketOrderByStateDateDesc(String market);

    @Query("SELECT ms FROM MarketState ms WHERE ms.market = :market AND ms.stateDate BETWEEN :from AND :to ORDER BY ms.stateDate ASC")
    List<MarketState> findByMarketAndDateRange(
            @Param("market") String market,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);
}
