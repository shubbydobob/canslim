# NEXTPICK 스코어링 엔진 — 세션 진입점

## 프로젝트 개요
한국 주식시장 성장주 팩터 방법론 기반 자동 스코어링 시스템.
ETL(Python) → PostgreSQL → Scoring Engine(Spring Boot) → Screener UI(React)

**현재**: 운영 배포 중 (NEXTPICK · k-stock-score.vercel.app). 프론트=React 실서비스(mockData 아님).

---

## 🎨 프론트엔드 스타일 규칙 (필수 — 위반 금지)
- **인라인 `style` 금지**. 모든 스타일은 `frontend/src/index.css`의 **공통 CSS 클래스**로 작성한다(퍼블리싱 방식). JSX엔 `className`만.
- **동적 값(런타임 색·수치)만** CSS 변수로 전달: `style={{ ['--x' as string]: value }}` → CSS에서 `var(--x)` 소비. 정적 스타일을 style 속성에 넣지 않는다.
- 라이트/다크는 `[data-theme='light']`/`prefers-color-scheme` + CSS 변수로 대응(하드코딩 색 지양, `var(--text-1)` 등 토큰 사용).
- 반복되는 UI(셀 행·배지·카드 등)는 공통 클래스/컴포넌트로 추출해 재사용(예: `.metric-strip`/`.metric-cell`, `.badge*`, `.scr-*`).
- **새 컴포넌트/수정 시에도 이 규칙을 지킨다.** 인라인을 새로 추가하지 말 것.
- **디자인 톤(2026-07 리스타일 · 토스/증권사 앱 무드)**: 숫자=`var(--font-num)`(tabular 산세리프), 티커/코드만 `var(--font-mono)`. 카드=`--r-card`(16px)+`--shadow`/`--shadow-sm`(하드보더 대신 부드러운 그림자). 등락률=부호색 틴트 칩(`color-mix(--sc-rate 13%)`). 종합점수=`.score-ring`(conic-gradient 게이지, `--v`/`--gc`/`--sr`/`--ring-bg`) — 상세 히어로·모바일 카드·랭킹 적용(스크리너 표는 밀도 위해 컬러셀 유지). 등락색 한국식(상승 빨강/하락 파랑) 유지, 다크 기본+라이트 대응. RankingView는 인라인 전량 제거하고 `.rank-*` 클래스로 재작성(링 게이지+틴트칩).

---

## 🔴 운영/실시간 아키텍처 (2026-07 세션 정리 — 반드시 숙지)

### 배포·인프라
- **운영 서버**: EC2 `13.209.47.193` (ubuntu, `/home/ubuntu/nextpick`). Docker: `nextpick-postgres` + `nextpick-backend`(8080). 프론트=Vercel(자동배포).
- **이 샌드박스는 EC2에 직접 접속 불가**(아웃바운드 allowlist). 서버 작업은 **GitHub Actions로만** 가능:
  - `.github/workflows/deploy.yml` — master의 `backend/**`·`etl/**` 변경 시 SSH→`git fetch`+`git reset --hard origin/master`+`docker compose up --build -d --force-recreate backend`. (구 `git pull`+`up --build`는 옛 jar 잔존해 배포 미반영되던 것 → reset+force-recreate로 하드닝.)
  - `.github/workflows/force-redeploy.yml`(workflow_dispatch) — 배포 미반영 강제 해소용 `--no-cache` 재빌드.
  - **운영 ops 워크플로우(workflow_dispatch, EC2_HOST/EC2_SSH_KEY 시크릿 사용)**:
    - `db-status.yml` — 운영 DB 상태 읽기 진단(테이블/점수/가격/프로세스). **서버 확인은 이걸로.**
    - `recover.yml` — 가격→수급→정규화→파생→채점 지정일 복구.
    - `rescore.yml` — 정규화+파생+채점만.
    - `backfill.yml` — 10년 백필(`--rebuild` opt-in).
  - MCP `mcp__github__actions_run_trigger`로 트리거, `get_job_logs`로 결과 확인.

### ETL 스케줄 (전부 서버·평일, 사용자 PC 무관)
- **20:05 KST 크론** → `run_daily` (가격→수급→KIS재무→정규화→파생→market_state→종목상태(뱃지 7b)→시간외단일가(7c)→밸류에이션 PER/PBR/EPS/BPS(7d)→채점트리거). 시간외 단일가 20:00 마감 후 확정 종가·상태로 채점. (과거 16:10 → 시간외 반영 위해 20:05로 이동.)
- **21:30 KST** 백엔드 `@Scheduled ScoringJob` 재채점(안전망). run_daily(20:05) 완료 후 채점 트리거 실패 대비. (과거 16:40 KST → ETL 20:05 이동에 맞춰 뒤로 조정. `zone="Asia/Seoul"` 명시.)
- **매월 1~7일**: `_maybe_reset_financial_ingestion`이 KIS 재무 전량 재수집 → 새 분기 공시 반영. (**DART 미사용** — 재무는 KIS로 전환됨. DART 오펀 스케줄(watcher) 제거.)

