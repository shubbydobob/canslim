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

## 2. 남은 일 — 인라인 CSS 제거 (최우선, 사용자 강조)
**규칙(반드시 준수)**: 인라인 `style` 금지. `frontend/src/index.css` 공통 클래스 사용. **동적 런타임 값만** `style={{ ['--x' as string]: value }}` → CSS `var(--x)`. 색은 하드코딩 대신 `var(--text-1)` 등 토큰. (CLAUDE.md '🎨 프론트엔드 스타일 규칙' 참고.)

남은 정적 인라인 위치 (grep `style={{`):
- `frontend/src/pages/ScreenerPage.tsx` (~104곳, 단 상당수는 CSS변수 할당=허용):
  - **nav 헤더**(로고/검색창/우측 컨트롤/테마토글/가챠/방문자/플래너/모바일) L~772–913
  - 프리미엄 게이팅 모달 L~731–765, GuidePopup L~98–170, FACTORS 팝업
  - M배너 L~974–985, 이번주상승 하이라이트 L~1133–1159
  - 결과바(뷰탭/라이브배지/카운트/행수 select) L~1164–1235, 필터칩 L~1250–1275
  - 페이지네이션 wrapper L~1353–1370, 에러/폴백 div
- `frontend/src/components/StockDetailPanel.tsx` (~62곳):
  - **변환 대상**: 프리미엄 모달 L~289–308, 팩터카드 컨테이너, `Card`의 style prop(width/flex — Card에 className 지원 추가 후 이관 권장), SectionTitle 관련.
  - **변환 대상 아님(그대로 둘 것)**: recharts 설정 객체 — `tick={{...}}`, `margin={{...}}`, `contentStyle`, `labelStyle`, `wrapperStyle`, `formatter={v=><span style=...>}`, `<stop>` 그라디언트. SVG 차트 config이지 DOM CSS 아님.

작업 팁: 컨테이너 중 `detail-hero`/`detail-price-bar`/`detail-factors`/`detail-radar-flow`는 `@media(max-width:768px)` 반응형 규칙(+ `> div` 자식 선택자)이 있으니 **클래스명 유지**하고 base 스타일만 그 클래스에 추가.

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
