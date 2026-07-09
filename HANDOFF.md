# HANDOFF — 다른 컴퓨터에서 이어서 작업하기

작성: 2026-07-09 세션. 최신 커밋 기준(`git log`로 확인). 이 파일은 진행 상황·남은 일·주의사항 인수인계용.

## 0. 먼저 할 일 (새 로컬 환경)
```bash
git clone https://github.com/shubbydobob/nextpick.git   # 레포명은 nextpick으로 리네이밍됨
cd nextpick
# 프론트
cd frontend && npm install && npm run build   # 빌드 통과 확인
# (선택) 백엔드
cd ../backend && ./gradlew compileJava
```
- 운영 EC2 SSH: 키 `K_STOCK.pem` (이전 세션 위치 `~/Downloads/K_STOCK.pem`).
  `ssh -i K_STOCK.pem ubuntu@13.209.47.193` → `/home/ubuntu/nextpick`, 컨테이너 `nextpick-postgres`/`nextpick-backend`.
- 배포: master 푸시 시 `backend/**`·`etl/**`·`docker-compose.prod.yml` 변경 → deploy.yml 자동. 프론트는 Vercel 자동.

## 1. 이번 세션 완료·배포됨
- **canslim→nextpick 전면 리네이밍(저작권)**: 백엔드 패키지/클래스/테이블(V19), DB명·유저·볼륨·컨테이너·EC2경로, ETL(db.yaml는 gitignore라 서버 직접수정 완료), 문서, **GitHub 레포·원격 URL**. 운영 데이터 dump/restore 이관, 스코어링 검증(KR 2558종목 0오류).
- **KIS 재무비율**: `RealtimePriceController.fetchQuote`가 inquire-price(FHKST01010100)의 **per/pbr/eps/bps**를 quote에 실음(추가 콜 0). 상세 투자지표 카드가 KIS 실측 우선(장중)/근사 폴백(장외). LiveQuote 타입 +4필드.
- **인라인 CSS → 공통 클래스 (진행 중, 아래 2 참고)**: `CLAUDE.md`에 규칙 명문화. 완료 영역:
  - 스크리너: 테이블(ScoreCell/SortTh/헤더/행), 모바일카드(.scard-*), 필터버튼(ChipBtn)/셀/페이지네이션(PgBtn).
  - 상세: 히어로, 가격바, 당일수급, 매매시그널, 투자지표, 섹터비교표, 유사종목표, 수급바, 실적탭, 기술분석, 뉴스, 배지.
  - 공통 클래스는 `frontend/src/index.css`에: `.scr-*`, `.scard-*`, `.metric-*`, `.det-*`, `.chip-btn`, `.pg-btn`, `.badge*`.
- 기타: 상세 'C/A/N/S/I' 헤더 → 한글 팩터명(CANSLI 철자 제거), 스크리너 티커 컬럼 제거·가로스크롤 완화, 상세 배지 상시화.

## 2. 인라인 CSS 제거 — ✅ 완료 (2026-07-09)
**규칙(계속 준수)**: 인라인 `style` 금지. `frontend/src/index.css` 공통 클래스 사용. **동적 런타임 값만** `style={{ ['--x' as string]: value }}` → CSS `var(--x)`. 색은 하드코딩 대신 `var(--text-1)` 등 토큰. (CLAUDE.md '🎨 프론트엔드 스타일 규칙' 참고.)

`ScreenerPage.tsx` + `StockDetailPanel.tsx` 정적 인라인 전량 이관 완료(빌드·타입체크 통과, master 반영). 남은 인라인은 전부 `--var` 할당(허용) + recharts config(formatter/tick/margin/contentStyle 등, 규칙상 유지).
- 신규 공통 클래스: 모달(`.modal-overlay`/`.modal-card`/`.guide-*`/`.premium-*`/`.btn-fill`/`.btn-ghost`), nav(`.nav-*`/`.theme-toggle`—data-theme CSS구동), 필터/결과바/칩/테이블/페이지네이션, 상세(`.factor-*`/`.chart-tooltip*`/`.section-title`/`.card`+`.mb/.grow/.side`/`.detail-topbar*`).
- 부수효과 정리: `hoveredId` state 제거(→CSS `nth-child`/`:hover`), 테마토글 JS인라인 제거(→`[data-theme]`), `Card`는 `style` prop→`className`.
- **다른 파일 수정 시에도 이 규칙 유지**. 컨테이너 중 `detail-hero`/`detail-price-bar`/`detail-factors`/`detail-radar-flow`/`nav-bar`/`filter-grid` 등은 `@media(max-width:768px)` 반응형 규칙 있으니 클래스명 유지하고 base만 추가.

## 3. 남은 일 — KIS 재무 EOD 스냅샷 (선택, "필요하면 DB")
현재 KIS per/pbr는 **장중(09:00~18:00)만** 실측(realtime 엔드포인트가 장외엔 `[]`). 장외에도 항상 실측을 원하면:
- V20 마이그레이션: `derived_metrics`에 `per,pbr,eps,bps` 컬럼 추가.
- ETL `kis_valuation_loader.py`: inquire-price로 전종목 per/pbr/eps/bps 수집 → `derived_metrics`(as_of_date=오늘) upsert. `run_daily` 편입(~2558콜, 15분).
- 백엔드: `/screener/{id}` 응답(ScreenerItemResponse)에 4필드 추가(derived_metrics 조인). `ScreenerController.getScore` + `ScreenerItemResponse.of`.
- 프론트: `types.ts ScreenerItem` +per/pbr/eps/bps, 상세 카드 `stock.per ?? live.per ?? 근사`.

## 4. 남은 일 — 로컬 폴더 rename (사용자 수동, OS 잠금)
`C:\Projects\canslim` → `nextpick`: 실행중 프로세스가 폴더를 잡아 세션 내 불가. 세션 종료 후 스크래치패드의 `rename_local_folder.ps1`(폴더 rename + `.claude/settings.json` 훅경로 갱신) 실행. 새 클론이면 무관.

## 5. 검증 명령
```bash
cd frontend && npx tsc --noEmit && npm run build   # 프론트
cd backend && ./gradlew compileJava                # 백엔드
# 운영 상태: gh Actions db-status.yml, 또는 SSH로 docker ps / psql
```

## 6. 주의(데이터 함정 등)은 CLAUDE.md 참조
넥스트레이드 UN/J, 거래정지 갭, 채점 지연, 프로그램 10일 누적 불가, 시간외 종가 등.
