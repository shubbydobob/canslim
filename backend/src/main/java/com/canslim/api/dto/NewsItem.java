package com.canslim.api.dto;

public record NewsItem(
        String title,
        String source,
        String date,
        String url
) {}