### 실시간 vs 배치 (2026-07-08 갱신)
- **스코어(종합·C/A/N/S/L/I) = 일 1회 배치**(장중 고정). 팩터 특성상 정상.
- **시세(현재가·등락률·거래량·거래대금·프로그램 당일순매수) = KIS 4초 폴링** (`/api/realtime/quotes`).
- **수급(외인·기관 당일순매수) = KIS 15초 폴링** (상세 `/api/realtime/investor`, 시세와 분리해 쿼터 절약).
  - **장중 잠정치**: `investor-trend-estimate`(TR HHPTJ04160200, 종목별 외인/기관 **추정가집계**) — 키움 '잠정 1·2·3차'와 동일 소스. output2 배열(차수별, `bsop_hour_gb`=차수, `frgn_fake_ntby_qty`/`orgn_fake_ntby_qty`=추정 순매수 **수량(주)**). 최신 차수(output2[0]) 사용. **금액(원)은 이 TR에 없어 프론트가 현재가×수량 환산.**
  - **폴백(장외)**: 확정 TR `inquire-investor`(FHKST01010900). ⚠️ 이건 **당일 행이 장중엔 공란**(EOD 확정)이라 장중 외인/기관이 0으로 보이던 근본원인 → 추정 TR로 교체(2026-07-09). 상세 배지 '● 잠정 N차'(추정)/'● 실시간'(확정)/'10일 누적'(배치).
  - `/api/realtime/investors`(배치)는 현재 UI 미소비(추정 TR 동일 적용).
- **KIS 전역 레이트리밋**: 앱키가 모든 사용자·ETL 공유 → `RealtimePriceController`에 토큰버킷(초당 15) + 병렬 풀(8). 배치 조회는 병렬.
- **캐시 TTL**: 시세 3초 / 투자자 15초. 오버레이 창 `isKrMarketOpen`(백엔드)·`isKrMarketHours`(프론트) **08:00~20:00** — NXT 프리마켓(08:00~)·애프터마켓(~20:00)까지 실시간 커버.
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
- **실시간 오버레이 창 확장**: `isKrMarketOpen` 09:00~15:30 → **08:00~20:00**(최종). 정규장 마감~EOD 공백 + NXT 프리/애프터마켓까지 KIS 오늘 종가/등락으로 브리지. 창 밖(20:00 이후)엔 배치값 표시.
- 프론트: 모바일 카드/하단탭바 반응형(토스풍), 스크리너 하단 가로스크롤바 sticky, 상한가 섹션.

