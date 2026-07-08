# CANSLIM 스코어링 엔진 — 세션 진입점

## 프로젝트 개요
한국 주식시장 CAN SLIM 방법론 기반 자동 스코어링 시스템.
ETL(Python) → PostgreSQL → Scoring Engine(Spring Boot) → Screener UI(React)

**현재**: 운영 배포 중 (NEXTPICK · k-stock-score.vercel.app). 프론트=React 실서비스(mockData 아님).

---

## 🔴 운영/실시간 아키텍처 (2026-07 세션 정리 — 반드시 숙지)

### 배포·인프라
- **운영 서버**: EC2 `13.209.47.193` (ubuntu, `/home/ubuntu/canslim`). Docker: `canslim-postgres` + `canslim-backend`(8080). 프론트=Vercel(자동배포).
- **이 샌드박스는 EC2에 직접 접속 불가**(아웃바운드 allowlist). 서버 작업은 **GitHub Actions로만** 가능:
  - `.github/workflows/deploy.yml` — master의 `backend/**` 변경 시 SSH→`git pull`+`docker compose up --build backend`.
  - **운영 ops 워크플로우(workflow_dispatch, EC2_HOST/EC2_SSH_KEY 시크릿 사용)**:
    - `db-status.yml` — 운영 DB 상태 읽기 진단(테이블/점수/가격/프로세스). **서버 확인은 이걸로.**
    - `recover.yml` — 가격→수급→정규화→파생→채점 지정일 복구.
    - `rescore.yml` — 정규화+파생+채점만.
    - `backfill.yml` — 10년 백필(`--rebuild` opt-in).
  - MCP `mcp__github__actions_run_trigger`로 트리거, `get_job_logs`로 결과 확인.

### ETL 스케줄 (전부 서버·평일, 사용자 PC 무관)
- **20:05 KST 크론** → `run_daily` (가격→수급→KIS재무→정규화→파생→market_state→종목상태(뱃지)→채점트리거). 시간외 단일가 20:00 마감 후 확정 종가·상태로 채점. (과거 16:10 → 시간외 반영 위해 20:05로 이동.)
- **18:30 KST** 백엔드 `@Scheduled ScoringJob` 재채점(안전망).
- **매월 1~7일**: `_maybe_reset_financial_ingestion`이 KIS 재무 전량 재수집 → 새 분기 공시 반영. (**DART 미사용** — 재무는 KIS로 전환됨. DART 오펀 스케줄(watcher) 제거.)

### 실시간 vs 배치 (2026-07-08 갱신)
- **스코어(종합·C/A/N/S/L/I) = 일 1회 배치**(장중 고정). CANSLIM 특성상 정상.
- **시세(현재가·등락률·거래량·거래대금·프로그램 당일순매수) = KIS 4초 폴링** (`/api/realtime/quotes`).
- **수급(외인·기관 당일순매수) = KIS 15초 폴링** (`/api/realtime/investors`, 시세와 분리해 쿼터 절약).
  스크리너 리스트 외인·기관 컬럼은 장중=당일 실시간(잠정)/장외=10일 누적 배치.
- **KIS 전역 레이트리밋**: 앱키가 모든 사용자·ETL 공유 → `RealtimePriceController`에 토큰버킷(초당 15) + 병렬 풀(8). 배치 조회는 병렬.
- **캐시 TTL**: 시세 3초 / 투자자 15초. 오버레이 창 `isKrMarketOpen` 09:00~18:30.
- 실시간 3-상태 배지: 실시간(초록)/지연(주황, 장중인데 KIS 실패)/종가(장외).
- **뱃지(거래정지·주의·경고·과열 등)**: 장중=KIS 실시간, 장외/주말=EOD 스냅샷(`security_status_daily`, kis_status_loader가 20:05 배치).
- 대시보드: 상한가섹션(실시간 미조회 종목 배제)·TOP랭킹 등락률 실시간 오버레이. **업종 히트맵 = KIS 업종지수(FHPUP02100000) 실시간**.

