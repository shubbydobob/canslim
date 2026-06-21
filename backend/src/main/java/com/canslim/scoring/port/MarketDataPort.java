package com.canslim.scoring.port;

import com.canslim.domain.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/**
 * 시장 데이터 접근 인터페이스.
 *
 * 설계 원칙:
 * - DB 읽기 전용. 외부 API 호출 없음, 재무 변환 없음.
 * - 재무 데이터 정규화(누적→단독분기, YoY 계산)는 Python ETL 전담.
 * - 모든 스코어러는 이 인터페이스만 의존. 시장별 구현체(KR/US)로 교체 가능.
 */
public interface MarketDataPort {

    /** 이 어댑터가 담당하는 시장 식별자 (예: "KR", "US") */
    String getMarket();

    /** instruments.market 컬럼에 실제 저장된 시장 코드 목록. KR → ["KOSPI","KOSDAQ"], US → ["US"] */
    List<String> getDbMarkets();

    /** 활성 종목 목록 */
    List<Instrument> getActiveInstruments();

    /** 거래일 목록 (해당 시장 캘린더 기준) */
    List<LocalDate> getTradingCalendar(LocalDate from, LocalDate to);

    /** 기간 내 일별 가격 (오름차순) */
    List<PriceDaily> getPriceHistory(Long securityId, LocalDate from, LocalDate to);

    /** 최근 N 거래일 가격 (내림차순) */
    List<PriceDaily> getRecentPrices(Long securityId, int tradingDays);

    /**
     * 분기 재무 데이터 (원본, 최신순).
     * KR: DART 누적값 그대로 반환. 단독분기 EPS/YoY는 derived_metrics 사용.
     * 변환 없음 — Python ETL이 이미 derived_metrics에 적재.
     */
    List<Financial> getQuarterlyFinancials(Long securityId, int quarters);

    /** 연간 재무 데이터 (최신순) */
    List<Financial> getAnnualFinancials(Long securityId, int years);

    /** 최신 시장 상태 (M 게이트 판단용) */
    Optional<MarketState> getLatestMarketState();

    /** 기간 내 시장 상태 이력 */
    List<MarketState> getMarketStateHistory(LocalDate from, LocalDate to);

    /**
     * 기관/외국인 순매수 데이터.
     * KR: 투자자유형별 순매수 (pykrx 기준). 펀드별 보유 아님.
     * US MVP: Optional.empty() 반환.
     */
    Optional<InstitutionalFlow> getInstitutionalFlow(Long securityId, int days);

    /** 이 시장의 활성 설정값 */
    MarketConfig getActiveConfig();

    /**
     * scoringDate 기준 52주 최고가 (close_adj 기준).
     * 함정: close_adj 미조정 시 분할 종목에서 왜곡됨. Phase 3에서 수정계수 적용.
     */
    Optional<Double> get52WeekHigh(Long securityId, LocalDate scoringDate);

    /** 최근 N 거래일 평균 거래량 */
    Optional<Double> getAverageVolume(Long securityId, int tradingDays);

    /** 해당 날짜가 거래일인지 */
    boolean isTradingDay(LocalDate date);

    /**
     * 최신 파생 지표 (Python ETL + Java 배치 혼합).
     * C/A 스코어러가 eps_qoq_yoy_pct, roe_latest 등을 여기서 읽음.
     */
    Optional<DerivedMetric> getLatestDerivedMetric(Long securityId, LocalDate asOfDate);
}