### 2026-07-08 세션 픽스 (모두 master 반영·배포)
- **모바일 스코어 랭킹**: 고정 7열 그리드 넘침 → `RankingView` flex 카드형 반응형.
- **종목 특이사항 뱃지 상시화**: `security_status_daily`(V18) 스냅샷 + `kis_status_loader`(KIS 상태코드 전종목 순회, 20:05 run_daily 7b). 백엔드 `loadStatuses` 조인, 프론트 `StatusBadges`. 장외/주말에도 표시.
- **뒤로가기 앱 이탈 방지**: 탭/상세가 `/` 단일 라우트 state라 뒤로가기 시 앱 벗어나던 것 → `ScreenerPage` history.pushState/popstate 동기화.
- **상한가 stale**: 실시간 미조회 종목이 배치 등락률로 상한가 오노출 → 후보 우선 조회 + 실시간 활성 시 미조회 배제.
- **배치 20:05 이동**: 16:10 크론 → `5 20 * * 1-5`(시간외 마감 후). DART 스케줄(오펀 watcher) 제거. `deploy.yml` paths에 `etl/**` 추가(ETL 변경도 자동 git pull).
- **실시간 수급**: 외인·기관·프로그램 당일 실시간화(위 실시간 섹션). 단위 버그(KIS `_tr_pbmn`는 백만원 → ×1e6 원) 정정. 리스트 거래량 컬럼 + '억'/'만주' 단위 표기.
- **스크리너 등락률/수급 정렬**: 백엔드 배치 정렬 vs 프론트 실시간 표시 불일치 → `LIVE_SORT_KEYS` + `liveSortVal`(당일 우선)로 페이지 재정렬.
- **정렬 앵커 정합성**: `screenByPriceSort` 표시가격을 `loadPriceAndFlow`(price_daily 최신 앵커)로 통일(정렬은 nextpick_scores 인덱스 유지, coalesce 보존).
- **시간외 단일가**: `after_hours_loader` TR 정정(FHPST02300000/inquire-overtime-price, `ovtm_untp_prpr`/`ovtm_untp_prdy_ctrt`) + run_daily 7c 편입. 정규장 종가 불변, `after_hours_close`만 적재. (표시는 별도 필드 — 오버레이 제거됨, 아래 "시간외 종가" 함정 참조.)
- **성능**: 코드 스플릿(App 라우트 lazy + StockDetailPanel/recharts lazy + vite manualChunks vendor-react/charts) → 945KB 단일청크 분할. `useMemo`(displayItems·sectorStats).
- **진단**: `kis-probe.yml`(workflow_dispatch) — KIS TR 후보 실호출로 필드 확인(읽기 전용).
- **채점 프리즈 근본 픽스 (nextpick_scores가 07-07에 고정)**: `updatePriceSnapshot`의 `:scoreDate - INTERVAL '14 days'`에서 LocalDate가 JPA `@Query`에 `unknown` 타입으로 바인딩 → PG가 `unknown - interval`을 interval로 해석해 `operator does not exist: date >= interval` → 채점 트랜잭션 오염 → catch("비치명적")에도 커밋 시점에 **KR 전 종목 롤백**. `CAST(:scoreDate AS date)`로 파라미터 타입 명시해 해결. (`NextpickScoreRepository`. `ScreenerController`의 `? - INTERVAL`은 JdbcTemplate이 date로 바인딩해 정상 — JPA `@Query`만 문제였음.)
- **채점 마켓별 독립 트랜잭션 분리**: `scoreAll`이 `@Transactional` 하나로 KR+US를 묶어(그리고 `scoreMarket`의 `@Transactional`은 self-invocation이라 무시됨) 한 마켓 실패가 전체를 롤백시키던 구조 → `scoreAll`은 트랜잭션 제거(오케스트레이션만), `scoreMarket`을 `REQUIRES_NEW` + **ObjectProvider self-proxy 경유** 호출로 마켓별 독립 커밋. US 미활성 예외는 이제 US만 롤백(로그 "해당 마켓만 롤백"). 가격 스냅샷도 **점수 커밋 후 별도 `REQUIRES_NEW`**로 분리(같은 트랜잭션이면 스냅샷 실패가 그 마켓 점수까지 롤백 → 이제 진짜 비치명적). `DerivedMetricsTxHelper`의 기존 REQUIRES_NEW 분리 관례와 동일.

### 알려진 데이터 함정
- **넥스트레이드(NXT) 통합 시세**: 2025 대체거래소 출범 후 실제 체결가는 KRX+NXT 통합. KIS 조회는 `fid_cond_mrkt_div_code` **"UN"(통합)** 우선 → 미지원/빈값 시 **"J"(KRX) 폴백**. `RealtimePriceController`의 `inquirePriceOutput`(시세)·`fetchInvestorRow`(투자자) 둘 다 적용. J만 쓰면 NXT 체결 누락돼 시세·등락률·거래량이 어긋남(진단 예: 삼성전자 UN -9.80% vs J -6.25%). 진단은 `kis-probe.yml`.
  - **배치(장외) 통합 반영 (2026-07-22)**: pykrx는 KRX 정규장만이라 **장 마감~다음날 08:00**엔 목록이 증권사(키움=통합)와 어긋나던 것 → **`kis_valuation_loader`가 KIS inquire-price(UN)의 통합 종가·등락률·거래량·거래대금을 EOD로 `derived_metrics.kis_close/kis_change_pct/kis_volume/kis_turnover`(V24)에 적재**. `loadPriceAndFlow`가 표시값을 `COALESCE(kis_*, 정규장)`로 **통합 우선**. 이제 목록·상세 24시간 증권사 일치. 상세는 추가로 `/api/realtime/price`(비게이트, `fetchLiveQuote`)로 장외에도 통합값+증거금/신용 표시. 스코어 앵커·52주는 price_daily 정규장 유지. (예: 에이피알 278470 장외 KRX -0.82%/480억 → 통합 -0.14%/762억.) 통합 등락률은 KIS 재기준가라 정지 갭 허위 등락률도 방지(아래 거래정지 함정을 kis_change_pct가 대체).
