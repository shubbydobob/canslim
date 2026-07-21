-- KIS 통합(KRX+NXT) EOD 스냅샷 — 장외/주말에도 목록·상세가 증권사(키움)와 일치하도록.
-- pykrx 종가/거래량/거래대금은 KRX 정규장만이라, 넥스트레이드(NXT) 애프터마켓(~20:00)
-- 체결이 빠져 장 마감 후 증권사 표시(KRX+NXT 통합)와 어긋난다. KIS inquire-price(UN=통합)는
-- 통합 종가·등락률·거래량·거래대금을 주므로 이를 EOD로 적재해 표시에 우선 반영한다.
-- kis_valuation_loader(run_daily 7d, 20:05 NXT 마감 후)가 as_of_date=당일 행에 UPDATE.
-- (스코어링 앵커/52주 등은 price_daily 정규장 기준 유지 — 표시값만 통합으로 오버레이.)
ALTER TABLE derived_metrics
    ADD COLUMN IF NOT EXISTS kis_close      NUMERIC(16,4),   -- KIS 통합 종가(현재가)
    ADD COLUMN IF NOT EXISTS kis_change_pct NUMERIC(10,4),   -- KIS 통합 전일대비 등락률(%)
    ADD COLUMN IF NOT EXISTS kis_volume     BIGINT,          -- KIS 통합 누적 거래량(주)
    ADD COLUMN IF NOT EXISTS kis_turnover   NUMERIC(20,4);   -- KIS 통합 누적 거래대금(원)
