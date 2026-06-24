package com.canslim.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

/**
 * 거시 경제 지표 프록시 — Yahoo Finance v8 chart API (종목별 병렬 조회).
 * GET /api/macro/quotes
 */
@RestController
@RequestMapping("/api/macro")
public class MacroController {

    private static final Logger log = LoggerFactory.getLogger(MacroController.class);

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final ExecutorService POOL  = Executors.newFixedThreadPool(4);

    /** symbol → 한국어 표시명 (순서 유지) */
    private static final LinkedHashMap<String, String> SYMBOLS = new LinkedHashMap<>();
    static {
        SYMBOLS.put("^KS11",    "코스피");
        SYMBOLS.put("^KQ11",    "코스닥");
        SYMBOLS.put("^IXIC",    "나스닥");
        SYMBOLS.put("NQ=F",     "나스닥선물");
        SYMBOLS.put("ES=F",     "S&P500선물");
        SYMBOLS.put("^SOX",     "필라델피아반도체");
        SYMBOLS.put("BTC-USD",  "비트코인");
        SYMBOLS.put("KRW=X",    "달러/원");
        SYMBOLS.put("^TNX",     "미국10Y금리");
        SYMBOLS.put("^VIX",     "공포지수(VIX)");
        SYMBOLS.put("GC=F",     "금");
        SYMBOLS.put("DX-Y.NYB", "달러인덱스");
    }

    public record QuoteDto(
            String symbol, String name,
            Double price, Double change, Double changePct,
            String currency, String marketState) {}

    @GetMapping("/quotes")
    public ResponseEntity<List<QuoteDto>> getQuotes() {
        List<Future<QuoteDto>> futures = SYMBOLS.entrySet().stream()
                .map(e -> POOL.submit(() -> fetchOne(e.getKey(), e.getValue())))
                .toList();

        List<QuoteDto> result = new ArrayList<>();
        for (Future<QuoteDto> f : futures) {
            try {
                QuoteDto q = f.get(10, TimeUnit.SECONDS);
                if (q != null) result.add(q);
            } catch (Exception e) {
                // 개별 실패는 무시
            }
        }
        return ResponseEntity.ok(result);
    }

    private QuoteDto fetchOne(String symbol, String name) {
        // Yahoo Finance v8 chart API — 단일 심볼
        String url = "https://query1.finance.yahoo.com/v8/finance/chart/"
                + symbol.replace("^", "%5E")
                + "?interval=1d&range=2d&includePrePost=false";
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("User-Agent",
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                            + "AppleWebKit/537.36 (KHTML, like Gecko) "
                            + "Chrome/125.0.0.0 Safari/537.36")
                    .header("Accept", "application/json,*/*")
                    .header("Accept-Language", "ko-KR,ko;q=0.9,en-US;q=0.8")
                    .header("Referer", "https://finance.yahoo.com/")
                    .timeout(Duration.ofSeconds(8))
                    .GET().build();

            HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                log.debug("Yahoo Finance {} → HTTP {}", symbol, resp.statusCode());
                return null;
            }

            JsonNode meta = MAPPER.readTree(resp.body())
                    .path("chart").path("result").path(0).path("meta");
            if (meta.isMissingNode()) return null;

            double price    = meta.path("regularMarketPrice").asDouble(0);
            double prevClose = meta.path("chartPreviousClose").asDouble(0);
            double change   = prevClose != 0 ? price - prevClose : 0;
            double changePct = prevClose != 0 ? change / prevClose * 100 : 0;
            String currency = meta.path("currency").asText(null);
            String state    = meta.path("marketState").asText(null);

            return new QuoteDto(symbol, name, price, change, changePct, currency, state);

        } catch (Exception e) {
            log.debug("Yahoo Finance {} 조회 실패: {}", symbol, e.getMessage());
            return null;
        }
    }
}
