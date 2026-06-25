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
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * GET /api/realtime/price?ticker=005930
 * KIS 주식현재가시세 (FHKST01010400) 호출 → { ticker, price, change, changeRate }
 */
@RestController
@RequestMapping("/api/realtime")
public class RealtimePriceController {

    private static final Logger log = LoggerFactory.getLogger(RealtimePriceController.class);
    private static final String KIS_BASE = "https://openapi.koreainvestment.com:9443";
    private static final String PRICE_PATH = "/uapi/domestic-stock/v1/quotations/inquire-price";

    private final RestTemplate rest = new RestTemplate();

    // 토큰 인메모리 캐시
    private String cachedToken;
    private Instant tokenExpiry = Instant.EPOCH;

    // KIS config (lazy-loaded)
    private Map<String, Object> kisConfig;

    @GetMapping("/price")
    public ResponseEntity<Map<String, Object>> getPrice(@RequestParam String ticker) {
        try {
            Map<String, Object> cfg = loadKisConfig();
            String token = getToken(cfg);

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

            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null)
                return ResponseEntity.status(502).build();

            @SuppressWarnings("unchecked")
            Map<String, Object> output = (Map<String, Object>) resp.getBody().get("output");
            if (output == null)
                return ResponseEntity.status(502).body(Map.of("error", "output null"));

            String priceStr      = (String) output.getOrDefault("stck_prpr", "0");
            String changeStr     = (String) output.getOrDefault("prdy_vrss", "0");
            String changeRateStr = (String) output.getOrDefault("prdy_ctrt", "0");
            String stockName     = (String) output.getOrDefault("hts_kor_isnm", "");

            return ResponseEntity.ok(Map.of(
                    "ticker",     ticker,
                    "name",       stockName,
                    "price",      parseLong(priceStr),
                    "change",     parseLong(changeStr),
                    "changeRate", parseDouble(changeRateStr)
            ));

        } catch (Exception e) {
            log.warn("KIS 현재가 조회 실패 ({}): {}", ticker, e.getMessage());
            return ResponseEntity.status(502).body(Map.of("error", e.getMessage()));
        }
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
        Path yamlPath = Paths.get("").toAbsolutePath()
                .getParent().resolve("etl/config/kis.yaml");
        try (FileInputStream fis = new FileInputStream(yamlPath.toFile())) {
            kisConfig = new Yaml().load(fis);
        }
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
