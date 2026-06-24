# CANSLIM 스코어링 엔진 — 세션 진입점

## 프로젝트 개요
한국 주식시장 CAN SLIM 방법론 기반 자동 스코어링 시스템.
ETL(Python) → PostgreSQL → Scoring Engine(Spring Boot) → Screener UI(React)

**현재**: Phase 3 완료 (2558종목 스코어 적재) | **다음**: Phase 4 (completeness discount, EDGAR, 프론트 연동)

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
price_metrics          (~2558 종목, 10년 일별 가격)
rs_percentile          (~2513 종목, 상대강도 백분위)
financial_metrics_normalized  (~285 종목, DART 재무 정규화)
canslim_scores         (~2558 종목, CAN SLIM 종합 점수)
```

## 알려진 데이터 현황
- 최고 점수: 미래에셋생명(085620) C=95.8, I=100
- C 점수 null: 상위 30위 중 21개 (DART 커버리지 부족)
- A 점수 null: 상위 30위 중 27개 (DART 커버리지 부족)
