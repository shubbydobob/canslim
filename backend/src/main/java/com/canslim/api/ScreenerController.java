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
record ScreenerStats(long total, long bullCount, double avgScore, long upCount,
                     List<Map<String, Object>> sectorStats) {}
record FinancialRecord(int fiscalYear, int fiscalQuarter, String periodType,
                       String periodEndDate, BigDecimal revenue,
                       BigDecimal operatingIncome, BigDecimal netIncome, BigDecimal eps,
                       BigDecimal roe) {}
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

    // 가격 기반 정렬 필드 (all-load path 필요)
    private static final java.util.Set<String> PRICE_SORT_FIELDS = java.util.Set.of(
            "closePrice", "changeRate", "weekHigh52", "volume",
            "turnover", "foreignNetBuy10d", "instNetBuy10d", "marketCap");


    @GetMapping
    public ResponseEntity<ScreenerPageResponse> screen(
            @RequestParam("market") String market,
            @RequestParam(name = "date", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(name = "q", required = false) String q,
            @RequestParam(name = "minScore", defaultValue = "0.0") double minScore,
            @RequestParam(name = "sector", required = false) String sector,
            @RequestParam(name = "minCap", required = false) Long minCap,
            @RequestParam(name = "maxCap", required = false) Long maxCap,
            @RequestParam(name = "sortBy", defaultValue = "compositeScore") String sortBy,
            @RequestParam(name = "sortDir", defaultValue = "desc") String sortDir,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "30") int size) {

        LocalDate scoreDate = resolveDate(market, date);
        if (scoreDate == null) return ResponseEntity.ok(new ScreenerPageResponse(List.of(), 0, page, size));

        boolean isSearch = q != null && !q.isBlank();
        boolean hasFilter = isSearch || sector != null || minCap != null || maxCap != null;
        boolean isPriceSort = PRICE_SORT_FIELDS.contains(sortBy);
        boolean isDefaultSort = "compositeScore".equals(sortBy) && "desc".equals(sortDir);
        boolean useAllPath = hasFilter || isPriceSort || !isDefaultSort;
        final String keyword = isSearch ? q.trim().toLowerCase() : null;

        if (useAllPath || minScore > 0) {
            // 전체 로드 후 필터 + 정렬 + 수동 페이징
            List<CanslimScore> all = scoreRepo
                    .findByScoreDateAndMarketOrderByCompositeScoreDesc(scoreDate, market)
                    .stream()
                    .filter(s -> s.getCompositeScore().doubleValue() >= minScore)
                    .toList();

            List<Long> allIds = all.stream().map(CanslimScore::getSecurityId).toList();
            Map<Long, Instrument> allInst = loadInstrumentMap(allIds);

            // 1차 필터: keyword + sector
            List<CanslimScore> filtered = all.stream()
                    .filter(s -> allInst.containsKey(s.getSecurityId()))
                    .filter(s -> {
                        if (!isSearch) return true;
                        Instrument inst = allInst.get(s.getSecurityId());
                        return inst.getTicker().contains(keyword.toUpperCase()) ||
                               inst.getName().toLowerCase().contains(keyword);
                    })
                    .filter(s -> {
                        if (sector == null) return true;
                        return sector.equals(allInst.get(s.getSecurityId()).getSector());
                    })
                    .toList();

            List<Long> filteredIds = filtered.stream().map(CanslimScore::getSecurityId).toList();
            Map<Long, BigDecimal[]> pf = loadPriceAndFlow(filteredIds, scoreDate);
            Map<Long, BigDecimal> deltaMap = loadScoreDeltas(filteredIds, scoreDate);

            // 2차 필터: 시가총액 + 정렬
            Set<Long> breakouts = loadBreakouts(filteredIds, scoreDate);

            List<ScreenerItemResponse> allResult = filtered.stream()
                    .map(s -> {
                        Instrument inst = allInst.get(s.getSecurityId());
                        BigDecimal[] data = pf.getOrDefault(s.getSecurityId(), new BigDecimal[8]);
                        BigDecimal delta = deltaMap.get(s.getSecurityId());
                        boolean breakout = breakouts.contains(s.getSecurityId());
                        return ScreenerItemResponse.of(s, inst, data, delta, breakout, null);
                    })
                    .filter(r -> {
                        if (minCap == null && maxCap == null) return true;
                        BigDecimal cap = r.marketCap();
                        if (cap == null) return false;
                        long capVal = cap.longValue();
                        if (minCap != null && capVal < minCap) return false;
                        if (maxCap != null && capVal > maxCap) return false;
                        return true;
                    })
                    .sorted(buildComparator(sortBy, "desc".equals(sortDir)))
                    .toList();

            long total = allResult.size();
            int from = Math.min(page * size, allResult.size());
            int to   = Math.min(from + size, allResult.size());
            return ResponseEntity.ok(new ScreenerPageResponse(allResult.subList(from, to), total, page, size));
        }

        // 기본 경로: JPA 페이징 (compositeScore DESC)
        Sort.Direction dir = "asc".equals(sortDir) ? Sort.Direction.ASC : Sort.Direction.DESC;
        String jpaField = java.util.Map.of(
                "compositeScore", "compositeScore", "cScore", "cScore",
                "aScore", "aScore", "nScore", "nScore", "sScore", "sScore",
                "lScore", "lScore", "iScore", "iScore", "mScore", "mScore",
                "marketPercentile", "marketPercentile"
        ).getOrDefault(sortBy, "compositeScore");

        var pageable = PageRequest.of(page, size, Sort.by(dir, jpaField));
        var pageResult = scoreRepo.findByScoreDateAndMarket(scoreDate, market, pageable);
        List<CanslimScore> scores = pageResult.getContent().stream()
                .filter(s -> s.getCompositeScore().doubleValue() >= minScore)
                .toList();
        long total = pageResult.getTotalElements();

        if (scores.isEmpty())
            return ResponseEntity.ok(new ScreenerPageResponse(List.of(), 0, page, size));

        List<Long> ids = scores.stream().map(CanslimScore::getSecurityId).toList();
        Map<Long, Instrument> instMap = loadInstrumentMap(ids);
        Map<Long, BigDecimal[]> priceFlow = loadPriceAndFlow(ids, scoreDate);
        Map<Long, BigDecimal> deltaMap = loadScoreDeltas(ids, scoreDate);

        // 기본 페이징 경로: breakout 계산 생략 (365일 self-join 비용)
        // 필터/정렬 경로(useAllPath)에서만 계산
        List<ScreenerItemResponse> result = scores.stream()
                .filter(s -> instMap.containsKey(s.getSecurityId()))
                .map(s -> {
                    Instrument inst = instMap.get(s.getSecurityId());
                    BigDecimal[] data = priceFlow.getOrDefault(s.getSecurityId(), new BigDecimal[8]);
                    BigDecimal delta = deltaMap.get(s.getSecurityId());
                    return ScreenerItemResponse.of(s, inst, data, delta, false, null);
                })
                .toList();

        return ResponseEntity.ok(new ScreenerPageResponse(result, total, page, size));
    }

    private Comparator<ScreenerItemResponse> buildComparator(String sortBy, boolean desc) {
        java.util.function.Function<ScreenerItemResponse, BigDecimal> extractor = switch (sortBy != null ? sortBy : "compositeScore") {
            case "cScore"           -> ScreenerItemResponse::cScore;
            case "aScore"           -> ScreenerItemResponse::aScore;
            case "nScore"           -> ScreenerItemResponse::nScore;
            case "sScore"           -> ScreenerItemResponse::sScore;
            case "lScore"           -> ScreenerItemResponse::lScore;
            case "iScore"           -> ScreenerItemResponse::iScore;
            case "mScore"           -> ScreenerItemResponse::mScore;
            case "marketPercentile" -> ScreenerItemResponse::marketPercentile;
            case "closePrice"       -> ScreenerItemResponse::closePrice;
            case "changeRate"       -> ScreenerItemResponse::changeRate;
            case "weekHigh52"       -> ScreenerItemResponse::weekHigh52;
            case "volume"           -> ScreenerItemResponse::volume;
            case "turnover"         -> ScreenerItemResponse::turnover;
            case "foreignNetBuy10d"  -> ScreenerItemResponse::foreignNetBuy10d;
            case "instNetBuy10d"    -> ScreenerItemResponse::instNetBuy10d;
            case "programNetBuy10d" -> ScreenerItemResponse::programNetBuy10d;
            case "marketCap"        -> ScreenerItemResponse::marketCap;
            default                 -> ScreenerItemResponse::compositeScore;
        };
        Comparator<ScreenerItemResponse> cmp = Comparator.comparing(extractor,
                Comparator.nullsLast(Comparator.naturalOrder()));
        return desc ? cmp.reversed() : cmp;
    }

    @GetMapping("/stats")
    public ResponseEntity<ScreenerStats> getStats(
            @RequestParam(name = "market", defaultValue = "KR") String market) {

        LocalDate scoreDate = resolveDate(market, null);
        if (scoreDate == null) return ResponseEntity.ok(new ScreenerStats(0, 0, 0, 0, List.of()));

        // prev CTE 범위를 7일로 제한 → price_daily 풀스캔 방지
        String aggSql = """
            WITH prev AS (
              SELECT DISTINCT ON (security_id) security_id, close_adj AS close
              FROM price_daily
              WHERE trade_date >= ? - INTERVAL '7 days' AND trade_date < ?
              ORDER BY security_id, trade_date DESC
            )
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN cs.composite_score >= 70 THEN 1 ELSE 0 END) AS bull_count,
              AVG(cs.composite_score) AS avg_score,
              SUM(CASE WHEN p.close_adj > prev.close THEN 1 ELSE 0 END) AS up_count
            FROM canslim_scores cs
            LEFT JOIN price_daily p ON p.security_id = cs.security_id AND p.trade_date = cs.score_date
            LEFT JOIN prev ON prev.security_id = cs.security_id
            WHERE cs.score_date = ? AND cs.market = ?
            """;

        Map<String, Object> agg = jdbc.queryForMap(aggSql, scoreDate, scoreDate, scoreDate, market);

        // 섹터별 집계
        List<Map<String, Object>> sectorRows = jdbc.queryForList("""
            WITH prev AS (
              SELECT DISTINCT ON (security_id) security_id, close_adj AS close
              FROM price_daily
              WHERE trade_date >= ? - INTERVAL '7 days' AND trade_date < ?
              ORDER BY security_id, trade_date DESC
            )
            SELECT i.sector,
                   COUNT(*) AS cnt,
                   AVG(CASE WHEN prev.close > 0
                       THEN (p.close_adj - prev.close) / prev.close * 100
                       ELSE NULL END) AS avg_change,
                   AVG(cs.composite_score) AS avg_score
            FROM canslim_scores cs
            JOIN instruments i ON i.id = cs.security_id
            LEFT JOIN price_daily p ON p.security_id = cs.security_id AND p.trade_date = cs.score_date
            LEFT JOIN prev ON prev.security_id = cs.security_id
            WHERE cs.score_date = ? AND cs.market = ?
              AND i.sector IS NOT NULL
            GROUP BY i.sector
            ORDER BY AVG(CASE WHEN prev.close > 0 THEN (p.close_adj - prev.close) / prev.close * 100 ELSE NULL END) DESC NULLS LAST
            """, scoreDate, scoreDate, scoreDate, market);

        long total    = ((Number) agg.get("total")).longValue();
        long bull     = ((Number) agg.get("bull_count")).longValue();
        double avg    = agg.get("avg_score") != null ? ((Number) agg.get("avg_score")).doubleValue() : 0;
        long up       = agg.get("up_count") != null ? ((Number) agg.get("up_count")).longValue() : 0;

        return ResponseEntity.ok(new ScreenerStats(total, bull, avg, up, sectorRows));
    }

    @GetMapping("/sectors")
    public ResponseEntity<List<String>> getSectors() {
        List<String> sectors = jdbc.queryForList(
                "SELECT DISTINCT sector FROM instruments WHERE sector IS NOT NULL ORDER BY sector",
                String.class);
        return ResponseEntity.ok(sectors);
    }

