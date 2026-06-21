package com.canslim.scoring.adapter;

import com.canslim.domain.*;
import com.canslim.repository.*;
import com.canslim.scoring.port.MarketDataPort;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

/**
 * KR 시장 어댑터 (KOSPI + KOSDAQ).
 *
 * 설계 원칙:
 * - DB 읽기 전용. 재무 변환 없음.
 * - 누적→단독분기 변환, EPS YoY 계산은 Python ETL 전담 → derived_metrics에 있음.
 * - getQuarterlyFinancials()는 DART 원본 그대로 반환 (스코어러는 사용 안 함).
 * - 스코어러는 getLatestDerivedMetric()으로 eps_qoq_yoy_pct 등을 읽음.
 *
 * KR 특이사항:
 * - KOSPI + KOSDAQ 양쪽을 "KR" 시장 식별자 하나로 통합.
 * - 시장 상태(M 게이트): KOSPI 지수를 KR 벤치마크로 사용.
 * - 기관 데이터 한계: 투자자유형 순매수 (pykrx). 펀드별 보유 아님.
 */
@Component("krMarketDataAdapter")
public class KrMarketDataAdapter implements MarketDataPort {

    private static final List<String> KR_MARKETS = List.of("KOSPI", "KOSDAQ");
    private static final String KR_BENCHMARK = "KOSPI";

    private final InstrumentRepository instrumentRepo;
    private final PriceDailyRepository priceRepo;
    private final FinancialRepository financialRepo;
    private final MarketStateRepository marketStateRepo;
    private final MarketConfigRepository configRepo;
    private final DerivedMetricRepository derivedMetricRepo;

    public KrMarketDataAdapter(
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
    public String getMarket() { return "KR"; }

    @Override
    public List<String> getDbMarkets() { return KR_MARKETS; }

    @Override
    public List<Instrument> getActiveInstruments() {
        return instrumentRepo.findByMarketInAndActiveTrue(KR_MARKETS);
    }

    @Override
    public List<LocalDate> getTradingCalendar(LocalDate from, LocalDate to) {
        return priceRepo.findKrxTradingDates(from, to);
    }

    @Override
    public List<PriceDaily> getPriceHistory(Long securityId, LocalDate from, LocalDate to) {
        return priceRepo.findBySecurityIdAndDateRange(securityId, from, to);
    }

    @Override
    public List<PriceDaily> getRecentPrices(Long securityId, int tradingDays) {
        return priceRepo.findRecentN(securityId, tradingDays);
    }

    /**
     * DART 원본 분기 재무 반환 (변환 없음).
     * 연결 우선, 없으면 별도.
     * 스코어러는 이 메서드 대신 getLatestDerivedMetric()의 eps_qoq_yoy_pct를 사용.
     */
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
        return marketStateRepo.findTopByMarketOrderByStateDateDesc(KR_BENCHMARK);
    }

    @Override
    public List<MarketState> getMarketStateHistory(LocalDate from, LocalDate to) {
        return marketStateRepo.findByMarketAndDateRange(KR_BENCHMARK, from, to);
    }

    @Override
    public Optional<InstitutionalFlow> getInstitutionalFlow(Long securityId, int days) {
        return derivedMetricRepo.findLatestBySecurityIdAndDate(securityId, LocalDate.now())
                .map(dm -> new InstitutionalFlow(
                        securityId, days,
                        dm.getInstNetBuy10d(),
                        dm.getForeignNetBuy10d(),
                        dm.getInstTrendFlag() != null ? dm.getInstTrendFlag() : 0));
    }

    @Override
    public MarketConfig getActiveConfig() {
        return configRepo.findByMarketAndActiveTrue("KR")
                .orElseThrow(() -> new IllegalStateException(
                        "KR 활성 market_config 없음. V11 마이그레이션 확인 필요."));
    }

    @Override
    public Optional<Double> get52WeekHigh(Long securityId, LocalDate scoringDate) {
        // close_adj 기준. 함정: 수정주가 미조정 시 분할 종목 왜곡 (Phase 3에서 수정).
        return priceRepo.findMaxCloseAdj(securityId, scoringDate.minusYears(1), scoringDate);
    }

    @Override
    public Optional<Double> getAverageVolume(Long securityId, int tradingDays) {
        return priceRepo.findAvgVolumeRecentN(securityId, tradingDays);
    }

    @Override
    public boolean isTradingDay(LocalDate date) {
        List<LocalDate> dates = priceRepo.findKrxTradingDates(date, date);
        return !dates.isEmpty();
    }

    @Override
    public Optional<DerivedMetric> getLatestDerivedMetric(Long securityId, LocalDate asOfDate) {
        return derivedMetricRepo.findLatestBySecurityIdAndDate(securityId, asOfDate);
    }
}