### 이번 세션 주요 픽스 (모두 master 반영)
- `run_daily`: 월요일 종목수집(FinanceDataReader) 크래시가 전 파이프라인 죽이던 것 → try/except 비치명적.
- `financial_normalizer`: 전분기 EPS≈0일 때 eps_qoq_yoy_pct 폭발→NUMERIC(10,4) 오버플로우로 정규화 전체 롤백(C/A 전멸) → **±9999 클램프**.
- `run_backfill_10yr`: TRUNCATE-먼저-후-실패로 운영 비우던 것 → 기본 안전(upsert), `--rebuild` opt-in.
- `finance-datareader` requirements 누락 추가.
- `/stats`·`/limit-up`: 가격을 score_date 정확일치→**최신 2거래일(cur/prev)** & limit-up은 **최신 가격일 앵커**(채점 지연 시 stale 상한가 방지).
- **가격 지연 근본 픽스**: `loadPriceAndFlow`(스크리너 리스트·상세 공용)와 `/stats`가 score_date로 가격 윈도우를 자르던 것 → **price_daily의 max(trade_date) 앵커**로 교체. 채점이 밀려도 리스트·상승종목수·섹터 등락이 항상 최신 종가 반영. 수급(derived_metrics)만 score_date 유지.
- **실시간 오버레이 창 확장**: `isKrMarketOpen` 09:00~15:30 → **09:00~18:00**. 마감(15:30)~EOD배치(16:10~) 공백에도 KIS가 오늘 종가/등락을 주므로 오버레이로 브리지.
- 프론트: 모바일 카드/하단탭바 반응형(토스풍), 스크리너 하단 가로스크롤바 sticky, 상한가 섹션.

### 2026-07-08 세션 픽스 (모두 master 반영·배포)
- **모바일 스코어 랭킹**: 고정 7열 그리드 넘침 → `RankingView` flex 카드형 반응형.
- **종목 특이사항 뱃지 상시화**: `security_status_daily`(V18) 스냅샷 + `kis_status_loader`(KIS 상태코드 전종목 순회, 20:05 run_daily 7b). 백엔드 `loadStatuses` 조인, 프론트 `StatusBadges`. 장외/주말에도 표시.
- **뒤로가기 앱 이탈 방지**: 탭/상세가 `/` 단일 라우트 state라 뒤로가기 시 앱 벗어나던 것 → `ScreenerPage` history.pushState/popstate 동기화.
- **상한가 stale**: 실시간 미조회 종목이 배치 등락률로 상한가 오노출 → 후보 우선 조회 + 실시간 활성 시 미조회 배제.
- **배치 20:05 이동**: 16:10 크론 → `5 20 * * 1-5`(시간외 마감 후). DART 스케줄(오펀 watcher) 제거. `deploy.yml` paths에 `etl/**` 추가(ETL 변경도 자동 git pull).
- **실시간 수급**: 외인·기관·프로그램 당일 실시간화(위 실시간 섹션). 단위 버그(KIS `_tr_pbmn`는 백만원 → ×1e6 원) 정정. 리스트 거래량 컬럼 + '억'/'만주' 단위 표기.
- **스크리너 등락률/수급 정렬**: 백엔드 배치 정렬 vs 프론트 실시간 표시 불일치 → `LIVE_SORT_KEYS` + `liveSortVal`(당일 우선)로 페이지 재정렬.
- **정렬 앵커 정합성**: `screenByPriceSort` 표시가격을 `loadPriceAndFlow`(price_daily 최신 앵커)로 통일(정렬은 canslim_scores 인덱스 유지, coalesce 보존).
- **시간외 단일가**: `after_hours_loader` TR 정정(FHPST02300000/inquire-overtime-price, `ovtm_untp_prpr`/`ovtm_untp_prdy_ctrt`) + run_daily 7c 편입. 정규장 종가 불변, `after_hours_close`만 적재(COALESCE 오버레이).
- **성능**: 코드 스플릿(App 라우트 lazy + StockDetailPanel/recharts lazy + vite manualChunks vendor-react/charts) → 945KB 단일청크 분할. `useMemo`(displayItems·sectorStats).
- **진단**: `kis-probe.yml`(workflow_dispatch) — KIS TR 후보 실호출로 필드 확인(읽기 전용).

### 알려진 데이터 함정
- **거래정지 종목**: 정지 기간 종가 고정+거래량 0, 재개일 폭등. "상한가" 아님. limit-up은 최신 가격일 앵커로 자연 배제.
- **채점 지연**: 가격은 최신일인데 canslim_scores는 이전일일 수 있음. 헤더 "매일 갱신" 날짜 = 최신 채점일.
- **프로그램 10일 누적 불가**: KIS에 "종목별" 프로그램매매 일별 API 없음(시장별 종합만). → 배치 `program_net_buy_10d`는 null, 장중 실시간(`pgtr_ntby_qty`)만 제공. 프론트도 이 전제로 표시.
- **시간외 종가**: pykrx 종가는 정규장(15:30) 기준. 시간외 단일가는 `after_hours_loader`(20:05)가 별도 컬럼에 적재 → COALESCE 오버레이로만 표시(운영 첫 배치 후 `derived_metrics.after_hours_close` 확인 권장).

