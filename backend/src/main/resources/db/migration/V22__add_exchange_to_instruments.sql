-- US 실시간(KIS 해외주식) 조회는 종목별 거래소코드(EXCD: NAS/NYS/AMS)가 필요.
-- KR은 UN/J 통합코드라 불필요했으나 US는 NYSE/NASDAQ/AMEX 구분이 있어야 시세 TR 호출 가능.
-- us_shares_loader가 yfinance exchange를 KIS EXCD로 매핑해 적재. NULL이면 실시간 조회 시 NAS 기본.
ALTER TABLE instruments ADD COLUMN IF NOT EXISTS exchange VARCHAR(8);
