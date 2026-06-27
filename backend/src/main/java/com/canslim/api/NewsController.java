package com.canslim.api;

import com.canslim.api.dto.NewsItem;
import com.canslim.service.NaverNewsService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * GET /api/news/{ticker} — 네이버 금융 뉴스 15건
 */
@RestController
@RequestMapping("/api/news")
public class NewsController {

    private final NaverNewsService newsService;

    public NewsController(NaverNewsService newsService) {
        this.newsService = newsService;
    }

    @GetMapping("/{ticker}")
    public ResponseEntity<List<NewsItem>> getNews(@PathVariable String ticker) {
        return ResponseEntity.ok(newsService.fetchNews(ticker));
    }
}
