package com.canslim.api;

import com.canslim.api.dto.ScreenerItemResponse;
import com.canslim.api.dto.ScoreHistoryResponse;
import com.canslim.domain.CanslimScore;
import com.canslim.domain.Instrument;
import com.canslim.repository.CanslimScoreRepository;
import com.canslim.repository.InstrumentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.time.LocalDate;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

record ScreenerPageResponse(List<ScreenerItemResponse> items, long total, int page, int size) {}
record FinancialRecord(int fiscalYear, int fiscalQuarter, String periodType,
                       String periodEndDate, BigDecimal revenue,
                       BigDecimal operatingIncome, BigDecimal netIncome, BigDecimal eps) {}
record PriceBar(String date, BigDecimal open, BigDecimal high, BigDecimal low,
                BigDecimal close, Long volume) {}

@RestController
@RequestMapping("/api/screener")
public class ScreenerController {

    private static final Logger log = LoggerFactory.getLogger(ScreenerController.class);

    private final CanslimScoreRepository scoreRepo;
    private final InstrumentRepository   instRepo;
    private final JdbcTemplate           jdbc;

    public ScreenerController(CanslimScoreRepository scoreRepo,
                              InstrumentRepository instRepo,
                              JdbcTemplate jdbc) {
        this.scoreRepo = scoreRepo;
        this.instRepo  = instRepo;
        this.jdbc      = jdbc;
    }

    @GetMapping
    public ResponseEntity<ScreenerPageResponse> screen(
            @RequestParam String market,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0.0") double minScore,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "30") int size) {

        LocalDate scoreDate = resolveDate(market, date);
        if (scoreDate == null) return ResponseEntity.ok(new ScreenerPageResponse(List.of(), 0, page, size));

        boolean isSearch = q != null && !q.isBlank();
        final String keyword = isSearch ? q.trim().toLowerCase() : null;

        List<CanslimScore> scores;
        long total;

        if (isSearch) {
            // 검색 시: 전체 로드 후 필터
            List<CanslimScore> all = scoreRepo
                    .findByScoreDateAndMarketOrderByCompositeScoreDesc(scoreDate, market)
                    .stream()
                    .filter(s -> s.getCompositeScore().doubleValue() >= minScore)
                    .toList();
            Map<Long, Instrument> allInst = loadInstrumentMap(
                    all.stream().map(CanslimScore::getSecurityId).toList());
            scores = all.stream()
                    .filter(s -> {
                        Instrument inst = allInst.get(s.getSecurityId());
                        if (inst == null) return false;
                        return inst.getTicker().contains(keyword.toUpperCase()) ||
                               inst.getName().toLowerCase().contains(keyword);
                    })
                    .toList();
            total = scores.size();
        } else {
            // 페이징 조회
            var pageable = PageRequest.of(page, size,
                    Sort.by(Sort.Direction.DESC, "compositeScore"));
            var pageResult = scoreRepo.findByScoreDateAndMarket(scoreDate, market, pageable);
            scores = pageResult.getContent().stream()
                    .filter(s -> s.getCompositeScore().doubleValue() >= minScore)
                    .toList();
            total = pageResult.getTotalElements();
        }

        if (scores.isEmpty())
            return ResponseEntity.ok(new ScreenerPageResponse(List.of(), 0, page, size));

        List<Long> ids = scores.stream().map(CanslimScore::getSecurityId).toList();
        Map<Long, Instrument> instMap = loadInstrumentMap(ids);
        Map<Long, BigDecimal[]> priceFlow = loadPriceAndFlow(ids, scoreDate);

        List<ScreenerItemResponse> result = scores.stream()
                .filter(s -> instMap.containsKey(s.getSecurityId()))
                .map(s -> {
                    Instrument inst = instMap.get(s.getSecurityId());
                    BigDecimal[] pf = priceFlow.getOrDefault(s.getSecurityId(), new BigDecimal[7]);
                    return ScreenerItemResponse.of(s, inst, pf);
                })
                .toList();

        return ResponseEntity.ok(new ScreenerPageResponse(result, total, page, size));
    }

