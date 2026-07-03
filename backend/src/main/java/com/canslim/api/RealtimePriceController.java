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
 * 장중 실시간 시세 (KIS 주식현재가시세 FHKST01010400).
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
    private static final long CACHE_TTL_MS = 15_000; // 15초 캐시

    private final RestTemplate rest = new RestTemplate();

    // 토큰 인메모리 캐시
    private String cachedToken;
    private Instant tokenExpiry = Instant.EPOCH;

    // KIS config (lazy-loaded)
    private Map<String, Object> kisConfig;

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
            cfg = loadKisConfig();
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
            token = getToken(cfg);
            r.put("tokenOk", token != null && !token.isBlank());
        } catch (Exception e) {
            r.put("tokenOk", false);
            r.put("tokenError", String.valueOf(e));
            return ResponseEntity.ok(r);
        }

        try {
            r.put("quote", fetchQuote(ticker, cfg, token));
        } catch (Exception e) {
            r.put("quoteError", String.valueOf(e));
        }
        return ResponseEntity.ok(r);
    }

    /** 캐시 우선 조회 → 미스 시 KIS 호출. */
    private Map<String, Object> quoteFor(String ticker) throws Exception {
        CachedQuote cached = quoteCache.get(ticker);
        long now = System.currentTimeMillis();
        if (cached != null && now - cached.ts() < CACHE_TTL_MS) return cached.data();

        Map<String, Object> cfg = loadKisConfig();
        String token = getToken(cfg);
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
        headers.set("tr_id",    "FHKST01010400");
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

            Map<String, Object> cfg = loadKisConfig();
            String token = getToken(cfg);

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

    /** 평일 09:00~15:30 KST 여부 (공휴일은 미고려 — 공휴일엔 KIS가 전일값 반환). */
    private boolean isKrMarketOpen() {
        ZonedDateTime now = ZonedDateTime.now(KST);
        DayOfWeek d = now.getDayOfWeek();
        if (d == DayOfWeek.SATURDAY || d == DayOfWeek.SUNDAY) return false;
        LocalTime t = now.toLocalTime();
        return !t.isBefore(LocalTime.of(9, 0)) && !t.isAfter(LocalTime.of(15, 30));
    }

    private synchronized String getToken(Map<String, Object> cfg) throws Exception {
        if (cachedToken != null && Instant.now().isBefore(tokenExpiry)) return cachedToken;

        log.info("KIS 토큰 발급 요청...");
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        Map<String, String> body = Map.of(
                "grant_type", "client_credentials",
                "appkey",     (String) cfg.get("app_key"),
                "appsecret",  (String) cfg.get("app_secret")
        );
        ResponseEntity<Map> resp = rest.postForEntity(
                KIS_BASE + "/oauth2/tokenP", new HttpEntity<>(body, h), Map.class);

        @SuppressWarnings("unchecked")
        Map<String, Object> data = resp.getBody();
        if (data == null) throw new RuntimeException("토큰 발급 응답 없음");

        cachedToken = (String) data.get("access_token");
        long expiresIn = Long.parseLong(String.valueOf(data.getOrDefault("expires_in", "86400")));
        tokenExpiry = Instant.now().plusSeconds(expiresIn - 600);
        log.info("KIS 토큰 발급 완료 ({}s)", expiresIn);
        return cachedToken;
    }

    @SuppressWarnings("unchecked")
    private synchronized Map<String, Object> loadKisConfig() throws Exception {
        if (kisConfig != null) return kisConfig;

        // 1순위: 환경변수 직접 주입 (KIS_APP_KEY / KIS_APP_SECRET) — 컨테이너에 파일 불필요
        String envKey = System.getenv("KIS_APP_KEY");
        String envSecret = System.getenv("KIS_APP_SECRET");
        if (envKey != null && !envKey.isBlank() && envSecret != null && !envSecret.isBlank()) {
            kisConfig = Map.of("app_key", envKey, "app_secret", envSecret);
            log.info("KIS config: 환경변수에서 로드");
            return kisConfig;
        }

        // 2순위: KIS_CONFIG_PATH 파일 (Docker 볼륨 마운트) → 3순위: 로컬 개발 상대경로
        String envPath = System.getenv("KIS_CONFIG_PATH");
        Path yamlPath = (envPath != null && !envPath.isBlank())
                ? Paths.get(envPath)
                : Paths.get("").toAbsolutePath().getParent().resolve("etl/config/kis.yaml");
        try (FileInputStream fis = new FileInputStream(yamlPath.toFile())) {
            kisConfig = new Yaml().load(fis);
        }
        log.info("KIS config: 파일에서 로드 ({})", yamlPath);
        return kisConfig;
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