@GetMapping("/{securityId}")
    public ResponseEntity<ScreenerItemResponse> getScore(
            @PathVariable Long securityId,
            @RequestParam(name = "date", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {

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
            @RequestParam(name = "days", defaultValue = "365") int days) {

        if (!instRepo.existsById(securityId)) return ResponseEntity.notFound().build();

        String sql = """
            SELECT trade_date, open, high, low, close_adj, volume
            FROM price_daily
            WHERE security_id = ?
              AND trade_date >= CURRENT_DATE - MAKE_INTERVAL(days => ?)
            ORDER BY trade_date ASC
            """;

        List<PriceBar> result = jdbc.query(sql,
                (rs, i) -> new PriceBar(
                        rs.getString("trade_date"),
                        rs.getBigDecimal("open"),
                        rs.getBigDecimal("high"),
                        rs.getBigDecimal("low"),
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
                   revenue, operating_income, net_income, eps, roe
            FROM financials
            WHERE security_id = ?
              AND is_consolidated = (
                  SELECT MAX(is_consolidated::int)::bool
                  FROM financials WHERE security_id = ?
              )
            ORDER BY period_end_date DESC
            LIMIT 60
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
                        rs.getBigDecimal("eps"),
                        rs.getBigDecimal("roe")),
                securityId, securityId);

        return ResponseEntity.ok(result);
    }

    record SectorPeer(String ticker, String name, double compositeScore,
                      Double cScore, Double aScore, Double nScore,
                      Double sScore, Double iScore, BigDecimal closePrice,
                      boolean isSelf) {}

    @GetMapping("/{securityId}/sector-peers")
    public ResponseEntity<List<SectorPeer>> getSectorPeers(@PathVariable Long securityId) {
        Instrument self = instRepo.findById(securityId).orElse(null);
        if (self == null || self.getSector() == null) return ResponseEntity.ok(List.of());

        String sql = """
            SELECT i.ticker, i.name, cs.composite_score,
                   cs.c_score, cs.a_score, cs.n_score, cs.s_score, cs.i_score,
                   p.close_adj
            FROM canslim_scores cs
            JOIN instruments i ON i.id = cs.security_id
            LEFT JOIN LATERAL (
                SELECT close_adj FROM price_daily
                WHERE security_id = cs.security_id
                ORDER BY trade_date DESC LIMIT 1
            ) p ON true
            WHERE cs.score_date = (SELECT MAX(score_date) FROM canslim_scores WHERE market = ?)
              AND i.sector = ?
              AND i.market IN ('KOSPI','KOSDAQ')
            ORDER BY cs.composite_score DESC
            LIMIT 7
            """;

        List<SectorPeer> peers = jdbc.query(sql,
                (rs, i) -> {
                    java.math.BigDecimal c = rs.getBigDecimal("c_score");
                    java.math.BigDecimal a = rs.getBigDecimal("a_score");
                    java.math.BigDecimal n = rs.getBigDecimal("n_score");
                    java.math.BigDecimal s = rs.getBigDecimal("s_score");
                    java.math.BigDecimal ii = rs.getBigDecimal("i_score");
                    return new SectorPeer(
                        rs.getString("ticker"),
                        rs.getString("name"),
                        rs.getDouble("composite_score"),
                        c  != null ? c.doubleValue()  : null,
                        a  != null ? a.doubleValue()  : null,
                        n  != null ? n.doubleValue()  : null,
                        s  != null ? s.doubleValue()  : null,
                        ii != null ? ii.doubleValue() : null,
                        rs.getBigDecimal("close_adj"),
                        rs.getString("ticker").equals(self.getTicker()));
                },
                "KR", self.getSector());

        return ResponseEntity.ok(peers);
    }

    record CorrelationStock(String ticker, String name, double compositeScore, String sector) {}

    @GetMapping("/{securityId}/correlations")
    public ResponseEntity<List<CorrelationStock>> getCorrelations(@PathVariable Long securityId) {
        Instrument self = instRepo.findById(securityId).orElse(null);
        if (self == null) return ResponseEntity.notFound().build();

        String sql = """
            SELECT i.ticker, i.name, cs.composite_score, i.sector
            FROM canslim_scores cs
            JOIN instruments i ON i.id = cs.security_id
            WHERE cs.score_date = (SELECT MAX(score_date) FROM canslim_scores WHERE market = 'KR')
              AND cs.security_id != ?
              AND i.sector = ?
              AND cs.composite_score IS NOT NULL
            ORDER BY ABS(cs.composite_score - ?) ASC
            LIMIT 5
            """;

        double selfScore = scoreRepo.findFirstBySecurityIdOrderByScoreDateDesc(securityId)
                .map(s -> s.getCompositeScore().doubleValue())
                .orElse(50.0);
        String selfSector = self.getSector() != null ? self.getSector() : "";

        List<CorrelationStock> result = jdbc.query(sql,
                (rs, i) -> new CorrelationStock(
                        rs.getString("ticker"),
                        rs.getString("name"),
                        rs.getDouble("composite_score"),
                        rs.getString("sector")),
                securityId, selfSector, selfScore);

        // sector가 없거나 결과 부족하면 전체에서 비슷한 점수 종목으로 보완
        if (result.size() < 5) {
            String fallbackSql = """
                SELECT i.ticker, i.name, cs.composite_score, i.sector
                FROM canslim_scores cs
                JOIN instruments i ON i.id = cs.security_id
                WHERE cs.score_date = (SELECT MAX(score_date) FROM canslim_scores WHERE market = 'KR')
                  AND cs.security_id != ?
                  AND cs.composite_score IS NOT NULL
                ORDER BY ABS(cs.composite_score - ?) ASC
                LIMIT 5
                """;
            result = jdbc.query(fallbackSql,
                    (rs, i) -> new CorrelationStock(
                            rs.getString("ticker"),
                            rs.getString("name"),
                            rs.getDouble("composite_score"),
                            rs.getString("sector")),
                    securityId, selfScore);
        }

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

    private Map<Long, BigDecimal> loadScoreDeltas(List<Long> ids, LocalDate scoreDate) {
        if (ids.isEmpty()) return Map.of();
        Map<Long, BigDecimal> result = new HashMap<>();
        Long[] idArr = ids.toArray(new Long[0]);
        String deltaSql = """
            SELECT cs.security_id, cs.composite_score - prev.composite_score AS delta
            FROM canslim_scores cs
            JOIN canslim_scores prev ON prev.security_id = cs.security_id
              AND prev.score_date = cs.score_date - INTERVAL '1 day'
            WHERE cs.security_id = ANY(?)
              AND cs.score_date = ?
            """;
        try {
            jdbc.query(con -> {
                PreparedStatement ps = con.prepareStatement(deltaSql);
                ps.setArray(1, con.createArrayOf("bigint", idArr));
                ps.setDate(2, java.sql.Date.valueOf(scoreDate));
                return ps;
            }, rs -> {
                result.put(rs.getLong("security_id"), rs.getBigDecimal("delta"));
            });
        } catch (Exception e) {
            log.warn("score delta 조회 실패: {}", e.getMessage());
        }
        return result;
    }

    /**
     * [0]=closePrice [1]=instNetBuy10d [2]=foreignNetBuy10d
     * [3]=changeRate(%) [4]=52wHigh [5]=volume [6]=turnover [7]=marketCap(원)
     */
    private Map<Long, BigDecimal[]> loadPriceAndFlow(List<Long> ids, LocalDate scoreDate) {
        if (ids.isEmpty()) return Map.of();

        Map<Long, BigDecimal[]> result = new HashMap<>();
        for (Long id : ids) result.put(id, new BigDecimal[11]);

        Long[] idArr = ids.toArray(new Long[0]);

        // 종가·등락률·거래량·거래대금·시가총액 (high_52w 제거 — UI 컬럼 삭제됨)
        String priceSql = """
            SELECT p.security_id, p.close_adj, p.volume, p.turnover,
                   CASE WHEN prev.close_adj > 0
                        THEN ROUND((p.close_adj - prev.close_adj) / prev.close_adj * 100, 2)
                   END AS change_rate,
                   p.close_adj * i.total_shares AS market_cap
            FROM (
                SELECT DISTINCT ON (security_id)
                    security_id, close_adj, volume, turnover, trade_date
                FROM price_daily
                WHERE security_id = ANY(?) AND trade_date >= ? AND trade_date <= ?
                ORDER BY security_id, trade_date DESC
            ) p
            JOIN instruments i ON i.id = p.security_id
            LEFT JOIN LATERAL (
                SELECT close_adj FROM price_daily p2
                WHERE p2.security_id = p.security_id AND p2.trade_date < p.trade_date
                ORDER BY p2.trade_date DESC LIMIT 1
            ) prev ON true
            """;
        try {
            jdbc.query(con -> {
                PreparedStatement ps = con.prepareStatement(priceSql);
                ps.setArray(1, con.createArrayOf("bigint", idArr));
                ps.setDate(2, java.sql.Date.valueOf(scoreDate.minusDays(14)));
                ps.setDate(3, java.sql.Date.valueOf(scoreDate));
                return ps;
            }, rs -> {
                long sid = rs.getLong("security_id");
                if (!result.containsKey(sid)) return;
                BigDecimal[] row = result.get(sid);
                row[0] = rs.getBigDecimal("close_adj");
                row[3] = rs.getBigDecimal("change_rate");
                row[5] = rs.getBigDecimal("volume");
                row[6] = rs.getBigDecimal("turnover");
                row[7] = rs.getBigDecimal("market_cap");
            });
        } catch (Exception e) {
            log.warn("price_daily 조회 실패: {}", e.getMessage());
        }

        // 수급: derived_metrics (수급 데이터가 있는 가장 최근 날짜 사용)
        String flowSql = """
            SELECT security_id, inst_net_buy_10d, foreign_net_buy_10d, program_net_buy_10d,
                   after_hours_close, after_hours_change_pct
            FROM derived_metrics
            WHERE security_id = ANY(?)
              AND as_of_date = (
                  SELECT MAX(as_of_date) FROM derived_metrics
                  WHERE as_of_date <= ?
                    AND inst_net_buy_10d IS NOT NULL
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
                row[8] = rs.getBigDecimal("program_net_buy_10d");
                row[9] = rs.getBigDecimal("after_hours_close");
                row[10] = rs.getBigDecimal("after_hours_change_pct");
            });
        } catch (Exception e) {
            log.warn("derived_metrics 조회 실패: {}", e.getMessage());
        }

        return result;
    }

    private Set<Long> loadBreakouts(List<Long> ids, LocalDate scoreDate) {
        if (ids.isEmpty()) return Set.of();
        Set<Long> result = new HashSet<>();
        // 오늘 종가가 52주 신고가의 99% 이상이고 어제는 그 미만인 종목 (breakout)
        String sql = """
            SELECT today.security_id
            FROM (
                SELECT p.security_id,
                       p.close_adj,
                       MAX(p2.close_adj) AS high_52w
                FROM price_daily p
                JOIN price_daily p2 ON p2.security_id = p.security_id
                    AND p2.trade_date > p.trade_date - INTERVAL '365 days'
                    AND p2.trade_date <= p.trade_date
                WHERE p.security_id = ANY(?) AND p.trade_date = ?
                GROUP BY p.security_id, p.close_adj
            ) today
            LEFT JOIN (
                SELECT p.security_id,
                       p.close_adj,
                       MAX(p2.close_adj) AS high_52w
                FROM price_daily p
                JOIN price_daily p2 ON p2.security_id = p.security_id
                    AND p2.trade_date > p.trade_date - INTERVAL '365 days'
                    AND p2.trade_date <= p.trade_date
                WHERE p.security_id = ANY(?)
                  AND p.trade_date = (
                      SELECT MAX(trade_date) FROM price_daily
                      WHERE security_id = p.security_id AND trade_date < ?
                  )
                GROUP BY p.security_id, p.close_adj
            ) prev ON prev.security_id = today.security_id
            WHERE today.high_52w > 0
              AND today.close_adj >= today.high_52w * 0.99
              AND (prev.high_52w IS NULL OR prev.close_adj < prev.high_52w * 0.99)
            """;
        try {
            Long[] idArr = ids.toArray(new Long[0]);
            jdbc.query(con -> {
                PreparedStatement ps = con.prepareStatement(sql);
                ps.setArray(1, con.createArrayOf("bigint", idArr));
                ps.setDate(2, java.sql.Date.valueOf(scoreDate));
                ps.setArray(3, con.createArrayOf("bigint", idArr));
                ps.setDate(4, java.sql.Date.valueOf(scoreDate));
                return ps;
            }, rs -> { result.add(rs.getLong("security_id")); });
        } catch (Exception e) {
            log.warn("breakout 조회 실패: {}", e.getMessage());
        }
        return result;
    }

    private Map<Long, Integer> loadBaseDays(List<Long> ids, LocalDate scoreDate) {
        if (ids.isEmpty()) return Map.of();
        Map<Long, Integer> result = new HashMap<>();
        // 최근 1년 중 52주 신고가 대비 -15% 이내에 있었던 일수 = 베이스 기간
        String sql = """
            SELECT p.security_id, COUNT(*) AS base_days
            FROM price_daily p
            JOIN (
                SELECT security_id, MAX(close_adj) AS high_52w
                FROM price_daily
                WHERE security_id = ANY(?)
                  AND trade_date > ?
                  AND trade_date <= ?
                GROUP BY security_id
            ) h ON h.security_id = p.security_id
            WHERE p.security_id = ANY(?)
              AND p.trade_date > ?
              AND p.trade_date <= ?
              AND h.high_52w > 0
              AND p.close_adj >= h.high_52w * 0.85
            GROUP BY p.security_id
            """;
        try {
            Long[] idArr = ids.toArray(new Long[0]);
            java.sql.Date from = java.sql.Date.valueOf(scoreDate.minusDays(365));
            java.sql.Date to   = java.sql.Date.valueOf(scoreDate);
            jdbc.query(con -> {
                PreparedStatement ps = con.prepareStatement(sql);
                ps.setArray(1, con.createArrayOf("bigint", idArr));
                ps.setDate(2, from);
                ps.setDate(3, to);
                ps.setArray(4, con.createArrayOf("bigint", idArr));
                ps.setDate(5, from);
                ps.setDate(6, to);
                return ps;
            }, rs -> { result.put(rs.getLong("security_id"), rs.getInt("base_days")); });
        } catch (Exception e) {
            log.warn("baseDays 조회 실패: {}", e.getMessage());
        }
        return result;
    }
}
