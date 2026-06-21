# CANSLIM 데이터 소스 및 한계

## KR 시장 데이터 소스

| 데이터 | 소스 | ETL 모듈 |
|--------|------|----------|
| 종목 목록 | FinanceDataReader (FDR) | `etl/kr_adapter/instrument_loader.py` |
| 일별 가격 | pykrx `get_market_ohlcv` | `etl/kr_adapter/price_loader.py` |
| 재무 데이터 | DART OpenAPI | (Phase 2) |
| 기관/외인 순매수 | pykrx `get_market_net_purchases_of_...` | (Phase 2) |

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

## 데이터 갱신 주기

| 데이터 | 갱신 주기 | 비고 |
|--------|----------|------|
| 종목 목록 | 매일 장 종료 후 | 신규 상장·상폐 반영 |
| 일별 가격 | 매 영업일 장 종료 후 | 15:30 이후 |
| 재무 데이터 | 분기 공시 후 | DART 제출 기준 |
| CANSLIM 점수 | 매 영업일 | 가격·재무 적재 완료 후 |
