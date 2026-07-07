package com.canslim.api;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.yaml.snakeyaml.Yaml;

import java.io.FileInputStream;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 장중 실시간 시세 (KIS 주식현재가시세 FHKST01010100).
 *
 *   GET /api/realtime/price?ticker=005930
 *       → 단일 종목 { ticker, name, price, change, changeRate, volume, turnover }
 *   GET /api/realtime/quotes?tickers=005930,000660,...
 *       → 여러 종목 배치 조회 (화면에 보이는 30행 등). 장외 시간엔 빈 배열 반환.
 *
 * 설계:
 *   - CANSLIM 점수는 일 1회 배치(EOD). 이 컨트롤러는 시세성 필드(현재가·등락률·
 *     거래량·거래대금)만 장중 실시간으로 덮어쓰기용으로 제공.
 *   - 종목당 1콜(KIS 제약) → 화면에 보이는 종목만 호출하는 전제.
 *   - 15초 인메모리 캐시로 페이지 재진입 시 중복 호출 절감.
 *   - 장중(평일 09:00~15:30 KST)에만 KIS 호출, 그 외엔 빈 결과(프론트는 배치값 유지).
 */
@RestController
@RequestMapping("/api/realtime")
public class RealtimePriceController {

    private static final Logger log = LoggerFactory.getLogger(RealtimePriceController.class);
    private static final String KIS_BASE = "https://openapi.koreainvestment.com:9443";
    private static final String PRICE_PATH = "/uapi/domestic-stock/v1/quotations/inquire-price";
    private static final String INVESTOR_PATH = "/uapi/domestic-stock/v1/quotations/inquire-investor";
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int MAX_BATCH = 60;         // 배치 상한 (쿼터 보호)
    private static final long CACHE_TTL_MS = 10_000; // 10초 캐시 (15초 폴링이 항상 fresh 받도록)

    private final RestTemplate rest = new RestTemplate();
    private final KisClient kis;

    public RealtimePriceController(KisClient kis) { this.kis = kis; }

    // 시세 캐시 (ticker → {data, ts})
    private final Map<String, CachedQuote> quoteCache = new ConcurrentHashMap<>();
    private final Map<String, CachedQuote> investorCache = new ConcurrentHashMap<>();

    private record CachedQuote(Map<String, Object> data, long ts) {}