### 미해결/주의
- **KIS 쿼터**: 레이트리밋(15/s)+병렬로 완화. 그래도 동시 접속 많으면 압박 → 시세 폴링 5초로 상향 여지. `/api/realtime/debug` 진단.
- **정렬 앵커**: 표시는 통일했으나 정렬 '순서'는 여전히 canslim_scores 기준(채점 지연 시 stale). 프론트 재정렬이 장중 보정. 완전 통일은 성능 트레이드오프로 보류.
- **진짜 실시간 1초/WebSocket**: REST 폴링은 쿼터상 3~5초가 한계. 초단위는 KIS WebSocket(41종목 제한) 필요 — 별도 과제.

---

## 빠른 명령어

### ETL
```bash
cd /c/Projects/canslim
PYTHONUTF8=1 python etl/kr_adapter/investor_flow_loader.py   # KIS 수급
PYTHONUTF8=1 python etl/kr_adapter/dart_loader.py             # DART 재무
PYTHONUTF8=1 python etl/kr_adapter/run_backfill_10yr.py       # 10년 백필
```

### Spring Boot
```bash
cd backend && DB_PASSWORD=1234 mvn spring-boot:run
curl -s -X POST http://localhost:8080/api/admin/scoring/run   # 스코어링 실행
```

### DB 확인
```bash
psql -U canslim_user -d canslim -c "SELECT COUNT(*) FROM canslim_scores;"
psql -U canslim_user -d canslim -c "SELECT ticker, composite_score FROM canslim_scores ORDER BY composite_score DESC LIMIT 10;"
```

### 슬래시 커맨드
| 커맨드 | 설명 |
|--------|------|
| `/etl-run` | KIS + DART ETL 실행 |
| `/score-run` | 스코어링 트리거 + Top 10 출력 |
| `/db-check` | 주요 테이블 row 수 확인 |
| `/backfill` | 10년 백필 실행 |
| `/gap-status` | 미구현 GAP 현황 분석 |

---

## 미구현 GAP (Phase 4 목표)

| # | GAP | 담당 에이전트 |
|---|-----|--------------|
| 1 | EDGAR Java compile error (JdbcFinancialHistoryRepository 미구현) | @debugger + @persistence-designer |
| 2 | ScreenerView mockData → 실제 `/api/screener` 연동 | @frontend-integrator |
| 3 | completeness_discount Stage 2 미구현 (C/A null 시 감산) | @strategy-architect + @executor |

---

## 에이전트 라우팅

| 작업 | 에이전트 |
|------|---------|
| 코드/파일 탐색 | `@explore` |
| 명령 실행, 빌드 | `@executor` |
| 버그 원인 분석 | `@debugger` |
| 설계 결정 | `@architect` |
| 코드 리뷰 | `@code-reviewer` |
| 테스트 작성 | `@test-engineer` |
| 커밋/브랜치 | `@git-master` |
| API/E2E 검증 | `@qa-tester` |
| ETL 파이프라인 전체 | `@etl-orchestrator` |
| 프론트 API 연동 | `@frontend-integrator` |
| 스코어 분석 | `@scoring-analyst` |
| CAN SLIM 전략 | `@strategy-architect` |
| 외부 API 계약 | `@data-contract-analyst` |
| DB/JPA 설계 | `@persistence-designer` |

---

## 주요 파일 경로

### ETL (Python)
- `etl/kr_adapter/investor_flow_loader.py` — KIS 기관/외인 수급 (hot)
- `etl/kr_adapter/dart_loader.py` — DART 재무제표 (hot)
- `etl/kr_adapter/run_backfill_10yr.py` — 10년 백필 (hot)
- `etl/config/kis.yaml` — KIS API 설정

### Backend (Spring Boot)
- `backend/src/main/java/.../scoring/` — CAN SLIM 스코어링 엔진
- `backend/src/main/java/.../repository/` — JPA/JDBC 레포지터리
- `db/schema.sql` — DB 스키마

### Frontend (React)
- `frontend/src/views/ScreenerView.tsx` — 스크리너 UI (mockData 사용 중)
- `frontend/src/` — Vite + TypeScript

---

## DB 스키마 요약
```
price_daily            (~2558 종목, 10년 일별 가격, 연도별 파티션)
derived_metrics        (파생: EPS/ROE + rs_percentile/52w/수급/after_hours, security_id+as_of_date)
financials             (KIS 재무 원본, DART 미사용)
canslim_scores         (~2558 종목, CAN SLIM 종합 점수 + 가격 스냅샷)
security_status_daily  (V18, 특이사항 뱃지 스냅샷: statuses TEXT[], security_id+status_date)
```
Flyway 마이그레이션: `backend/src/main/resources/db/migration/` (V1~V18). 백엔드 배포 시 자동 실행.

## 알려진 데이터 현황
- 최고 점수: 미래에셋생명(085620) C=95.8, I=100
- C 점수 null: 상위 30위 중 21개 (DART 커버리지 부족)
- A 점수 null: 상위 30위 중 27개 (DART 커버리지 부족)
