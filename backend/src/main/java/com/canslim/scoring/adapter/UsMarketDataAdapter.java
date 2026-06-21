package com.canslim.scoring.adapter;

import com.canslim.domain.*;
import com.canslim.scoring.port.MarketDataPort;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

/**
 * US 시장 어댑터 — Phase 5 구현 예정. 현재 컴파일 통과 스텁.
 *
 * US 실구현 시 처리할 사항:
 * - yfinance 가격 로더 (NYSE/NASDAQ 캘린더)
 * - SEC EDGAR 재무 (10-Q, 10-K; 단독분기, 누적 변환 불필요)
 * - 13F 기관 데이터 (분기 지연, 펀드별 상세)
 * - S&P500/Nasdaq M 팩터
 * - USD 환율 (KR 병렬 표시 시)
 */
@Component("usMarketDataAdapter")
public class UsMarketDataAdapter implements MarketDataPort {

    @Override
    public String getMarket() { return "US"; }

    @Override
    public List<String> getDbMarkets() { return List.of("US"); }

    @Override
    public List<Instrument> getActiveInstruments() {
        return Collections.emptyList();
    }

    @Override
    public List<LocalDate> getTradingCalendar(LocalDate from, LocalDate to) {
        throw new UnsupportedOperationException("US ETL Phase 5 미구현");
    }

    @Override
    public List<PriceDaily> getPriceHistory(Long securityId, LocalDate from, LocalDate to) {
        throw new UnsupportedOperationException("US ETL Phase 5 미구현");
    }

    @Override
    public List<PriceDaily> getRecentPrices(Long securityId, int tradingDays) {
        throw new UnsupportedOperationException("US ETL Phase 5 미구현");
    }

    @Override
    public List<Financial> getQuarterlyFinancials(Long securityId, int quarters) {
        throw new UnsupportedOperationException("US ETL Phase 5 미구현");
    }

    @Override
    public List<Financial> getAnnualFinancials(Long securityId, int years) {
        throw new UnsupportedOperationException("US ETL Phase 5 미구현");
    }

    @Override
    public Optional<MarketState> getLatestMarketState() {
        return Optional.empty();
    }

    @Override
    public List<MarketState> getMarketStateHistory(LocalDate from, LocalDate to) {
        return Collections.emptyList();
    }

    @Override
    public Optional<InstitutionalFlow> getInstitutionalFlow(Long securityId, int days) {
        return Optional.empty();
    }

    @Override
    public MarketConfig getActiveConfig() {
        throw new UnsupportedOperationException("US market_config Phase 4에서 활성화");
    }

    @Override
    public Optional<Double> get52WeekHigh(Long securityId, LocalDate scoringDate) {
        throw new UnsupportedOperationException("US ETL Phase 5 미구현");
    }

    @Override
    public Optional<Double> getAverageVolume(Long securityId, int tradingDays) {
        throw new UnsupportedOperationException("US ETL Phase 5 미구현");
    }

    @Override
    public boolean isTradingDay(LocalDate date) {
        throw new UnsupportedOperationException("US 캘린더 Phase 5 미구현");
    }

    @Override
    public Optional<DerivedMetric> getLatestDerivedMetric(Long securityId, LocalDate asOfDate) {
        return Optional.empty();
    }
}
