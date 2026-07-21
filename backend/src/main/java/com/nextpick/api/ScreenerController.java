package com.nextpick.api;

import com.nextpick.api.dto.ScreenerItemResponse;
import com.nextpick.api.dto.ScoreHistoryResponse;
import com.nextpick.domain.NextpickScore;
import com.nextpick.domain.Instrument;
import com.nextpick.repository.NextpickScoreRepository;
import com.nextpick.repository.InstrumentRepository;
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
record LimitUpStock(long securityId, String ticker, String name, String sector,
                    double changeRate, double closePrice, Double compositeScore) {}
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
    private static final long PRICE_CACHE_TTL = 60_000; // 60초 — 가격 데이터 일 1회 배치

    private final NextpickScoreRepository scoreRepo;
    private final InstrumentRepository   instRepo;
    private final JdbcTemplate           jdbc;

    // 가격 정렬 캐시: key = "sortBy|desc|page|size|minScore|keyword|sector|minCap|maxCap"
    private final Map<String, CachedPage> priceSortCache = new java.util.concurrent.ConcurrentHashMap<>();
    private record CachedPage(ScreenerPageResponse data, long ts) {}

    public ScreenerController(NextpickScoreRepository scoreRepo,
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
        boolean isPriceSort = PRICE_SORT_FIELDS.contains(sortBy);
        boolean isDefaultSort = "compositeScore".equals(sortBy) && "desc".equals(sortDir);
        final String keyword = isSearch ? q.trim().toLowerCase() : null;

        // 가격 기반 정렬: 캐시 우선 → DB 직접 정렬+페이징
        if (isPriceSort) {
            String cacheKey = String.join("|", market, sortBy, sortDir,
                    String.valueOf(page), String.valueOf(size), String.valueOf(minScore),
                    String.valueOf(keyword), String.valueOf(sector),
                    String.valueOf(minCap), String.valueOf(maxCap));
            CachedPage cached = priceSortCache.get(cacheKey);
            long now = System.currentTimeMillis();
            if (cached != null && now - cached.ts() < PRICE_CACHE_TTL) {
                return ResponseEntity.ok(cached.data());
            }
            ScreenerPageResponse result = screenByPriceSort(
                    scoreDate, market, sortBy, "desc".equals(sortDir),
                    page, size, minScore, keyword, sector, minCap, maxCap);
            priceSortCache.put(cacheKey, new CachedPage(result, now));
            return ResponseEntity.ok(result);
        }

        boolean hasFilter = isSearch || sector != null || minCap != null || maxCap != null;
        boolean useAllPath = hasFilter || !isDefaultSort;

        if (useAllPath || minScore > 0) {
            // 전체 로드 후 필터 + 정렬 + 수동 페이징
            List<NextpickScore> all = scoreRepo
                    .findByScoreDateAndMarketOrderByCompositeScoreDesc(scoreDate, market)
                    .stream()
                    .filter(s -> s.getCompositeScore().doubleValue() >= minScore)
                    .toList();

            List<Long> allIds = all.stream().map(NextpickScore::getSecurityId).toList();
            Map<Long, Instrument> allInst = loadInstrumentMap(allIds);

            // 1차 필터: keyword + sector
            List<NextpickScore> filtered = all.stream()
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

            List<Long> filteredIds = filtered.stream().map(NextpickScore::getSecurityId).toList();
            Map<Long, BigDecimal[]> pf = loadPriceAndFlow(filteredIds, scoreDate);
            Map<Long, BigDecimal> deltaMap = loadScoreDeltas(filteredIds, scoreDate);
            Map<Long, String[]> statusMap = loadStatuses(filteredIds);

            // 2차 필터: 시가총액 + 정렬
            Set<Long> breakouts = loadBreakouts(filteredIds, scoreDate);

            List<ScreenerItemResponse> allResult = filtered.stream()
                    .map(s -> {
                        Instrument inst = allInst.get(s.getSecurityId());
                        BigDecimal[] data = pf.getOrDefault(s.getSecurityId(), new BigDecimal[15]);
                        BigDecimal delta = deltaMap.get(s.getSecurityId());
                        boolean breakout = breakouts.contains(s.getSecurityId());
                        return ScreenerItemResponse.of(s, inst, data, delta, breakout, null, statusMap.get(s.getSecurityId()));
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
        List<NextpickScore> scores = pageResult.getContent().stream()
                .filter(s -> s.getCompositeScore().doubleValue() >= minScore)
                .toList();
        long total = pageResult.getTotalElements();

        if (scores.isEmpty())
            return ResponseEntity.ok(new ScreenerPageResponse(List.of(), 0, page, size));

        List<Long> ids = scores.stream().map(NextpickScore::getSecurityId).toList();
        Map<Long, Instrument> instMap = loadInstrumentMap(ids);
        Map<Long, BigDecimal[]> priceFlow = loadPriceAndFlow(ids, scoreDate);
        Map<Long, BigDecimal> deltaMap = loadScoreDeltas(ids, scoreDate);
        Map<Long, String[]> statusMap = loadStatuses(ids);

        // 기본 페이징 경로: breakout 계산 생략 (365일 self-join 비용)
        // 필터/정렬 경로(useAllPath)에서만 계산
        List<ScreenerItemResponse> result = scores.stream()
                .filter(s -> instMap.containsKey(s.getSecurityId()))
                .map(s -> {
                    Instrument inst = instMap.get(s.getSecurityId());
                    BigDecimal[] data = priceFlow.getOrDefault(s.getSecurityId(), new BigDecimal[15]);
                    BigDecimal delta = deltaMap.get(s.getSecurityId());
                    return ScreenerItemResponse.of(s, inst, data, delta, false, null, statusMap.get(s.getSecurityId()));
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

        // 가격 윈도우 앵커: 채점(score_date)이 밀려도 상승종목수·섹터 등락은 '최신 가격일' 기준.
        LocalDate priceDate = scoreDate;
        try {
            LocalDate maxPrice = jdbc.queryForObject(
                    "SELECT max(trade_date) FROM price_daily", LocalDate.class);
            if (maxPrice != null && maxPrice.isAfter(priceDate)) priceDate = maxPrice;
        } catch (Exception ignore) { }

        String aggSql = """
            WITH ranked AS (
              SELECT security_id, close_adj, volume, trade_date,
                     ROW_NUMBER() OVER (PARTITION BY security_id ORDER BY trade_date DESC) rn
              FROM price_daily
              WHERE trade_date >= ? - INTERVAL '14 days' AND trade_date <= ?
            ),
            cur  AS (SELECT security_id, close_adj FROM ranked WHERE rn = 1),
            prev AS (SELECT security_id, close_adj AS close, volume FROM ranked WHERE rn = 2)
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN cs.composite_score >= 70 THEN 1 ELSE 0 END) AS bull_count,
              AVG(cs.composite_score) AS avg_score,
              -- prev.volume > 0: 거래정지 전일종가로 상승 오판정 방지
              SUM(CASE WHEN prev.volume > 0 AND cur.close_adj > prev.close THEN 1 ELSE 0 END) AS up_count
            FROM nextpick_scores cs
            LEFT JOIN cur  ON cur.security_id  = cs.security_id
            LEFT JOIN prev ON prev.security_id = cs.security_id
            WHERE cs.score_date = ? AND cs.market = ?
            """;

        Map<String, Object> agg = jdbc.queryForMap(aggSql, priceDate, priceDate, scoreDate, market);

        // 섹터별 집계 (동일하게 최신 가격일 기준)
        List<Map<String, Object>> sectorRows = jdbc.queryForList("""
            WITH ranked AS (
              SELECT security_id, close_adj, volume, trade_date,
                     ROW_NUMBER() OVER (PARTITION BY security_id ORDER BY trade_date DESC) rn
              FROM price_daily
              WHERE trade_date >= ? - INTERVAL '14 days' AND trade_date <= ?
            ),
            cur  AS (SELECT security_id, close_adj FROM ranked WHERE rn = 1),
            prev AS (SELECT security_id, close_adj AS close, volume FROM ranked WHERE rn = 2)
            SELECT i.sector,
                   COUNT(*) AS cnt,
                   -- prev.volume > 0: 거래정지→재개 갭(+253% 등)이 섹터 평균등락 왜곡하는 것 방지
                   AVG(CASE WHEN prev.close > 0 AND prev.volume > 0
                       THEN (cur.close_adj - prev.close) / prev.close * 100
                       ELSE NULL END) AS avg_change,
                   AVG(cs.composite_score) AS avg_score
            FROM nextpick_scores cs
            JOIN instruments i ON i.id = cs.security_id
            LEFT JOIN cur  ON cur.security_id  = cs.security_id
            LEFT JOIN prev ON prev.security_id = cs.security_id
            WHERE cs.score_date = ? AND cs.market = ?
              AND i.sector IS NOT NULL
            GROUP BY i.sector
            ORDER BY AVG(CASE WHEN prev.close > 0 AND prev.volume > 0 THEN (cur.close_adj - prev.close) / prev.close * 100 ELSE NULL END) DESC NULLS LAST
            """, priceDate, priceDate, scoreDate, market);

        long total    = ((Number) agg.get("total")).longValue();
        long bull     = ((Number) agg.get("bull_count")).longValue();
        double avg    = agg.get("avg_score") != null ? ((Number) agg.get("avg_score")).doubleValue() : 0;
        long up       = agg.get("up_count") != null ? ((Number) agg.get("up_count")).longValue() : 0;

        return ResponseEntity.ok(new ScreenerStats(total, bull, avg, up, sectorRows));
    }

    /** 상한가·급등 종목 (당일 등락률 >= threshold%, 기본 29% — 국내 가격제한 ±30% 근접). */
    @GetMapping("/limit-up")
    public ResponseEntity<List<LimitUpStock>> getLimitUp(
            @RequestParam(name = "market", defaultValue = "KR") String market,
            @RequestParam(name = "threshold", defaultValue = "29.0") double threshold) {

        LocalDate scoreDate = resolveDate(market, null);
        if (scoreDate == null) return ResponseEntity.ok(List.of());
        // 가격 앵커는 '최신 가격일'(채점보다 앞설 수 있음) — 채점이 밀려도 당일 등락은 최신 가격으로.
        LocalDate priceDate = jdbc.queryForObject("SELECT max(trade_date) FROM price_daily", LocalDate.class);
        if (priceDate == null) priceDate = scoreDate;

        // 최신 가격일 이하 최신 2개 거래일(cur/prev)로 당일 등락률 계산 (연속 거래일 = 주말 제외).
        String sql = """
            WITH ranked AS (
              SELECT security_id, close_adj, volume, trade_date,
                     ROW_NUMBER() OVER (PARTITION BY security_id ORDER BY trade_date DESC) rn
              FROM price_daily
              WHERE trade_date >= ? - INTERVAL '14 days' AND trade_date <= ?
            ),
            cur  AS (SELECT security_id, close_adj FROM ranked WHERE rn = 1),
            -- prev.volume > 0 조건으로 거래정지(거래량 0) 전일종가 배제.
            -- 정지→재개 갭(예: 금호에이치티 2555→9030=+253%)이 허위 상한가로 오르는 것 방지.
            prev AS (SELECT security_id, close_adj AS close, volume FROM ranked WHERE rn = 2)
            SELECT i.id AS security_id, i.ticker, i.name, i.sector,
                   ROUND((cur.close_adj - prev.close) / prev.close * 100, 2) AS change_rate,
                   cur.close_adj AS close_price,
                   cs.composite_score
            FROM cur
            JOIN prev ON prev.security_id = cur.security_id AND prev.close > 0 AND prev.volume > 0
            JOIN instruments i ON i.id = cur.security_id
            LEFT JOIN nextpick_scores cs
                   ON cs.security_id = cur.security_id AND cs.score_date = ? AND cs.market = ?
            WHERE (cur.close_adj - prev.close) / prev.close * 100 >= ?
            ORDER BY change_rate DESC
            LIMIT 60
            """;

        List<LimitUpStock> rows = jdbc.query(sql, (rs, i) -> {
            Object comp = rs.getObject("composite_score");
            return new LimitUpStock(
                    rs.getLong("security_id"), rs.getString("ticker"),
                    rs.getString("name"), rs.getString("sector"),
                    rs.getDouble("change_rate"), rs.getDouble("close_price"),
                    comp == null ? null : ((Number) comp).doubleValue());
        }, priceDate, priceDate, scoreDate, market, threshold);

        return ResponseEntity.ok(rows);
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
            Optional<NextpickScore> latest =
                    scoreRepo.findFirstBySecurityIdOrderByScoreDateDesc(securityId);
            if (latest.isEmpty()) return ResponseEntity.notFound().build();
            scoreDate = latest.get().getScoreDate();
        }

        Optional<NextpickScore> score =
                scoreRepo.findBySecurityIdAndScoreDate(securityId, scoreDate);
        if (score.isEmpty()) return ResponseEntity.notFound().build();

        Map<Long, BigDecimal[]> pf = loadPriceAndFlow(List.of(securityId), scoreDate);
        BigDecimal[] data = pf.getOrDefault(securityId, new BigDecimal[15]);
        String[] statuses = loadStatuses(List.of(securityId)).get(securityId);
        return ResponseEntity.ok(ScreenerItemResponse.of(score.get(), inst, data, statuses));
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
            FROM nextpick_scores cs
            JOIN instruments i ON i.id = cs.security_id
            LEFT JOIN LATERAL (
                SELECT close_adj FROM price_daily
                WHERE security_id = cs.security_id
                ORDER BY trade_date DESC LIMIT 1
            ) p ON true
            WHERE cs.score_date = (SELECT MAX(score_date) FROM nextpick_scores WHERE market = ?)
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
            FROM nextpick_scores cs
            JOIN instruments i ON i.id = cs.security_id
            WHERE cs.score_date = (SELECT MAX(score_date) FROM nextpick_scores WHERE market = 'KR')
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
                FROM nextpick_scores cs
                JOIN instruments i ON i.id = cs.security_id
                WHERE cs.score_date = (SELECT MAX(score_date) FROM nextpick_scores WHERE market = 'KR')
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
                .map(NextpickScore::getScoreDate)
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
            FROM nextpick_scores cs
            JOIN nextpick_scores prev ON prev.security_id = cs.security_id
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
     * 가격+수급 통합 조회 (단일 SQL). 시간외 종가(after_hours_close) 우선 반영.
     * [0]=closePrice [1]=instNetBuy10d [2]=foreignNetBuy10d
     * [3]=changeRate(%) [4]=52wHigh [5]=volume [6]=turnover [7]=marketCap(원)
     * [8]=programNetBuy10d [9]=afterHoursClose [10]=afterHoursChangePct
     * [11]=per [12]=pbr [13]=eps [14]=bps (KIS EOD 밸류에이션 스냅샷)
     */
    private Map<Long, BigDecimal[]> loadPriceAndFlow(List<Long> ids, LocalDate scoreDate) {
        if (ids.isEmpty()) return Map.of();

        Map<Long, BigDecimal[]> result = new HashMap<>();
        for (Long id : ids) result.put(id, new BigDecimal[15]);

        Long[] idArr = ids.toArray(new Long[0]);

        String sql = """
            WITH ranked AS (
                SELECT security_id, close_adj, volume, turnover, trade_date,
                       ROW_NUMBER() OVER (PARTITION BY security_id ORDER BY trade_date DESC) rn,
                       LEAD(close_adj) OVER (PARTITION BY security_id ORDER BY trade_date DESC) AS prev_close,
                       LEAD(volume) OVER (PARTITION BY security_id ORDER BY trade_date DESC) AS prev_volume
                FROM price_daily
                WHERE security_id = ANY(?) AND trade_date >= CURRENT_DATE - INTERVAL '14 days'
            ),
            flow AS (
                SELECT security_id, inst_net_buy_10d, foreign_net_buy_10d, program_net_buy_10d,
                       after_hours_close, after_hours_change_pct, per, pbr, eps, bps
                FROM derived_metrics
                WHERE as_of_date = (SELECT MAX(as_of_date) FROM derived_metrics WHERE inst_net_buy_10d IS NOT NULL)
            )
            SELECT r.security_id,
                   COALESCE(f.after_hours_close, r.close_adj) AS effective_close,
                   r.volume, r.turnover,
                   -- 전일이 거래정지(거래량 0) 구간이면 전일종가가 stale(정지 전 고정값)이라
                   -- 재개일 갭이 253% 같은 허위 등락률을 만든다 → 신뢰 불가로 null 처리.
                   -- 정상 상한가(전일 거래량>0)는 영향 없음. 실시간 창에서만 KIS 정확값 표시.
                   CASE WHEN r.prev_close > 0 AND COALESCE(r.prev_volume, 0) > 0
                        THEN ROUND((COALESCE(f.after_hours_close, r.close_adj) - r.prev_close) / r.prev_close * 100, 2)
                   END AS change_rate,
                   COALESCE(f.after_hours_close, r.close_adj) * i.total_shares AS market_cap,
                   f.inst_net_buy_10d, f.foreign_net_buy_10d, f.program_net_buy_10d,
                   f.after_hours_close, f.after_hours_change_pct,
                   f.per, f.pbr, f.eps, f.bps
            FROM ranked r
            JOIN instruments i ON i.id = r.security_id
            LEFT JOIN flow f ON f.security_id = r.security_id
            WHERE r.rn = 1
            """;
        try {
            jdbc.query(con -> {
                PreparedStatement ps = con.prepareStatement(sql);
                ps.setArray(1, con.createArrayOf("bigint", idArr));
                return ps;
            }, rs -> {
                long sid = rs.getLong("security_id");
                if (!result.containsKey(sid)) return;
                BigDecimal[] row = result.get(sid);
                row[0] = rs.getBigDecimal("effective_close");
                row[1] = rs.getBigDecimal("inst_net_buy_10d");
                row[2] = rs.getBigDecimal("foreign_net_buy_10d");
                row[3] = rs.getBigDecimal("change_rate");
                row[5] = rs.getBigDecimal("volume");
                row[6] = rs.getBigDecimal("turnover");
                row[7] = rs.getBigDecimal("market_cap");
                row[8] = rs.getBigDecimal("program_net_buy_10d");
                row[9] = rs.getBigDecimal("after_hours_close");
                row[10] = rs.getBigDecimal("after_hours_change_pct");
                row[11] = rs.getBigDecimal("per");
                row[12] = rs.getBigDecimal("pbr");
                row[13] = rs.getBigDecimal("eps");
                row[14] = rs.getBigDecimal("bps");
            });
        } catch (Exception e) {
            log.warn("price+flow 조회 실패: {}", e.getMessage());
        }

        return result;
    }

    /**
     * 가격 기반 정렬: nextpick_scores 내장 가격 컬럼으로 인덱스 정렬 (CTE 없음).
     *
     * 정합성 주의(알려진 한계): 여기서 쓰는 close_price/change_rate는 채점 시점(score_date)에
     * nextpick_scores로 박아둔 값이라, 기본/필터 경로(loadPriceAndFlow)·limit-up·stats가 쓰는
     * price_daily의 MAX(trade_date) 앵커와 다르다. 채점이 지연돼 score_date < max(trade_date)면
     * 가격정렬 탭만 오래된 값을 보일 수 있다. 장중에는 프론트 LIVE_SORT_KEYS 재정렬이 보정한다.
     * 완전 통일하려면 이 경로도 price_daily 최신 앵커를 단일 소스로 써야 하나, 인덱스 정렬 성능과
     * 트레이드오프가 있어 별도 과제로 둔다.
     */
    private ScreenerPageResponse screenByPriceSort(
            LocalDate scoreDate, String market, String sortBy, boolean desc,
            int page, int size, double minScore,
            String keyword, String sector, Long minCap, Long maxCap) {

        String sortCol = switch (sortBy) {
            case "closePrice"       -> "cs.close_price";
            case "changeRate"       -> "cs.change_rate";
            case "volume"           -> "cs.volume";
            case "turnover"         -> "cs.turnover";
            case "marketCap"        -> "cs.market_cap";
            case "foreignNetBuy10d" -> "f.foreign_net_buy_10d";
            case "instNetBuy10d"    -> "f.inst_net_buy_10d";
            default                 -> "cs.turnover";
        };
        String direction = desc ? "DESC NULLS LAST" : "ASC NULLS LAST";

        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder("cs.score_date = ? AND cs.market = ? AND cs.composite_score >= ?");
        params.add(java.sql.Date.valueOf(scoreDate));
        params.add(market);
        params.add(minScore);

        if (keyword != null) {
            where.append(" AND (LOWER(i.name) LIKE ? OR i.ticker LIKE ?)");
            params.add("%" + keyword + "%");
            params.add("%" + keyword.toUpperCase() + "%");
        }
        if (sector != null) {
            where.append(" AND i.sector = ?");
            params.add(sector);
        }
        if (minCap != null) {
            where.append(" AND cs.market_cap >= ?");
            params.add(BigDecimal.valueOf(minCap));
        }
        if (maxCap != null) {
            where.append(" AND cs.market_cap <= ?");
            params.add(BigDecimal.valueOf(maxCap));
        }

        // 총 건수: 가벼운 count 쿼리 (JOIN/윈도우 없음)
        boolean needInst = keyword != null || sector != null;
        String countSql = "SELECT COUNT(*) FROM nextpick_scores cs"
                + (needInst ? " JOIN instruments i ON i.id = cs.security_id" : "")
                + " WHERE " + where;
        long totalCount = jdbc.queryForObject(countSql, Long.class, params.toArray());

        String sql = "SELECT cs.security_id, cs.score_date, cs.market, cs.market_rank, cs.market_percentile,"
                + " cs.composite_score, cs.c_score, cs.a_score, cs.n_score,"
                + " cs.s_score, cs.l_score, cs.i_score, cs.m_score,"
                + " i.ticker, i.name, i.sector, i.exchange,"
                + " cs.close_price, cs.change_rate, cs.volume, cs.turnover, cs.market_cap,"
                + " f.inst_net_buy_10d, f.foreign_net_buy_10d, f.program_net_buy_10d,"
                + " f.after_hours_close, f.after_hours_change_pct,"
                + " sd.statuses"
                + " FROM nextpick_scores cs"
                + " JOIN instruments i ON i.id = cs.security_id"
                + " LEFT JOIN derived_metrics f ON f.security_id = cs.security_id"
                + "   AND f.as_of_date = (SELECT MAX(as_of_date) FROM derived_metrics WHERE inst_net_buy_10d IS NOT NULL)"
                + " LEFT JOIN security_status_daily sd ON sd.security_id = cs.security_id"
                + "   AND sd.status_date = (SELECT MAX(status_date) FROM security_status_daily)"
                + " WHERE " + where
                + " ORDER BY " + sortCol + " " + direction
                + " LIMIT ? OFFSET ?";

        List<Object> dataParams = new ArrayList<>(params);
        dataParams.add(size);
        dataParams.add((long) page * size);

        List<ScreenerItemResponse> items = jdbc.query(sql, (rs, idx) -> {
            return new ScreenerItemResponse(
                rs.getLong("security_id"),
                rs.getString("ticker"),
                rs.getString("name"),
                rs.getString("market"),
                rs.getDate("score_date").toLocalDate(),
                rs.getObject("market_rank") != null ? rs.getInt("market_rank") : null,
                rs.getBigDecimal("market_percentile"),
                rs.getBigDecimal("composite_score"),
                rs.getBigDecimal("c_score"), rs.getBigDecimal("a_score"),
                rs.getBigDecimal("n_score"), rs.getBigDecimal("s_score"),
                rs.getBigDecimal("l_score"), rs.getBigDecimal("i_score"), rs.getBigDecimal("m_score"),
                rs.getBigDecimal("close_price"),
                rs.getBigDecimal("change_rate"),
                null,
                rs.getBigDecimal("volume"),
                rs.getBigDecimal("turnover"),
                rs.getBigDecimal("inst_net_buy_10d"),
                rs.getBigDecimal("foreign_net_buy_10d"),
                rs.getBigDecimal("program_net_buy_10d"),
                rs.getBigDecimal("after_hours_close"),
                rs.getBigDecimal("after_hours_change_pct"),
                rs.getBigDecimal("market_cap"),
                rs.getString("sector"),
                null,
                false, null,
                arrToStrings(rs.getArray("statuses")),
                null, null, null, null,  // per/pbr/eps/bps — 아래 withPriceFlow가 loadPriceAndFlow 값으로 오버레이
                rs.getString("exchange")
            );
        }, dataParams.toArray());

        // 표시 가격/수급을 다른 경로(loadPriceAndFlow, price_daily 최신 앵커)와 통일 —
        // 정렬은 nextpick_scores 인덱스 유지(성능), 표시값만 최신으로 교체해 탭 간 불일치 제거.
        // price_daily에 없는 종목(거래정지 등)은 loadPriceAndFlow 값이 null이라 기존값 보존(coalesce).
        if (!items.isEmpty()) {
            List<Long> ids = items.stream().map(ScreenerItemResponse::securityId).toList();
            Map<Long, BigDecimal[]> pf = loadPriceAndFlow(ids, scoreDate);
            items = items.stream()
                    .map(it -> {
                        BigDecimal[] d = pf.get(it.securityId());
                        return d == null ? it : withPriceFlow(it, d);
                    })
                    .collect(java.util.stream.Collectors.toList());
        }

        return new ScreenerPageResponse(items, totalCount, page, size);
    }

    private static BigDecimal coalesce(BigDecimal a, BigDecimal b) { return a != null ? a : b; }

    /** 가격/수급 필드만 loadPriceAndFlow 값(price_daily 최신 앵커)으로 교체(널이면 기존값 유지). */
    private static ScreenerItemResponse withPriceFlow(ScreenerItemResponse it, BigDecimal[] d) {
        // d 인덱스: [0]close [1]inst [2]foreign [3]changeRate [4]52wHigh [5]vol [6]turnover [7]cap [8]program [9]ahClose [10]ahChg [11]per [12]pbr [13]eps [14]bps
        return new ScreenerItemResponse(
                it.securityId(), it.ticker(), it.name(), it.market(), it.scoreDate(),
                it.marketRank(), it.marketPercentile(), it.compositeScore(),
                it.cScore(), it.aScore(), it.nScore(), it.sScore(), it.lScore(), it.iScore(), it.mScore(),
                coalesce(d[0], it.closePrice()),
                coalesce(d[3], it.changeRate()),
                coalesce(d[4], it.weekHigh52()),
                coalesce(d[5], it.volume()),
                coalesce(d[6], it.turnover()),
                coalesce(d[1], it.instNetBuy10d()),
                coalesce(d[2], it.foreignNetBuy10d()),
                coalesce(d[8], it.programNetBuy10d()),
                coalesce(d[9], it.afterHoursPrice()),
                coalesce(d[10], it.afterHoursChangeRate()),
                coalesce(d[7], it.marketCap()),
                it.sector(), it.scoreDelta(), it.breakoutToday(), it.baseDays(), it.statuses(),
                coalesce(d[11], it.per()), coalesce(d[12], it.pbr()),
                coalesce(d[13], it.eps()), coalesce(d[14], it.bps()), it.exchange()
        );
    }

    /** PostgreSQL TEXT[] → String[] (null 안전). */
    private static String[] arrToStrings(java.sql.Array arr) {
        if (arr == null) return null;
        try {
            Object raw = arr.getArray();
            if (raw instanceof String[] s) return s.length == 0 ? null : s;
            if (raw instanceof Object[] o) {
                String[] out = new String[o.length];
                for (int i = 0; i < o.length; i++) out[i] = o[i] == null ? null : o[i].toString();
                return out.length == 0 ? null : out;
            }
        } catch (Exception ignore) { }
        return null;
    }

    /**
     * 종목 특이사항(뱃지) 최신 스냅샷 조회 → security_id → statuses[].
     * security_status_daily의 전역 MAX(status_date) 앵커(가격 앵커와 동일 원리).
     * 특이사항 없는 종목은 맵에 없음(정상).
     */
    private Map<Long, String[]> loadStatuses(List<Long> ids) {
        if (ids == null || ids.isEmpty()) return Map.of();
        Map<Long, String[]> result = new HashMap<>();
        Long[] idArr = ids.toArray(new Long[0]);
        String sql = """
            SELECT security_id, statuses
            FROM security_status_daily
            WHERE security_id = ANY(?)
              AND status_date = (SELECT MAX(status_date) FROM security_status_daily)
            """;
        jdbc.query(con -> {
            PreparedStatement ps = con.prepareStatement(sql);
            ps.setArray(1, con.createArrayOf("bigint", idArr));
            return ps;
        }, rs -> {
            String[] st = arrToStrings(rs.getArray("statuses"));
            if (st != null) result.put(rs.getLong("security_id"), st);
        });
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
