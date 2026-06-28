package com.canslim.api;

import com.canslim.domain.MarketState;
import com.canslim.repository.MarketStateRepository;
import com.canslim.scoring.job.ScoringJob;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 관리자 API.
 *
 * POST /api/admin/scoring/run              — 수동 채점 실행
 * GET  /api/admin/market-state             — 최신 시장 국면 (KOSPI + KOSDAQ)
 * GET  /api/admin/market-state/history     — 최근 N일 이력
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final ScoringJob scoringJob;
    private final MarketStateRepository marketStateRepo;

    public AdminController(ScoringJob scoringJob, MarketStateRepository marketStateRepo) {
        this.scoringJob = scoringJob;
        this.marketStateRepo = marketStateRepo;
    }

    @PostMapping("/scoring/run")
    public ResponseEntity<Map<String, Object>> runScoring(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {

        LocalDate scoreDate = date != null ? date : LocalDate.now();
        long t0 = System.currentTimeMillis();
        scoringJob.runNow(scoreDate);
        long elapsed = System.currentTimeMillis() - t0;
        return ResponseEntity.ok(Map.of(
                "scoreDate", scoreDate.toString(),
                "elapsedMs", elapsed,
                "status", "completed"
        ));
    }

    // ── GET /api/admin/market-state ────────────────────────────
    @GetMapping("/market-state")
    public ResponseEntity<List<Map<String, Object>>> getMarketState() {
        List<Map<String, Object>> result = List.of("KOSPI", "KOSDAQ").stream()
                .map(m -> {
                    Optional<MarketState> opt = marketStateRepo.findTopByMarketOrderByStateDateDesc(m);
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("market", m);
                    opt.ifPresentOrElse(ms -> {
                        row.put("stateDate",            ms.getStateDate());
                        row.put("marketPhase",          ms.getMarketPhase());
                        row.put("trendDirection",       ms.getTrendDirection());
                        row.put("indexClose",           ms.getIndexClose());
                        row.put("ma50d",                ms.getMa50d());
                        row.put("ma200d",               ms.getMa200d());
                        row.put("distributionDayCount", ms.getDistributionDayCount());
                    }, () -> row.put("marketPhase", "UNKNOWN"));
                    return row;
                })
                .toList();
        return ResponseEntity.ok(result);
    }

    // ── GET /api/admin/market-state/history?market=KOSPI&days=30 ──
    @GetMapping("/market-state/history")
    public ResponseEntity<List<Map<String, Object>>> getMarketStateHistory(
            @RequestParam(defaultValue = "KOSPI") String market,
            @RequestParam(defaultValue = "30") int days) {

        LocalDate from = LocalDate.now().minusDays(days);
        List<MarketState> history = marketStateRepo.findByMarketAndDateRange(market, from, LocalDate.now());

        List<Map<String, Object>> result = history.stream()
                .map(ms -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("stateDate",      ms.getStateDate());
                    row.put("marketPhase",    ms.getMarketPhase());
                    row.put("trendDirection", ms.getTrendDirection());
                    row.put("indexClose",     ms.getIndexClose());
                    row.put("ma50d",          ms.getMa50d());
                    row.put("ma200d",         ms.getMa200d());
                    return row;
                })
                .toList();
        return ResponseEntity.ok(result);
    }
}
