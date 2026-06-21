package com.canslim.api;

import com.canslim.scoring.job.ScoringJob;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.Map;

/**
 * 관리자 API — 수동 채점 실행.
 *
 * POST /api/admin/scoring/run
 *   ?date=2026-06-21   (생략 시 오늘)
 *
 * 주의: 프로덕션에서는 Spring Security로 인증 보호 필요 (Phase 4).
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final ScoringJob scoringJob;

    public AdminController(ScoringJob scoringJob) {
        this.scoringJob = scoringJob;
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
}