    @GetMapping("/price")
    public ResponseEntity<Map<String, Object>> getPrice(@RequestParam("ticker") String ticker) {
        try {
            Map<String, Object> q = quoteFor(ticker);
            if (q == null) return ResponseEntity.status(502).body(Map.of("error", "quote null"));
            return ResponseEntity.ok(q);
        } catch (Exception e) {
            log.warn("KIS 현재가 조회 실패 ({}): {}", ticker, e.getMessage());
            return ResponseEntity.status(502).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/quotes")
    public ResponseEntity<List<Map<String, Object>>> getQuotes(@RequestParam("tickers") String tickersCsv) {
        // 장외 시간엔 실시간 의미 없음 → 빈 배열 (프론트는 배치 EOD값 유지)
        if (!isKrMarketOpen()) return ResponseEntity.ok(List.of());

        List<Map<String, Object>> result = new ArrayList<>();
        String[] tickers = tickersCsv.split(",");
        int count = 0;
        for (String raw : tickers) {
            String ticker = raw.trim();
            if (ticker.isEmpty()) continue;
            if (++count > MAX_BATCH) break;
            try {
                Map<String, Object> q = quoteFor(ticker);
                if (q != null) result.add(q);
            } catch (Exception e) {
                log.debug("KIS 배치 시세 실패 ({}): {}", ticker, e.getMessage());
                // 개별 실패는 무시하고 나머지 진행
            }
        }
        return ResponseEntity.ok(result);
    }

    /**
     * GET /api/realtime/debug?ticker=005930
     * 실시간 시세가 왜 안 나오는지 단계별 진단 (키 값은 노출 안 함).
     * 설정 로드 → 토큰 발급 → 시세 1콜 순서로 어디서 막히는지 표시.
     */
    @GetMapping("/debug")
    public ResponseEntity<Map<String, Object>> debug(
            @RequestParam(value = "ticker", defaultValue = "005930") String ticker) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("kstTime", ZonedDateTime.now(KST).toString());
        r.put("marketOpen", isKrMarketOpen());

        Map<String, Object> cfg;
        try {
            cfg = kis.getConfig();
            r.put("configLoaded", true);
            r.put("hasAppKey", cfg.get("app_key") != null && !String.valueOf(cfg.get("app_key")).isBlank());
            r.put("hasAppSecret", cfg.get("app_secret") != null && !String.valueOf(cfg.get("app_secret")).isBlank());
        } catch (Exception e) {
            r.put("configLoaded", false);
            r.put("configError", String.valueOf(e));
            return ResponseEntity.ok(r);
        }

        String token;
        try {
            token = kis.getToken();
            r.put("tokenOk", token != null && !token.isBlank());
        } catch (Exception e) {
            r.put("tokenOk", false);
            r.put("tokenError", String.valueOf(e));
            return ResponseEntity.ok(r);
        }

        // KIS 시세 원본 응답을 그대로 노출 (rt_cd/msg1 = 실패 사유)
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("authorization", "Bearer " + token);
            headers.set("appkey",   (String) cfg.get("app_key"));
            headers.set("appsecret", (String) cfg.get("app_secret"));
            headers.set("tr_id",    "FHKST01010100");
            headers.set("custtype", "P");
            String url = KIS_BASE + PRICE_PATH + "?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=" + ticker;

            ResponseEntity<Map> resp = rest.exchange(url, HttpMethod.GET, new HttpEntity<>(headers), Map.class);
            r.put("priceHttpStatus", resp.getStatusCode().value());
            Map<?, ?> body = resp.getBody();
            if (body != null) {
                r.put("rt_cd", body.get("rt_cd"));   // "0" = 성공
                r.put("msg_cd", body.get("msg_cd"));
                r.put("msg1", body.get("msg1"));     // 실패 사유 메시지
                Object out = body.get("output");
                r.put("hasOutput", out != null);
                if (out instanceof Map<?, ?> m) r.put("stck_prpr", m.get("stck_prpr"));
            }
        } catch (org.springframework.web.client.HttpStatusCodeException he) {
            r.put("priceHttpStatus", he.getStatusCode().value());
            r.put("priceBody", he.getResponseBodyAsString());
        } catch (Exception e) {
            r.put("priceCallError", String.valueOf(e));
        }
        return ResponseEntity.ok(r);
    }

    /** 캐시 우선 조회 → 미스 시 KIS 호출. */
    private Map<String, Object> quoteFor(String ticker) throws Exception {
        CachedQuote cached = quoteCache.get(ticker);
        long now = System.currentTimeMillis();
        if (cached != null && now - cached.ts() < CACHE_TTL_MS) return cached.data();

        Map<String, Object> cfg = kis.getConfig();
        String token = kis.getToken();
        Map<String, Object> q = fetchQuote(ticker, cfg, token);
        if (q != null) quoteCache.put(ticker, new CachedQuote(q, now));
        return q;
    }

    /** KIS 주식현재가시세 1콜 → 시세 맵. */
    private Map<String, Object> fetchQuote(String ticker, Map<String, Object> cfg, String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("authorization", "Bearer " + token);
        headers.set("appkey",   (String) cfg.get("app_key"));
        headers.set("appsecret", (String) cfg.get("app_secret"));
        headers.set("tr_id",    "FHKST01010100");
        headers.set("custtype", "P");

        String url = KIS_BASE + PRICE_PATH
                + "?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=" + ticker;

        ResponseEntity<Map> resp = rest.exchange(
                url, HttpMethod.GET, new HttpEntity<>(headers), Map.class);

        if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) return null;

        @SuppressWarnings("unchecked")
        Map<String, Object> output = (Map<String, Object>) resp.getBody().get("output");
        if (output == null) return null;