    @GetMapping("/{securityId}")
    public ResponseEntity<ScreenerItemResponse> getScore(
            @PathVariable Long securityId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {

        Instrument inst = instRepo.findById(securityId).orElse(null);
        if (inst == null) return ResponseEntity.notFound().build();

        LocalDate scoreDate;
        if (date != null) {
            scoreDate = date;
        } else {
            Optional<CanslimScore> latest =
                    scoreRepo.findFirstBySecurityIdOrderByScoreDateDesc(securityId);
            if (latest.isEmpty()) return ResponseEntity.notFound().build();
            scoreDate = latest.get().getScoreDate();
        }

        Optional<CanslimScore> score =
                scoreRepo.findBySecurityIdAndScoreDate(securityId, scoreDate);
        if (score.isEmpty()) return ResponseEntity.notFound().build();

        Map<Long, BigDecimal[]> pf = loadPriceAndFlow(List.of(securityId), scoreDate);
        BigDecimal[] data = pf.getOrDefault(securityId, new BigDecimal[7]);
        return ResponseEntity.ok(ScreenerItemResponse.of(score.get(), inst, data));
    }

    @GetMapping("/{securityId}/history")
    public ResponseEntity<List<ScoreHistoryResponse>> getHistory(
            @PathVariable Long securityId) {

        if (!instRepo.existsById(securityId)) return ResponseEntity.notFound().build();

        List<ScoreHistoryResponse> history = scoreRepo
                .findBySecurityIdOrderByScoreDateDesc(securityId)
                .stream()
                .map(ScoreHistoryResponse::of)
                .toList();

        return ResponseEntity.ok(history);
    }

    @GetMapping("/{securityId}/prices")
    public ResponseEntity<List<PriceBar>> getPrices(
            @PathVariable Long securityId,
            @RequestParam(defaultValue = "365") int days) {

        if (!instRepo.existsById(securityId)) return ResponseEntity.notFound().build();

        String sql = """
            SELECT trade_date, open_adj, high_adj, low_adj, close_adj, volume
            FROM price_daily
            WHERE security_id = ?
              AND trade_date >= CURRENT_DATE - MAKE_INTERVAL(days => ?)
            ORDER BY trade_date ASC
            """;

        List<PriceBar> result = jdbc.query(sql,
                (rs, i) -> new PriceBar(
                        rs.getString("trade_date"),
                        rs.getBigDecimal("open_adj"),
                        rs.getBigDecimal("high_adj"),
                        rs.getBigDecimal("low_adj"),
                        rs.getBigDecimal("close_adj"),
                        rs.getLong("volume")),
                securityId, days);

        return ResponseEntity.ok(result);
    }

    @GetMapping("/{securityId}/financials")
    public ResponseEntity<List<FinancialRecord>> getFinancials(
            @PathVariable Long securityId) {

        if (!instRepo.existsById(securityId)) return ResponseEntity.notFound().build();

        // 연결 우선, 없으면 별도. 연간 + 분기 누적 모두 반환 (최근 3년)
        String sql = """
            SELECT fiscal_year, fiscal_quarter, period_type, period_end_date,
                   revenue, operating_income, net_income, eps
            FROM financials
            WHERE security_id = ?
              AND is_consolidated = (
                  SELECT MAX(is_consolidated::int)::bool
                  FROM financials WHERE security_id = ?
              )
            ORDER BY period_end_date DESC
            LIMIT 20
            """;

        List<FinancialRecord> result = jdbc.query(sql,
                (rs, i) -> new FinancialRecord(
                        rs.getInt("fiscal_year"),
                        rs.getInt("fiscal_quarter"),
                        rs.getString("period_type"),
                        rs.getString("period_end_date"),
                        rs.getBigDecimal("revenue"),
                        rs.getBigDecimal("operating_income"),
                        rs.getBigDecimal("net_income"),
                        rs.getBigDecimal("eps")),
                securityId, securityId);

        return ResponseEntity.ok(result);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private LocalDate resolveDate(String market, LocalDate requested) {
        if (requested != null) return requested;
        return scoreRepo.findFirstByMarketOrderByScoreDateDesc(market)
                .map(CanslimScore::getScoreDate)
                .orElse(null);
    }

    private Map<Long, Instrument> loadInstrumentMap(List<Long> ids) {
        return instRepo.findAllById(ids).stream()
                .collect(Collectors.toMap(Instrument::getId, Function.identity()));
    }

    /**
     * [0]=closePrice [1]=instNetBuy10d [2]=foreignNetBuy10d
     * [3]=changeRate(%) [4]=52wHigh [5]=volume [6]=turnover [7]=marketCap(원)
     */
    private Map<Long, BigDecimal[]> loadPriceAndFlow(List<Long> ids, LocalDate scoreDate) {
        if (ids.isEmpty()) return Map.of();

        Map<Long, BigDecimal[]> result = new HashMap<>();
        for (Long id : ids) result.put(id, new BigDecimal[8]);

        Long[] idArr = ids.toArray(new Long[0]);

        // 종가·등락률·거래량·거래대금·52주 신고가·시가총액
        String priceSql = """
            SELECT p.security_id, p.close_adj, p.volume, p.turnover,
                   CASE WHEN prev.close_adj > 0
                        THEN ROUND((p.close_adj - prev.close_adj) / prev.close_adj * 100, 2)
                   END AS change_rate,
                   h52.high_52w,
                   p.close_adj * i.total_shares AS market_cap
            FROM (
                SELECT DISTINCT ON (security_id)
                    security_id, close_adj, volume, turnover, trade_date
                FROM price_daily
                WHERE security_id = ANY(?) AND trade_date <= ?
                ORDER BY security_id, trade_date DESC
            ) p
            JOIN instruments i ON i.id = p.security_id
            LEFT JOIN LATERAL (
                SELECT close_adj FROM price_daily p2
                WHERE p2.security_id = p.security_id AND p2.trade_date < p.trade_date
                ORDER BY p2.trade_date DESC LIMIT 1
            ) prev ON true
            LEFT JOIN LATERAL (
                SELECT MAX(close_adj) AS high_52w FROM price_daily p3
                WHERE p3.security_id = p.security_id
                  AND p3.trade_date > p.trade_date - INTERVAL '365 days'
                  AND p3.trade_date <= p.trade_date
            ) h52 ON true
            """;
        try {
            jdbc.query(con -> {
                PreparedStatement ps = con.prepareStatement(priceSql);
                ps.setArray(1, con.createArrayOf("bigint", idArr));
                ps.setDate(2, java.sql.Date.valueOf(scoreDate));
                return ps;
            }, rs -> {
                long sid = rs.getLong("security_id");
                if (!result.containsKey(sid)) return;
                BigDecimal[] row = result.get(sid);
                row[0] = rs.getBigDecimal("close_adj");
                row[3] = rs.getBigDecimal("change_rate");
                row[4] = rs.getBigDecimal("high_52w");
                row[5] = rs.getBigDecimal("volume");
                row[6] = rs.getBigDecimal("turnover");
                row[7] = rs.getBigDecimal("market_cap");
            });
        } catch (Exception e) {
            log.warn("price_daily 조회 실패: {}", e.getMessage());
        }

        // 수급: derived_metrics (스코어 날짜 이전 최신 날짜 사용)
        String flowSql = """
            SELECT security_id, inst_net_buy_10d, foreign_net_buy_10d
            FROM derived_metrics
            WHERE security_id = ANY(?)
              AND as_of_date = (
                  SELECT MAX(as_of_date) FROM derived_metrics WHERE as_of_date <= ?
              )
            """;
        try {
            jdbc.query(con -> {
                PreparedStatement ps = con.prepareStatement(flowSql);
                ps.setArray(1, con.createArrayOf("bigint", idArr));
                ps.setDate(2, java.sql.Date.valueOf(scoreDate));
                return ps;
            }, rs -> {
                long sid = rs.getLong("security_id");
                if (!result.containsKey(sid)) return;
                BigDecimal[] row = result.get(sid);
                row[1] = rs.getBigDecimal("inst_net_buy_10d");
                row[2] = rs.getBigDecimal("foreign_net_buy_10d");
            });
        } catch (Exception e) {
            log.warn("derived_metrics 조회 실패: {}", e.getMessage());
        }

        return result;
    }
}