- **거래정지 종목**: 정지 기간 종가 고정+거래량 0, 재개일 폭등. "상한가" 아님. 재개일 등락률을 정지 전 stale 종가로 계산하면 허위 폭등(예: 금호에이치티 214330 정지 2555→재개 9030 = **+253%**, KIS는 재산정 기준가 6950 대비 +29.93%). **픽스(2026-07-08)**: `ScreenerController`의 `loadPriceAndFlow`(리스트/상세 표시)·`/limit-up`·`/stats`(상승종목수·섹터 평균등락) 모두 **전일 거래량>0** 조건으로 정지 갭 배제 → 정지 종목은 등락률 null. 정상 상한가(전일 거래량>0)는 영향 없음. 장중엔 실시간 오버레이가 KIS 정확값 표시. (nextpick_scores.change_rate 정렬 앵커엔 배치값 잔존 — 표시는 loadPriceAndFlow로 교정되나 정렬 순서는 재채점 전까지 stale 가능.)
- **채점 지연**: 가격은 최신일인데 nextpick_scores는 이전일일 수 있음. 헤더 "매일 갱신" 날짜 = 최신 채점일.
- **프로그램 10일 누적 불가**: KIS에 "종목별" 프로그램매매 일별 API 없음(시장별 종합만). → 배치 `program_net_buy_10d`는 null, 장중 실시간(`pgtr_ntby_qty`)만 제공. 프론트도 이 전제로 표시.
- **시간외 종가**: pykrx 종가는 정규장(15:30) 기준. 시간외 단일가는 `after_hours_loader`(20:05)가 `derived_metrics.after_hours_close`에 별도 적재. **표시 정책(2026-07-22 변경)**: 메인 종가·등락률·시총은 **정규장 종가(price_daily.close_adj) 기준**(키움 등 증권사 헤드라인과 일치). 시간외는 `after_hours_close`/`after_hours_change_pct`로 **별도 필드**(오버레이 안 함). 과거 `loadPriceAndFlow`가 `COALESCE(after_hours_close, close)`를 종가·등락률에 오버레이해, 시간외가 정규장과 다른 종목의 등락률을 전일 정규장 종가 대비로 계산→부풀리던 버그 수정(예 엘티씨 170920: 시간외56,000 vs 정규55,100·전일51,600 → 화면 +8.53% 오표기, 실제 +6.78%). `updatePriceSnapshot`(배치)는 처음부터 정규장 기준이라 무관.

### 미해결/주의
- **KIS 쿼터**: 레이트리밋(15/s)+병렬로 완화. 그래도 동시 접속 많으면 압박 → 시세 폴링 5초로 상향 여지. `/api/realtime/debug` 진단.
- **정렬 앵커**: 표시는 통일했으나 정렬 '순서'는 여전히 nextpick_scores 기준(채점 지연 시 stale). 프론트 재정렬이 장중 보정. 완전 통일은 성능 트레이드오프로 보류.
- **진짜 실시간 1초/WebSocket**: REST 폴링은 쿼터상 3~5초가 한계. 초단위는 KIS WebSocket(41종목 제한) 필요 — 별도 과제.

---

## 빠른 명령어

### ETL
```bash
cd /c/Projects/nextpick
PYTHONUTF8=1 python etl/kr_adapter/investor_flow_loader.py   # KIS 수급
PYTHONUTF8=1 python etl/kr_adapter/dart_loader.py             # DART 재무
PYTHONUTF8=1 python etl/kr_adapter/run_backfill_10yr.py       # 10년 백필
```

### Spring Boot
```bash
# 빌드툴 = Gradle (mvn 아님). 로컬 PATH에 mvn/gradle 없으면 래퍼(./gradlew) 사용.
# 로컬 컴파일 검증: JAVA_HOME=<jdk21> ./gradlew compileJava --offline -q  (backend 디렉토리에서)
cd backend && DB_PASSWORD=1234 ./gradlew bootRun
curl -s -X POST http://localhost:8080/api/admin/scoring/run   # 스코어링 실행
```

### DB 확인
```bash
psql -U nextpick_user -d nextpick -c "SELECT COUNT(*) FROM nextpick_scores;"
psql -U nextpick_user -d nextpick -c "SELECT ticker, composite_score FROM nextpick_scores ORDER BY composite_score DESC LIMIT 10;"
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
derived_metrics        (파생: EPS/ROE + rs_percentile/52w/수급/after_hours + per/pbr/eps/bps(V20 KIS밸류에이션 EOD), security_id+as_of_date)
financials             (KIS 재무 원본, DART 미사용)
nextpick_scores         (~2558 종목, CAN SLIM 종합 점수 + 가격 스냅샷)
security_status_daily  (V18, 특이사항 뱃지 스냅샷: statuses TEXT[], security_id+status_date)
```
Flyway 마이그레이션: `backend/src/main/resources/db/migration/` (V1~V20). 백엔드 배포 시 자동 실행. (V19=nextpick 리네이밍, V20=derived_metrics per/pbr/eps/bps.)

## 알려진 데이터 현황
- 최고 점수: 미래에셋생명(085620) C=95.8, I=100
- C 점수 null: 상위 30위 중 21개 (DART 커버리지 부족)
- A 점수 null: 상위 30위 중 27개 (DART 커버리지 부족)
