# CANSLIM 데이터 소스 및 한계

## KR 시장 데이터 소스

| 데이터 | 소스 | ETL 모듈 |
|--------|------|----------|
| 종목 목록 | FinanceDataReader (FDR) | `etl/kr_adapter/instrument_loader.py` |
| 일별 가격 | pykrx `get_market_ohlcv` | `etl/kr_adapter/price_loader.py` |
| 재무 데이터 | DART OpenAPI | (Phase 2) |
| 기관/외인 순매수 | 네이버 금융 `frgn.naver` HTML 스크래핑 | `etl/kr_adapter/investor_flow_loader.py` |

---

## 알려진 한계

### 1. 생존편향 (Survival Bias)
**현황**: `instruments` 테이블에는 **현재 상장 중인 종목만** 적재됩니다.
백필 기간(2022-01-01~현재) 중 상장폐지된 종목의 과거 가격 데이터는 수집하지 않습니다.

**영향**:
- 과거 시점의 CANSLIM 점수 백테스트 시 스코어가 실제보다 높게 나올 수 있음
- 상폐 직전 급락 구간이 제거되어 손실 과소 추정
- RS 백분위 계산 모집단이 "살아남은 종목들"로만 구성됨

**대응 방안** (향후):
- 상장폐지 종목 이력 테이블 별도 관리
- 백테스트 시 해당 날짜 기준 상장 종목 목록으로 모집단 재구성

---

### 2. pykrx 수정주가 한계
**현황**: pykrx 1.0.51은 `adjusted=False`(원본가) 미지원.
`get_market_ohlcv` 기본 응답 = 오늘 시점 소급 적용된 수정주가.

**영향**:
- `close`(원본)와 `close_adj`(수정)가 초기 적재 시 동일 값으로 저장됨
- 재백필 시 `close_adj`는 갱신되나, `close`는 최초 적재값 유지
- 과거 기간 수정가가 재계산되면 동일 날짜 RS·MA 값이 달라질 수 있음

**대응 방안** (향후):
- KRX OpenAPI 또는 FDR의 원본가 엔드포인트 연동 시 `close` 업데이트
- 수정주가 변경 이력 로깅

---

### 3. 거래대금 근사값
**현황**: pykrx `get_market_ohlcv` 응답에 거래대금(turnover) 컬럼 없음.
`turnover = close_adj × volume`으로 근사.

**영향**: 실제 거래대금과 소수점 오차 발생. S-스코어 계산에 간접 영향.

---

### 4. 종목 분류 (security_type) 한계
**현황**: ETF/ETN/REIT/SPAC/우선주 분류를 종목명 패턴 + 코드 끝자리로 판단.
`instruments` 테이블에는 `COMMON`만 적재.

**한계**:
- 종목명에 키워드가 없는 일부 REIT/SPAC가 COMMON으로 오분류될 수 있음
- 코드 끝자리 '0'이지만 SPAC인 종목(예: KOSDAQ 482680)은 이름 기반 우선 필터로 처리됨

---

### 5. I 점수 — 보유잔고 아닌 유량(Flow) 신호

**현황**: 한국 시장에는 미국 SEC 13F(분기별 기관 보유잔고 공시)에 해당하는 데이터가 없음.
`investor_flow_loader.py`가 수집하는 값은 **당일 기관/외국인 순매수 주수(株數)** 로,
네이버 금융 `frgn.naver` 페이지에서 스크래핑한 후 당일 종가 × 주수로 원(KRW) 환산.

**단위**: 원(KRW) 근사치 — 실제 체결단가 대신 당일 종가 사용.

**한계**:
- **유량(Flow) 신호**: 보유잔고(Stock)가 아니라 당일 거래 순매수. 오늘 매수 후 내일 매도하면 두 날 모두 반대 신호 발생.
- **시가총액 비중 미반영**: 50억 원 순매수가 삼성전자(시총 200조)에는 미미하고 소형주(시총 500억)에는 10%에 해당.
  `i_net_buy_threshold` 파라미터로 일부 보정 가능하나 완전한 정규화는 아님.
- **데이터 소스 의존**: 네이버 금융 HTML 구조 변경 시 파서 수정 필요. pykrx KRX 투자자 API(MDCSTAT02302)는
  현재 400 LOGOUT 반환으로 사용 불가 상태.

---

### 6. M(시장국면) — ETF 대리 지표

**현황**: `market_state_seeder.py`는 KOSPI 지수 ETF(069500 KODEX200)의 주가·이동평균으로
시장 국면(BULL/NEUTRAL/BEAR)을 판단.

**한계**:
- **대리 지표(Proxy)**: KOSPI 지수를 직접 조회하는 대신 ETF 주가로 근사. 괴리율(ETF Premium/Discount) 발생 가능.
- **이진 신호**: KOSPI만 참고. KOSDAQ 강세·KOSPI 약세 시(예: 2020년 바이오 랠리) 국면이 과도하게 BEAR로 판정될 수 있음.
- **향후 개선**: KOSPI/KOSDAQ 지수 직접 조회(KRX OpenAPI 또는 FDR `KRX:KOSPI`) 및 시장별 독립 국면 판단.

---

## 데이터 갱신 주기

| 데이터 | 갱신 주기 | 비고 |
|--------|----------|------|
| 종목 목록 | 매일 장 종료 후 | 신규 상장·상폐 반영 |
| 일별 가격 | 매 영업일 장 종료 후 | 15:30 이후 |
| 재무 데이터 | 분기 공시 후 | DART 제출 기준 |
| CANSLIM 점수 | 매 영업일 | 가격·재무 적재 완료 후 |
