package com.canslim.api;

import com.canslim.api.dto.InstrumentDetailResponse;
import com.canslim.domain.DerivedMetric;
import com.canslim.domain.Instrument;
import com.canslim.repository.DerivedMetricRepository;
import com.canslim.repository.InstrumentRepository;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

/**
 * 종목 정보 API.
 *
 * GET /api/instruments
 *   ?market=KOSPI          (필수)
 *   — 활성 종목 목록 (파생 지표 미포함, 리스트 성능 우선)
 *
 * GET /api/instruments/{id}
 *   ?date=2026-06-21       (파생 지표 기준일, 생략 시 오늘)
 *   — 종목 상세 + 최신 파생 지표
 */
@RestController
@RequestMapping("/api/instruments")
public class InstrumentController {

    private final InstrumentRepository    instRepo;
    private final DerivedMetricRepository dmRepo;

    public InstrumentController(InstrumentRepository instRepo,
                                DerivedMetricRepository dmRepo) {
        this.instRepo = instRepo;
        this.dmRepo   = dmRepo;
    }

    @GetMapping
    public ResponseEntity<List<InstrumentDetailResponse>> list(
            @RequestParam String market) {

        List<InstrumentDetailResponse> result = instRepo
                .findByMarketAndActiveTrue(market)
                .stream()
                .map(inst -> InstrumentDetailResponse.of(inst, null))
                .toList();

        return ResponseEntity.ok(result);
    }

    @GetMapping("/{id}")
    public ResponseEntity<InstrumentDetailResponse> get(
            @PathVariable Long id,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {

        Instrument inst = instRepo.findById(id).orElse(null);
        if (inst == null) return ResponseEntity.notFound().build();

        LocalDate asOf = date != null ? date : LocalDate.now();
        DerivedMetric dm = dmRepo.findLatestBySecurityIdAndDate(id, asOf).orElse(null);

        return ResponseEntity.ok(InstrumentDetailResponse.of(inst, dm));
    }
}
