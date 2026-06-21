package com.canslim.api;

import com.canslim.api.dto.ScreenerItemResponse;
import com.canslim.api.dto.ScoreHistoryResponse;
import com.canslim.domain.CanslimScore;
import com.canslim.domain.Instrument;
import com.canslim.repository.CanslimScoreRepository;
import com.canslim.repository.InstrumentRepository;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * CANSLIM 스크리너 API.
 *
 * GET /api/screener
 *   ?market=KOSPI          (필수)
 *   &date=2026-06-21       (생략 시 최근 채점일)
 *   &minScore=0.0          (composite 최소값, 기본 0)
 *   &limit=100             (최대 반환 건수, 기본 100, 최대 500)
 *
 * GET /api/screener/{securityId}
 *   ?date=2026-06-21       (생략 시 최근 채점일)
 *
 * GET /api/screener/{securityId}/history
 *   — 해당 종목 채점 이력 전체 (최신순)
 */
@RestController
@RequestMapping("/api/screener")
public class ScreenerController {

    private final CanslimScoreRepository scoreRepo;
    private final InstrumentRepository   instRepo;

    public ScreenerController(CanslimScoreRepository scoreRepo,
                              InstrumentRepository instRepo) {
        this.scoreRepo = scoreRepo;
        this.instRepo  = instRepo;
    }

    @GetMapping
    public ResponseEntity<List<ScreenerItemResponse>> screen(
            @RequestParam String market,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(defaultValue = "0.0") double minScore,
            @RequestParam(defaultValue = "100") int limit) {

        LocalDate scoreDate = resolveDate(market, date);
        if (scoreDate == null) {
            return ResponseEntity.ok(List.of());
        }

        int effectiveLimit = Math.min(limit, 500);

        List<CanslimScore> scores = scoreRepo
                .findByScoreDateAndMarketOrderByCompositeScoreDesc(scoreDate, market)
                .stream()
                .filter(s -> s.getCompositeScore().doubleValue() >= minScore)
                .limit(effectiveLimit)
                .toList();

        if (scores.isEmpty()) return ResponseEntity.ok(List.of());

        Map<Long, Instrument> instMap = loadInstrumentMap(
                scores.stream().map(CanslimScore::getSecurityId).toList());

        List<ScreenerItemResponse> result = scores.stream()
                .filter(s -> instMap.containsKey(s.getSecurityId()))
                .map(s -> ScreenerItemResponse.of(s, instMap.get(s.getSecurityId())))
                .toList();

        return ResponseEntity.ok(result);
    }

    @GetMapping("/{securityId}")
    public ResponseEntity<ScreenerItemResponse> getScore(
            @PathVariable Long securityId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {

        Instrument inst = instRepo.findById(securityId).orElse(null);
        if (inst == null) return ResponseEntity.notFound().build();

        LocalDate scoreDate = resolveDate(inst.getMarket(), date);
        if (scoreDate == null) return ResponseEntity.notFound().build();

        Optional<CanslimScore> score =
                scoreRepo.findBySecurityIdAndScoreDate(securityId, scoreDate);
        return score
                .map(s -> ResponseEntity.ok(ScreenerItemResponse.of(s, inst)))
                .orElse(ResponseEntity.notFound().build());
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
}
