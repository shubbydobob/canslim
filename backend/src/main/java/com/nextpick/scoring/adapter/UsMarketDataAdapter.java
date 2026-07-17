package com.nextpick.scoring.adapter;

import com.nextpick.domain.*;
import com.nextpick.repository.*;
import com.nextpick.scoring.port.MarketDataPort;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/**
 * US 시장 어댑터 (NYSE + NASDAQ, S&P500 + Nasdaq100 MVP).
 *
 * 설계 원칙(KrMarketDataAdapter 미러):
 * - DB 읽기 전용. 재무 변환 없음(Python ETL이 derived_metrics에 적재).
 * - securityId 기반 조회는 KR과 동일 리포지토리 재사용(시장 무관).
 * - market 식별자 매핑: 논리="US", instruments.market="US", 벤치마크=SPX.
 *
 * US MVP 한계:
 * - 기관 수급(I 팩터): 무료 일별 소스 없음(13F 분기 지연) → Optional.empty(). I 점수 null.
 * - 거래일 캘린더: US 종목 price_daily의 DISTINCT trade_date(findUsTradingDates).
 * - 실시간 시세: 이번 단계 미포함(다음 단계 KIS 해외주식 API).
 */
@Component("usMarketDataAdapter")
public class UsMarketDataAdapter implements MarketDataPort {

    private static final List<String> US_MARKETS = List.of("US");
    private static final String US_BENCHMARK = "SPX";

    private final InstrumentRepository instrumentRepo;
    private final PriceDailyRepository priceRepo;
    private final FinancialRepository financialRepo;
    private final MarketStateRepository marketStateRepo;
    private final MarketConfigRepository configRepo;
    private final DerivedMetricRepository derivedMetricRepo;

    public UsMarketDataAdapter(
            InstrumentRepository instrumentRepo,
            PriceDailyRepository priceRepo,
            FinancialRepository financialRepo,
            MarketStateRepository marketStateRepo,
            MarketConfigRepository configRepo,
            DerivedMetricRepository derivedMetricRepo) {
        this.instrumentRepo = instrumentRepo;
        this.priceRepo = priceRepo;
        this.financialRepo = financialRepo;
        this.marketStateRepo = marketStateRepo;
        this.configRepo = configRepo;
        this.derivedMetricRepo = derivedMetricRepo;
    }

    @Override
    public String getMarket() { return "US"; }

    @Override
    public List<String> getDbMarkets() { return US_MARKETS; }

    @Override
    public List<Instrument> getActiveInstruments() {
        return instrumentRepo.findByMarketInAndActiveTrue(US_MARKETS);
    }

    @Override
    public List<LocalDate> getTradingCalendar(LocalDate from, LocalDate to) {
        return priceRepo.findUsTradingDates(from, to);
    }

    @Override
    public List<PriceDaily> getPriceHistory(Long securityId, LocalDate from, LocalDate to) {
        return priceRepo.findBySecurityIdAndDateRange(securityId, from, to);
    }

    @Override
    public List<PriceDaily> getRecentPrices(Long securityId, int tradingDays) {
        return priceRepo.findRecentN(securityId, tradingDays);
    }

    @Override
    public List<Financial> getQuarterlyFinancials(Long securityId, int quarters) {
        return financialRepo.findQuarterlyConsolidatedFirst(securityId, quarters);
    }

    @Override
    public List<Financial> getAnnualFinancials(Long securityId, int years) {
        return financialRepo.findAnnualConsolidatedFirst(securityId, years);
    }

    @Override
    public Optional<MarketState> getLatestMarketState() {
        return marketStateRepo.findTopByMarketOrderByStateDateDesc(US_BENCHMARK);
    }

    @Override
    public List<MarketState> getMarketStateHistory(LocalDate from, LocalDate to) {
        return marketStateRepo.findByMarketAndDateRange(US_BENCHMARK, from, to);
    }

    /**
     * US MVP: 기관 수급 미지원(무료 일별 소스 없음). I 점수는 null 처리.
     */
    @Override
    public Optional<InstitutionalFlow> getInstitutionalFlow(Long securityId, int days) {
        return Optional.empty();
    }

    @Override
    public MarketConfig getActiveConfig() {
        return configRepo.findByMarketAndActiveTrue("US")
                .orElseThrow(() -> new IllegalStateException(
                        "US 활성 market_config 없음. V21 마이그레이션(is_active=TRUE) 확인 필요."));
    }

    @Override
    public Optional<Double> get52WeekHigh(Long securityId, LocalDate scoringDate) {
        return priceRepo.findMaxCloseAdj(securityId, scoringDate.minusYears(1), scoringDate);
    }

    @Override
    public Optional<Double> getAverageVolume(Long securityId, int tradingDays) {
        return priceRepo.findAvgVolumeRecentN(securityId, tradingDays);
    }

    @Override
    public boolean isTradingDay(LocalDate date) {
        return !priceRepo.findUsTradingDates(date, date).isEmpty();
    }

    @Override
    public Optional<DerivedMetric> getLatestDerivedMetric(Long securityId, LocalDate asOfDate) {
        return derivedMetricRepo.findLatestBySecurityIdAndDate(securityId, asOfDate);
    }
}
