package com.canslim.repository;

import com.canslim.domain.Instrument;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface InstrumentRepository extends JpaRepository<Instrument, Long> {

    Optional<Instrument> findByTickerAndMarket(String ticker, String market);

    List<Instrument> findByMarketAndActiveTrue(String market);

    List<Instrument> findByMarketInAndActiveTrue(List<String> markets);

    @Query("SELECT i FROM Instrument i WHERE i.market IN :markets AND i.active = TRUE ORDER BY i.id")
    List<Instrument> findActiveByMarkets(@Param("markets") List<String> markets);
}
