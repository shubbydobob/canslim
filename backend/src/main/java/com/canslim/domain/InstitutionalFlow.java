package com.canslim.domain;

import java.math.BigDecimal;

/**
 * 기관/외국인 순매수 데이터 값 객체 (DB 엔티티 아님).
 *
 * KR 한계: pykrx 투자자유형(기관/외국인/개인) 순매수.
 *          어느 펀드가 보유 중인지 알 수 없음 (KR에 13F 동등 데이터 없음).
 *          I-score는 보유 집중도가 아닌 매집 추세 신호임.
 */
public record InstitutionalFlow(
        Long securityId,
        int windowDays,
        BigDecimal institutionalNetBuy,
        BigDecimal foreignNetBuy,
        int trendFlag   // -1: 매도, 0: 중립, 1: 매수
) {}
