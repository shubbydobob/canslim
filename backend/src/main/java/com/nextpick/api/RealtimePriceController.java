package com.nextpick.api;

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
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * 장중 실시간 시세 (KIS 주식현재가시세 FHKST01010100).
 *
 *   GET /api/realtime/price?ticker=005930
 *       → 단일 종목 { ticker, name, price, change, changeRate, volume, turnover }
 *   GET /api/realtime/quotes?tickers=005930,000660,...
 *       → 여러 종목 배치 조회 (화면에 보이는 30행 등). 장외 시간엔 빈 배열 반환.
 *
 * 설계:
 *   - 팩터 점수는 일 1회 배치(EOD). 이 컨트롤러는 시세성 필드(현재가·등락률·
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
    // 종목별 외국인/기관 추정가집계 — 장중 추정 순매수(키움 '잠정 1·2·3차'). output2 배열=차수별.
    private static final String INVESTOR_EST_PATH = "/uapi/domestic-stock/v1/quotations/investor-trend-estimate";
    // US 해외주식 현재가 (KIS HHDFS00000300). EXCD(NAS/NYS/AMS)+SYMB로 조회.
    private static final String OVERSEAS_PRICE_PATH = "/uapi/overseas-price/v1/quotations/price";
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final ZoneId ET = ZoneId.of("America/New_York");
    private static final int MAX_BATCH = 60;             // 배치 상한 (쿼터 보호)
    private static final long QUOTE_TTL_MS = 3_000;      // 시세 캐시 3초 (3~5초 폴링이 fresh 받도록)
    private static final long INVESTOR_TTL_MS = 15_000;  // 투자자 캐시 15초 (수급은 느린 폴링 + 쿼터 절약)
    private static final int MAX_KIS_PER_SEC = 15;       // KIS 초당 호출 상한(한도 20, ETL·다중사용자 여유 5)
    private static final int KIS_POOL = 8;               // 배치 조회 병렬도

    private final RestTemplate rest = new RestTemplate();
    private final KisClient kis;
    private final com.nextpick.repository.InstrumentRepository instrumentRepo;

    // KIS 실호출 병렬 풀 + 전역 초당 레이트리밋(토큰버킷: 매초 permit을 상한으로 리셋).
    // 앱키가 모든 사용자·ETL 공유라 전역 제한이 없으면 동시 접속 시 쿼터 초과.
    private final ExecutorService kisPool = Executors.newFixedThreadPool(KIS_POOL);
    private final Semaphore rateGate = new Semaphore(MAX_KIS_PER_SEC);
    private final ScheduledExecutorService rateRefill = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "kis-rate-refill"); t.setDaemon(true); return t;
    });

    public RealtimePriceController(KisClient kis, com.nextpick.repository.InstrumentRepository instrumentRepo) {
        this.kis = kis;
        this.instrumentRepo = instrumentRepo;
        rateRefill.scheduleAtFixedRate(() -> {
            rateGate.drainPermits();
            rateGate.release(MAX_KIS_PER_SEC);
        }, 1, 1, TimeUnit.SECONDS);
    }

    /** KIS 실호출 직전 레이트 토큰 획득(초과 시 다음 초까지 대기). 인터럽트 시 false. */
    private boolean acquireRate() {
        try {
            rateGate.acquire();
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    // 시세 캐시 (ticker → {data, ts})
    private final Map<String, CachedQuote> quoteCache = new ConcurrentHashMap<>();
    private final Map<String, CachedQuote> investorCache = new ConcurrentHashMap<>();

    private record CachedQuote(Map<String, Object> data, long ts) {}

    @GetMapping("/price")
    public ResponseEntity<Map<String, Object>> getPrice(
            @RequestParam("ticker") String ticker,
            @RequestParam(value = "market", defaultValue = "KR") String market) {
        try {
            Map<String, Object> q = "US".equalsIgnoreCase(market) ? quoteForUs(ticker) : quoteFor(ticker);
            if (q == null) return ResponseEntity.status(502).body(Map.of("error", "quote null"));
            return ResponseEntity.ok(q);
        } catch (Exception e) {
            log.warn("KIS 현재가 조회 실패 ({}): {}", ticker, e.getMessage());
            return ResponseEntity.status(502).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/quotes")
    public ResponseEntity<List<Map<String, Object>>> getQuotes(
            @RequestParam("tickers") String tickersCsv,
            @RequestParam(value = "market", defaultValue = "KR") String market) {
        boolean us = "US".equalsIgnoreCase(market);
        // 장외 시간엔 실시간 의미 없음 → 빈 배열 (프론트는 배치 EOD값 유지)
        if (us ? !isUsMarketOpen() : !isKrMarketOpen()) return ResponseEntity.ok(List.of());

        List<String> tickerList = Arrays.stream(tickersCsv.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).limit(MAX_BATCH).toList();
        // 병렬 조회(레이트리밋이 초당 상한을 지킴) — 순차 동기 호출로 요청이 겹쳐 쌓이던 문제 해소.
        List<Map<String, Object>> result = tickerList.stream()
                .map(t -> CompletableFuture.supplyAsync(() -> us ? buildUsQuoteRow(t) : buildQuoteRow(t), kisPool))
                .toList().stream()
                .map(CompletableFuture::join)
                .filter(Objects::nonNull)
                .collect(java.util.stream.Collectors.toList());
        return ResponseEntity.ok(result);
    }

    /** US 시세 1종목(배치용). 실패 시 null. */
    private Map<String, Object> buildUsQuoteRow(String ticker) {
        try {
            return quoteForUs(ticker);
        } catch (Exception e) {
            log.debug("KIS 배치 해외시세 실패 ({}): {}", ticker, e.getMessage());
            return null;
        }
    }

    /** 시세 1종목 조회 + 당일 프로그램 금액 병합. 실패 시 null. */
    private Map<String, Object> buildQuoteRow(String ticker) {
        try {
            Map<String, Object> q = quoteFor(ticker);
            if (q == null) return null;
            Map<String, Object> merged = new LinkedHashMap<>(q);
            Object pv = merged.get("programNetVol");
            Object px = merged.get("price");
            if (pv instanceof Number && px instanceof Number) {
                merged.put("programNetBuyToday", ((Number) pv).longValue() * ((Number) px).longValue());
            }
            return merged;
        } catch (Exception e) {
            log.debug("KIS 배치 시세 실패 ({}): {}", ticker, e.getMessage());
            return null;
        }
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
        if (cached != null && now - cached.ts() < QUOTE_TTL_MS) return cached.data();

        Map<String, Object> cfg = kis.getConfig();
        String token = kis.getToken();
        Map<String, Object> q = fetchQuote(ticker, cfg, token);
        if (q != null) quoteCache.put(ticker, new CachedQuote(q, now));
        return q;
    }

    /** KIS 주식현재가시세 → 시세 맵. 넥스트레이드 통합("UN") 우선, 실패 시 KRX("J") 폴백. */
    private Map<String, Object> fetchQuote(String ticker, Map<String, Object> cfg, String token) {
        // NXT(넥스트레이드) 대체거래소 출범(2025) 이후, 실제 체결가는 KRX+NXT 통합("UN").
        Map<String, Object> output = inquirePriceOutput(ticker, cfg, token, "UN");
        if (output == null) output = inquirePriceOutput(ticker, cfg, token, "J");  // UN 미지원/빈값 폴백
        if (output == null) return null;

        Map<String, Object> q = new LinkedHashMap<>();
        q.put("ticker",     ticker);
        q.put("name",       output.getOrDefault("hts_kor_isnm", ""));
        q.put("price",      parseLong((String) output.getOrDefault("stck_prpr", "0")));
        q.put("change",     parseLong((String) output.getOrDefault("prdy_vrss", "0")));
        q.put("changeRate", parseDouble((String) output.getOrDefault("prdy_ctrt", "0")));
        q.put("volume",     parseLong((String) output.getOrDefault("acml_vol", "0")));        // 누적 거래량(주)
        q.put("turnover",   parseLong((String) output.getOrDefault("acml_tr_pbmn", "0")));    // 누적 거래대금(원)
        q.put("programNetVol", parseLong((String) output.getOrDefault("pgtr_ntby_qty", "0"))); // 프로그램 순매수(주) — 3단계
        // 밸류에이션 — inquire-price가 직접 제공(추가 콜 없음). 손실주 등은 빈값→0.
        q.put("per",        parseDouble((String) output.getOrDefault("per", "0")));            // 주가수익비율
        q.put("pbr",        parseDouble((String) output.getOrDefault("pbr", "0")));            // 주가순자산비율
        q.put("eps",        parseDouble((String) output.getOrDefault("eps", "0")));            // 주당순이익(원)
        q.put("bps",        parseDouble((String) output.getOrDefault("bps", "0")));            // 주당순자산(원)
        q.put("statuses",   deriveStatuses(output));                                          // 거래정지·주의·과열 등 특이사항 뱃지
        return q;
    }

    /**
     * 주식현재가시세 1콜 → output(시장구분 mktDiv). 유효한 현재가가 없으면 null(폴백 유도).
     * mktDiv: "UN"=KRX+NXT 통합, "J"=KRX, "NX"=넥스트레이드.
     */
    private Map<String, Object> inquirePriceOutput(String ticker, Map<String, Object> cfg, String token, String mktDiv) {
        if (!acquireRate()) return null;   // 전역 초당 레이트리밋
        HttpHeaders headers = new HttpHeaders();
        headers.set("authorization", "Bearer " + token);
        headers.set("appkey",   (String) cfg.get("app_key"));
        headers.set("appsecret", (String) cfg.get("app_secret"));
        headers.set("tr_id",    "FHKST01010100");
        headers.set("custtype", "P");

        String url = KIS_BASE + PRICE_PATH
                + "?FID_COND_MRKT_DIV_CODE=" + mktDiv + "&FID_INPUT_ISCD=" + ticker;
        try {
            ResponseEntity<Map> resp = rest.exchange(url, HttpMethod.GET, new HttpEntity<>(headers), Map.class);
            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) return null;
            Object rt = resp.getBody().get("rt_cd");
            if (rt != null && !"0".equals(String.valueOf(rt))) return null;   // 미지원/에러 → 폴백
            @SuppressWarnings("unchecked")
            Map<String, Object> output = (Map<String, Object>) resp.getBody().get("output");
            if (output == null) return null;
            // 유효 현재가(>0)가 없으면 폴백(UN이 빈값 주는 종목 방지).
            if (parseLong((String) output.getOrDefault("stck_prpr", "0")) <= 0) return null;
            return output;
        } catch (Exception e) {
            log.debug("KIS 시세 조회 실패 ({}, mkt={}): {}", ticker, mktDiv, e.getMessage());
            return null;
        }
    }

    /**
     * KIS 시세 응답에서 종목 특이사항(뱃지) 리스트를 도출.
     *   - iscd_stat_cls_code: 종목 상태 (58=거래정지, 51=관리, 52=투자위험, 53=투자경고, 54=투자주의, 59=단기과열)
     *   - mrkt_warn_cls_code: 시장 경고 (01=투자주의, 02=투자경고, 03=투자위험)
     *   - short_over_yn / sltr_yn: 단기과열 / 정리매매 여부(Y/N)
     * 여러 소스가 겹칠 수 있어 중복은 제거. 심각한 상태 우선.
     */
    private List<String> deriveStatuses(Map<String, Object> output) {
        List<String> statuses = new ArrayList<>();
        String stat = String.valueOf(output.getOrDefault("iscd_stat_cls_code", "")).trim();
        String warn = String.valueOf(output.getOrDefault("mrkt_warn_cls_code", "")).trim();
        boolean shortOver = "Y".equalsIgnoreCase(String.valueOf(output.getOrDefault("short_over_yn", "")).trim());
        boolean sltr      = "Y".equalsIgnoreCase(String.valueOf(output.getOrDefault("sltr_yn", "")).trim());

        if ("58".equals(stat)) addUnique(statuses, "거래정지");
        if (sltr)              addUnique(statuses, "정리매매");
        if ("51".equals(stat)) addUnique(statuses, "관리");

        // 시장경고: 종목상태코드(52/53/54)와 시장경고코드(01/02/03) 둘 다 반영, 중복 제거.
        if ("03".equals(warn) || "52".equals(stat)) addUnique(statuses, "위험");
        if ("02".equals(warn) || "53".equals(stat)) addUnique(statuses, "경고");
        if ("01".equals(warn) || "54".equals(stat)) addUnique(statuses, "주의");

        if (shortOver || "59".equals(stat)) addUnique(statuses, "과열");

        return statuses;
    }

    private void addUnique(List<String> list, String v) {
        if (!list.contains(v)) list.add(v);
    }

    /**
     * GET /api/realtime/investor?ticker=005930
     * KIS 주식현재가 투자자 (FHKST01010900) → 당일 기관/외국인/개인 순매수.
     * 종목 상세 전용. 장중엔 잠정치(가집계).
     */
    @GetMapping("/investor")
    public ResponseEntity<Map<String, Object>> getInvestor(@RequestParam("ticker") String ticker) {
        try {
            Map<String, Object> data = investorFor(ticker);
            if (data == null)
                return ResponseEntity.status(502).body(Map.of("error", "investor empty"));
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            log.warn("KIS 투자자 조회 실패 ({}): {}", ticker, e.getMessage());
            return ResponseEntity.status(502).body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET /api/realtime/investors?tickers=005930,000660,...
     * 리스트 화면용 배치 당일 외인·기관 순매수(원, 장중 잠정). 시세(quotes)와 분리해
     * 느린 폴링(15초)으로 호출 → 쿼터 절약. 장외 시간엔 빈 배열.
     */
    @GetMapping("/investors")
    public ResponseEntity<List<Map<String, Object>>> getInvestors(@RequestParam("tickers") String tickersCsv) {
        if (!isKrMarketOpen()) return ResponseEntity.ok(List.of());

        List<String> tickerList = Arrays.stream(tickersCsv.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).limit(MAX_BATCH).toList();
        List<Map<String, Object>> result = tickerList.stream()
                .map(t -> CompletableFuture.supplyAsync(() -> buildInvestorRow(t), kisPool))
                .toList().stream()
                .map(CompletableFuture::join)
                .filter(Objects::nonNull)
                .collect(java.util.stream.Collectors.toList());
        return ResponseEntity.ok(result);
    }

    /** 당일 외인·기관 순매수 1종목 조회. 실패 시 null. */
    private Map<String, Object> buildInvestorRow(String ticker) {
        try {
            Map<String, Object> inv = investorFor(ticker);
            if (inv == null) return null;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ticker", ticker);
            row.put("foreignNetBuyToday", inv.get("foreignNetBuy"));
            row.put("instNetBuyToday", inv.get("instNetBuy"));
            return row;
        } catch (Exception e) {
            log.debug("KIS 배치 투자자 실패 ({}): {}", ticker, e.getMessage());
            return null;
        }
    }

    /**
     * KIS 주식현재가 투자자(FHKST01010900) → 당일 기관/외국인/개인 순매수 (캐시 우선).
     * 리스트 배치(getQuotes)와 상세(getInvestor) 공용. 장중 잠정치(가집계).
     */
    private Map<String, Object> investorFor(String ticker) throws Exception {
        CachedQuote cached = investorCache.get(ticker);
        long now = System.currentTimeMillis();
        if (cached != null && now - cached.ts() < INVESTOR_TTL_MS) return cached.data();

        Map<String, Object> cfg = kis.getConfig();
        String token = kis.getToken();
        // 장중: 추정가집계(잠정 순매수)를 우선 — 확정 TR(inquire-investor)은 당일 행이 장중 공란이라
        //       외인/기관이 0으로 보이던 문제. 추정 TR은 KRX 장중 추정치(차수별)를 준다.
        Map<String, Object> data = null;
        if (isKrMarketOpen()) data = fetchInvestorEstimate(ticker, cfg, token);
        // 폴백(장외/추정없음): 확정 EOD 투자자매매동향. 넥스트레이드 통합(UN)→KRX(J).
        if (data == null) data = fetchInvestorRow(ticker, cfg, token, "UN");
        if (data == null) data = fetchInvestorRow(ticker, cfg, token, "J");
        if (data != null) investorCache.put(ticker, new CachedQuote(data, now));
        return data;
    }

    /**
     * 종목별 외국인/기관 추정 순매수(장중 잠정치) — TR HHPTJ04160200 / investor-trend-estimate.
     * output2 = 차수별 배열(bsop_hour_gb=차수), [0]이 최신 차수. 값은 추정 순매수 '수량(주)'.
     * (금액(원)은 이 TR에 없음 → 프론트가 현재가×수량으로 환산해 표시.)
     * 실패/빈 배열이면 null(확정 TR로 폴백 유도).
     */
    private Map<String, Object> fetchInvestorEstimate(String ticker, Map<String, Object> cfg, String token) {
        if (!acquireRate()) return null;
        HttpHeaders headers = new HttpHeaders();
        headers.set("authorization", "Bearer " + token);
        headers.set("appkey",   (String) cfg.get("app_key"));
        headers.set("appsecret", (String) cfg.get("app_secret"));
        headers.set("tr_id",    "HHPTJ04160200");
        headers.set("custtype", "P");

        String url = KIS_BASE + INVESTOR_EST_PATH + "?MKSC_SHRN_ISCD=" + ticker;
        try {
            ResponseEntity<Map> resp = rest.exchange(url, HttpMethod.GET, new HttpEntity<>(headers), Map.class);
            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) return null;
            Object rt = resp.getBody().get("rt_cd");
            if (rt != null && !"0".equals(String.valueOf(rt))) return null;
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> out2 = (List<Map<String, Object>>) resp.getBody().get("output2");
            if (out2 == null || out2.isEmpty()) return null;
            Map<String, Object> latest = out2.get(0);   // 최신 차수

            long fvol  = parseLong((String) latest.getOrDefault("frgn_fake_ntby_qty", "0"));
            long ovol  = parseLong((String) latest.getOrDefault("orgn_fake_ntby_qty", "0"));
            long stage = parseLong((String) latest.getOrDefault("bsop_hour_gb", "0"));
            // 개장 직후 추정 전(전 차수 0·값 0)이면 확정 폴백 유도.
            if (stage == 0 && fvol == 0 && ovol == 0) return null;

            Map<String, Object> m = new java.util.HashMap<>();
            m.put("ticker", ticker);
            m.put("source", "estimate");
            m.put("estimateStage", stage);
            m.put("foreignNetVol", fvol);
            m.put("instNetVol", ovol);
            m.put("foreignNetBuy", null);   // 금액(원)은 추정 TR에 없음 → 프론트 환산
            m.put("instNetBuy", null);
            m.put("individualNetBuy", null);
            return m;
        } catch (Exception e) {
            log.debug("KIS 투자자 추정 조회 실패 ({}): {}", ticker, e.getMessage());
            return null;
        }
    }

    /** 투자자 동향 1콜(시장구분 mktDiv) → 당일 순매수 맵. 실패/빈값이면 null(폴백 유도). */
    private Map<String, Object> fetchInvestorRow(String ticker, Map<String, Object> cfg, String token, String mktDiv) {
        if (!acquireRate()) return null;   // 전역 초당 레이트리밋
        HttpHeaders headers = new HttpHeaders();
        headers.set("authorization", "Bearer " + token);
        headers.set("appkey",   (String) cfg.get("app_key"));
        headers.set("appsecret", (String) cfg.get("app_secret"));
        headers.set("tr_id",    "FHKST01010900");
        headers.set("custtype", "P");

        String url = KIS_BASE + INVESTOR_PATH
                + "?FID_COND_MRKT_DIV_CODE=" + mktDiv + "&FID_INPUT_ISCD=" + ticker;
        try {
            ResponseEntity<Map> resp = rest.exchange(url, HttpMethod.GET, new HttpEntity<>(headers), Map.class);
            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) return null;
            Object rt = resp.getBody().get("rt_cd");
            if (rt != null && !"0".equals(String.valueOf(rt))) return null;   // 미지원/에러 → 폴백
            // output = 최근 일자별 배열, [0] = 당일(가장 최근)
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> out = (List<Map<String, Object>>) resp.getBody().get("output");
            if (out == null || out.isEmpty()) return null;
            Map<String, Object> row = out.get(0);

            // KIS 순매수 거래대금(_tr_pbmn)은 백만원 단위 → 원으로 환산(×1,000,000).
            final long MW = 1_000_000L;
            return Map.of(
                    "ticker",            ticker,
                    "date",              row.getOrDefault("stck_bsop_date", ""),
                    "source",            "confirmed",
                    "foreignNetBuy",     parseLong((String) row.getOrDefault("frgn_ntby_tr_pbmn", "0")) * MW,
                    "instNetBuy",        parseLong((String) row.getOrDefault("orgn_ntby_tr_pbmn", "0")) * MW,
                    "individualNetBuy",  parseLong((String) row.getOrDefault("prsn_ntby_tr_pbmn", "0")) * MW,
                    "foreignNetVol",     parseLong((String) row.getOrDefault("frgn_ntby_qty", "0")),
                    "instNetVol",        parseLong((String) row.getOrDefault("orgn_ntby_qty", "0"))
            );
        } catch (Exception e) {
            log.debug("KIS 투자자 조회 실패 ({}, mkt={}): {}", ticker, mktDiv, e.getMessage());
            return null;
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
     *
     * 08:00~20:00로 확장(2026-07, 넥스트레이드 대응): 넥스트레이드 거래시간이
     *   프리마켓 08:00~08:50 / 메인 09:00~15:30 / 애프터마켓 15:40~20:00 이라,
     *   UN(통합) inquire-price가 이 전 구간의 통합 체결을 실시간으로 준다(진단 확인).
     *   전 구간 오버레이를 열어 장중·시간외·넥스트 애프터마켓까지 실시간 통합 시세 노출.
     */
    private boolean isKrMarketOpen() {
        ZonedDateTime now = ZonedDateTime.now(KST);
        DayOfWeek d = now.getDayOfWeek();
        if (d == DayOfWeek.SATURDAY || d == DayOfWeek.SUNDAY) return false;
        LocalTime t = now.toLocalTime();
        return !t.isBefore(LocalTime.of(8, 0)) && !t.isAfter(LocalTime.of(20, 0));
    }

    // ───────────────────────── US 해외주식 실시간 ─────────────────────────

    // ticker → EXCD(NAS/NYS/AMS) 캐시. instruments.exchange를 1시간마다 갱신.
    private volatile Map<String, String> usExcdCache = null;
    private volatile long usExcdCacheTs = 0;
    private static final long EXCD_TTL_MS = 3_600_000;  // 1시간

    private String usExcd(String ticker) {
        long now = System.currentTimeMillis();
        Map<String, String> cache = usExcdCache;
        if (cache == null || now - usExcdCacheTs > EXCD_TTL_MS) {
            Map<String, String> fresh = new ConcurrentHashMap<>();
            try {
                for (var inst : instrumentRepo.findByMarketAndActiveTrue("US")) {
                    if (inst.getExchange() != null && !inst.getExchange().isBlank()) {
                        fresh.put(inst.getTicker(), inst.getExchange().trim().toUpperCase());
                    }
                }
                usExcdCache = fresh;
                usExcdCacheTs = now;
                cache = fresh;
            } catch (Exception e) {
                log.warn("US EXCD 캐시 갱신 실패: {}", e.getMessage());
                cache = (cache != null) ? cache : Map.of();
            }
        }
        return cache.getOrDefault(ticker.toUpperCase(), "NAS");  // 미매핑 시 나스닥 기본
    }

    /**
     * US 정규장 게이트: ET 평일 09:30~16:00 + 마감 후 배치 따라잡기까지 버퍼(~16:30).
     * KR과 달리 프리/애프터는 KIS 해외 기본시세 커버가 불확실해 정규장 중심으로 제한.
     */
    private boolean isUsMarketOpen() {
        ZonedDateTime now = ZonedDateTime.now(ET);
        DayOfWeek d = now.getDayOfWeek();
        if (d == DayOfWeek.SATURDAY || d == DayOfWeek.SUNDAY) return false;
        LocalTime t = now.toLocalTime();
        return !t.isBefore(LocalTime.of(9, 30)) && !t.isAfter(LocalTime.of(16, 30));
    }

    /** KIS 해외주식 현재가 1콜 → output. 유효 현재가 없으면 null(폴백 유도). */
    private Map<String, Object> inquireOverseasOutput(String symb, String excd, Map<String, Object> cfg, String token) {
        if (!acquireRate()) return null;
        HttpHeaders headers = new HttpHeaders();
        headers.set("authorization", "Bearer " + token);
        headers.set("appkey",   (String) cfg.get("app_key"));
        headers.set("appsecret", (String) cfg.get("app_secret"));
        headers.set("tr_id",    "HHDFS00000300");
        headers.set("custtype", "P");

        // KIS 해외는 주식클래스 티커를 슬래시로 받음(BRK-B→BRK/B, 실측 확인). 우리 저장은 하이픈.
        String symbParam = symb.replace("-", "/");
        String url = KIS_BASE + OVERSEAS_PRICE_PATH + "?AUTH=&EXCD=" + excd + "&SYMB=" + symbParam;
        try {
            ResponseEntity<Map> resp = rest.exchange(url, HttpMethod.GET, new HttpEntity<>(headers), Map.class);
            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) return null;
            Object rt = resp.getBody().get("rt_cd");
            if (rt != null && !"0".equals(String.valueOf(rt))) return null;
            @SuppressWarnings("unchecked")
            Map<String, Object> output = (Map<String, Object>) resp.getBody().get("output");
            if (output == null) return null;
            if (parseDouble((String) output.getOrDefault("last", "0")) <= 0) return null;  // 유효 현재가 없으면 폴백
            return output;
        } catch (Exception e) {
            log.debug("KIS 해외시세 조회 실패 ({}, excd={}): {}", symb, excd, e.getMessage());
            return null;
        }
    }

    /** 해외주식 시세 맵. 매핑 EXCD 우선, 실패 시 다른 거래소(NYS/NAS/AMS) 폴백. */
    private Map<String, Object> fetchOverseasQuote(String ticker, Map<String, Object> cfg, String token) {
        String primary = usExcd(ticker);
        Map<String, Object> output = inquireOverseasOutput(ticker, primary, cfg, token);
        if (output == null) {
            for (String excd : List.of("NAS", "NYS", "AMS")) {
                if (excd.equals(primary)) continue;
                output = inquireOverseasOutput(ticker, excd, cfg, token);
                if (output != null) break;
            }
        }
        if (output == null) return null;

        // KIS 해외 output(실측): last(현재가) rate(등락률%, 이미 부호포함 "+0.14"/"-1.03")
        //   diff(대비, 부호없는 절대값) sign(2상승3보합5하락) tvol(거래량) tamt(거래대금USD)
        double last = parseDouble((String) output.getOrDefault("last", "0"));
        double rate = parseDouble((String) output.getOrDefault("rate", "0"));  // 이미 부호 포함
        double diff = Math.abs(parseDouble((String) output.getOrDefault("diff", "0")));
        String sign = String.valueOf(output.getOrDefault("sign", "3")).trim();
        if ("4".equals(sign) || "5".equals(sign)) diff = -diff;  // 하한/하락 → 대비 음수화(rate는 이미 부호)

        Map<String, Object> q = new LinkedHashMap<>();
        q.put("ticker",     ticker);
        q.put("name",       output.getOrDefault("rsym", ""));  // 프론트가 usDisplayName으로 한글 오버라이드
        q.put("price",      last);
        q.put("change",     diff);
        q.put("changeRate", rate);
        q.put("volume",     parseLong((String) output.getOrDefault("tvol", "0")));
        q.put("turnover",   parseLong((String) output.getOrDefault("tamt", "0")));  // USD
        return q;
    }

    /** US 캐시 우선 조회 → 미스 시 KIS 해외 호출. KR과 캐시키 분리(US: 접두). */
    private Map<String, Object> quoteForUs(String ticker) throws Exception {
        String key = "US:" + ticker;
        CachedQuote cached = quoteCache.get(key);
        long now = System.currentTimeMillis();
        if (cached != null && now - cached.ts() < QUOTE_TTL_MS) return cached.data();

        Map<String, Object> cfg = kis.getConfig();
        String token = kis.getToken();
        Map<String, Object> q = fetchOverseasQuote(ticker, cfg, token);
        if (q != null) quoteCache.put(key, new CachedQuote(q, now));
        return q;
    }

    /**
     * GET /api/realtime/debug-us?ticker=AAPL&excd=NAS
     * KIS 해외주식 실시간이 되는지(구독/지연 여부) 단계별 진단. 원본 필드 노출.
     */
    @GetMapping("/debug-us")
    public ResponseEntity<Map<String, Object>> debugUs(
            @RequestParam(value = "ticker", defaultValue = "AAPL") String ticker,
            @RequestParam(value = "excd", required = false) String excd) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("etTime", ZonedDateTime.now(ET).toString());
        r.put("usMarketOpen", isUsMarketOpen());
        r.put("resolvedExcd", excd != null ? excd : usExcd(ticker));
        try {
            Map<String, Object> cfg = kis.getConfig();
            String token = kis.getToken();
            String useExcd = excd != null ? excd : usExcd(ticker);
            if (!acquireRate()) { r.put("error", "rate gate"); return ResponseEntity.ok(r); }
            HttpHeaders headers = new HttpHeaders();
            headers.set("authorization", "Bearer " + token);
            headers.set("appkey",   (String) cfg.get("app_key"));
            headers.set("appsecret", (String) cfg.get("app_secret"));
            headers.set("tr_id",    "HHDFS00000300");
            headers.set("custtype", "P");
            String url = KIS_BASE + OVERSEAS_PRICE_PATH + "?AUTH=&EXCD=" + useExcd + "&SYMB=" + ticker.replace("-", "/");
            ResponseEntity<Map> resp = rest.exchange(url, HttpMethod.GET, new HttpEntity<>(headers), Map.class);
            r.put("httpStatus", resp.getStatusCode().value());
            Map<?, ?> body = resp.getBody();
            if (body != null) {
                r.put("rt_cd", body.get("rt_cd"));
                r.put("msg_cd", body.get("msg_cd"));
                r.put("msg1", body.get("msg1"));
                Object out = body.get("output");
                if (out instanceof Map<?, ?> m) {
                    r.put("last", m.get("last"));
                    r.put("diff", m.get("diff"));
                    r.put("rate", m.get("rate"));
                    r.put("sign", m.get("sign"));
                    r.put("tvol", m.get("tvol"));
                    r.put("base", m.get("base"));
                }
            }
        } catch (org.springframework.web.client.HttpStatusCodeException he) {
            r.put("httpStatus", he.getStatusCode().value());
            r.put("body", he.getResponseBodyAsString());
        } catch (Exception e) {
            r.put("error", String.valueOf(e));
        }
        return ResponseEntity.ok(r);
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
