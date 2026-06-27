package com.canslim.service;

import com.canslim.api.dto.NewsItem;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.HtmlUtils;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 네이버 모바일 증권 API 기반 종목 뉴스 조회.
 *
 * GET https://m.stock.naver.com/api/news/stock/{ticker}?pageSize=15&page=1
 * 응답: [{total, items:[{title, officeName, datetime, mobileNewsUrl, body}]}]
 * datetime 포맷: yyyyMMddHHmm
 */
@Service
public class NaverNewsService {

    private static final String API_URL =
            "https://m.stock.naver.com/api/news/stock/%s?pageSize=20&page=1";

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper  = new ObjectMapper();

    @Cacheable(value = "stockNews", key = "#ticker")
    public List<NewsItem> fetchNews(String ticker) {
        List<NewsItem> result = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>(); // 중복 제거

        try {
            String url  = String.format(API_URL, ticker);
            String body = restTemplate.getForObject(url, String.class);
            if (body == null) return result;

            JsonNode root = objectMapper.readTree(body);
            // 응답: [{total, items:[...]}, ...]
            for (JsonNode group : root) {
                JsonNode items = group.path("items");
                if (!items.isArray()) continue;
                for (JsonNode item : items) {
                    String title = item.path("title").asText("").trim();
                    if (title.isEmpty() || seen.contains(title)) continue;
                    seen.add(title);

                    result.add(new NewsItem(
                            HtmlUtils.htmlUnescape(title),
                            item.path("officeName").asText(""),
                            formatDatetime(item.path("datetime").asText("")),
                            item.path("mobileNewsUrl").asText("")
                    ));
                }
            }

            // 최신순 정렬 (datetime 내림차순)
            result.sort(Comparator.comparing(NewsItem::date).reversed());

        } catch (Exception ignored) {
            // 네트워크 오류 시 빈 리스트
        }

        return result.stream().limit(15).toList();
    }

    /** "202606272300" → "2026-06-27 23:00" */
    private String formatDatetime(String dt) {
        if (dt == null || dt.length() < 8) return dt;
        try {
            return dt.substring(0, 4) + "-" + dt.substring(4, 6) + "-" + dt.substring(6, 8)
                    + (dt.length() >= 12 ? " " + dt.substring(8, 10) + ":" + dt.substring(10, 12) : "");
        } catch (Exception e) {
            return dt;
        }
    }
}