        return Map.of(
                "ticker",     ticker,
                "name",       output.getOrDefault("hts_kor_isnm", ""),
                "price",      parseLong((String) output.getOrDefault("stck_prpr", "0")),
                "change",     parseLong((String) output.getOrDefault("prdy_vrss", "0")),
                "changeRate", parseDouble((String) output.getOrDefault("prdy_ctrt", "0")),
                "volume",     parseLong((String) output.getOrDefault("acml_vol", "0")),        // 누적 거래량(주)
                "turnover",   parseLong((String) output.getOrDefault("acml_tr_pbmn", "0")),    // 누적 거래대금(원)
                "programNetVol", parseLong((String) output.getOrDefault("pgtr_ntby_qty", "0")) // 프로그램 순매수(주) — 3단계
        );
    }

    /**
     * GET /api/realtime/investor?ticker=005930
     * KIS 주식현재가 투자자 (FHKST01010900) → 당일 기관/외국인/개인 순매수.
     * 종목 상세 전용. 장중엔 잠정치(가집계).
     */
    @GetMapping("/investor")
    public ResponseEntity<Map<String, Object>> getInvestor(@RequestParam("ticker") String ticker) {
        try {
            CachedQuote cached = investorCache.get(ticker);
            long now = System.currentTimeMillis();
            if (cached != null && now - cached.ts() < CACHE_TTL_MS)
                return ResponseEntity.ok(cached.data());

            Map<String, Object> cfg = kis.getConfig();
            String token = kis.getToken();

            HttpHeaders headers = new HttpHeaders();
            headers.set("authorization", "Bearer " + token);
            headers.set("appkey",   (String) cfg.get("app_key"));
            headers.set("appsecret", (String) cfg.get("app_secret"));
            headers.set("tr_id",    "FHKST01010900");
            headers.set("custtype", "P");

            String url = KIS_BASE + INVESTOR_PATH
                    + "?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=" + ticker;

            ResponseEntity<Map> resp = rest.exchange(
                    url, HttpMethod.GET, new HttpEntity<>(headers), Map.class);
            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null)
                return ResponseEntity.status(502).body(Map.of("error", "investor http"));

            // output = 최근 일자별 배열, [0] = 당일(가장 최근)
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> out = (List<Map<String, Object>>) resp.getBody().get("output");
            if (out == null || out.isEmpty())
                return ResponseEntity.status(502).body(Map.of("error", "investor empty"));
            Map<String, Object> row = out.get(0);

            // 순매수 거래대금(원) 기준. 필드/단위는 서버에서 KIS 응답으로 검증 필요.
            Map<String, Object> data = Map.of(
                    "ticker",            ticker,
                    "date",              row.getOrDefault("stck_bsop_date", ""),
                    "foreignNetBuy",     parseLong((String) row.getOrDefault("frgn_ntby_tr_pbmn", "0")),
                    "instNetBuy",        parseLong((String) row.getOrDefault("orgn_ntby_tr_pbmn", "0")),
                    "individualNetBuy",  parseLong((String) row.getOrDefault("prsn_ntby_tr_pbmn", "0")),
                    "foreignNetVol",     parseLong((String) row.getOrDefault("frgn_ntby_qty", "0")),
                    "instNetVol",        parseLong((String) row.getOrDefault("orgn_ntby_qty", "0"))
            );
            investorCache.put(ticker, new CachedQuote(data, now));
            return ResponseEntity.ok(data);

        } catch (Exception e) {
            log.warn("KIS 투자자 조회 실패 ({}): {}", ticker, e.getMessage());
            return ResponseEntity.status(502).body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 평일 09:00~18:30 KST 여부 (공휴일 미고려 — 공휴일엔 KIS가 전일값 반환).
     *
     * 정규장은 15:30에 끝나지만 그 상한을 18:30으로 늘렸다:
     *   - 15:30 종가 확정 후에도 KIS FHKST01010100은 '오늘 종가 + 오늘 등락률'을 반환.
     *   - EOD 배치(run_daily, crontab 16:10 KST)가 price_daily에 오늘 종가를 적재하기까지
     *     15:30~16:20 공백이 생겨, 이 구간엔 배치값이 '어제 종가'라 오늘 급등락이 안 보였다.
     *   - 마감 후에도 오버레이를 열어두어 배치가 따라잡기 전까지 오늘 등락을 계속 노출.
     *   - 16:40 ScoringJob + ETL 완료 후에도 여유를 두어 18:30까지 오버레이 유지.
     */
    private boolean isKrMarketOpen() {
        ZonedDateTime now = ZonedDateTime.now(KST);
        DayOfWeek d = now.getDayOfWeek();
        if (d == DayOfWeek.SATURDAY || d == DayOfWeek.SUNDAY) return false;
        LocalTime t = now.toLocalTime();
        return !t.isBefore(LocalTime.of(9, 0)) && !t.isAfter(LocalTime.of(18, 30));
    }

    private long parseLong(String s) {
        try { return Long.parseLong(s.replace(",", "").trim()); }
        catch (Exception e) { return 0; }
    }

    private double parseDouble(String s) {
        try { return Double.parseDouble(s.replace(",", "").trim()); }
        catch (Exception e) { return 0.0; }
    }
}
