# NEXTPICK 리디자인 → canslim 적용 핸드오프

토스풍 리디자인 프로토타입을 실제 `shubbydobob/canslim` 프론트엔드에 이식하기 위한 명세.
색은 전부 기존 `frontend/src/index.css`의 CSS 변수를 쓰므로 `[data-theme]` 라이트/다크에 자동 대응됩니다.

---

## 0. 요약: 무엇을 바꾸나

| 항목 | 현재 (canslim) | 적용 후 |
|---|---|---|
| 지표 표현 | 숫자 위주 테이블 | 게이지 + 레이더 + 미니막대로 시각화 |
| 데이터 | `ScreenerPage` mockData (GAP #2) | `/api/screener` 실데이터 |
| 컴포넌트 | 없음 | `ScoreGauge` · `CanslimRadar` · `FactorBars` (재사용) |
| 디자인 토큰 | 이미 존재 (`--accent`, `--up/--down`) | 그대로 사용 — **추가 작업 없음** |

핵심: 디자인 토큰과 CAN SLIM 데이터 모델이 **이미 맞춰져 있어서**, 시각화 컴포넌트 3개만 얹으면 됩니다.

---

## 1. 파일 배치

```
frontend/src/
  utils/canslim.ts        ← 팩터 메타 + 색/티어 매핑 헬퍼
  components/
    ScoreGauge.tsx        ← 종합 스코어 도넛 게이지
    CanslimRadar.tsx      ← C·A·N·S·L·I·M 7축 레이더
    FactorBars.tsx        ← 미니 막대 7개 (랭킹 행/카드용)
```

`canslim.ts`는 `import type { ScreenerItem } from '../types'` 를 쓰므로 경로만 맞으면 그대로 컴파일됩니다.

---

## 2. `ScreenerItem` → 화면 요소 매핑

이미 정의된 `types.ts`의 필드를 그대로 사용합니다.

| 화면 요소 | ScreenerItem 필드 |
|---|---|
| 게이지 숫자 / 티어 | `compositeScore`, `marketPercentile` |
| 레이더·막대 7축 | `cScore` `aScore` `nScore` `sScore` `lScore` `iScore` `mScore` |
| 현재가 / 등락률 | `closePrice`, `changeRate` |
| 전체 순위 | `marketRank` (/ `ScreenerPage.total`) |
| 신고가 돌파 뱃지 | `breakoutToday` |
| 베이스 기간 | `baseDays` |
| 일간 스코어 변화 | `scoreDelta` |
| 섹터 히트맵·필터 | `sector` |
| 수급 상세 | `instNetBuy10d`, `foreignNetBuy10d`, `programNetBuy10d` |
| 시간외 | `afterHoursPrice`, `afterHoursChangeRate` |
| 상세 추이 차트 | `ScoreHistory[]` (기존 `PriceChart`/신규 스코어 추이) |

7개 팩터는 헬퍼로 한 번에 뽑습니다:

```ts
import { canslimValues } from '../utils/canslim'
const vals = canslimValues(item)   // (number | null)[] length 7
```

---

## 3. 사용 예시

### 랭킹 테이블 행
```tsx
import FactorBars from './FactorBars'
import { canslimValues, scoreTier, changeColor } from '../utils/canslim'

function Row({ item }: { item: ScreenerItem }) {
  const tier = scoreTier(item.compositeScore)
  return (
    <tr>
      <td>{item.marketRank}</td>
      <td>{item.name} <span className="mono">{item.ticker}</span></td>
      <td style={{ color: tier.color, fontWeight: 800 }}>{item.compositeScore ?? '–'}</td>
      <td><FactorBars values={canslimValues(item)} /></td>
      <td style={{ color: changeColor(item.changeRate) }}>
        {item.changeRate == null ? '–' : `${item.changeRate > 0 ? '+' : ''}${item.changeRate.toFixed(1)}%`}
      </td>
    </tr>
  )
}
```

### 종목 상세 헤더
```tsx
import ScoreGauge from './ScoreGauge'
import CanslimRadar from './CanslimRadar'
import { canslimValues } from '../utils/canslim'

<div style={{ display: 'flex', gap: 20 }}>
  <ScoreGauge score={item.compositeScore} />
  <CanslimRadar values={canslimValues(item)} />
</div>
```

### 상세 팩터 리스트 (막대 + 설명)
```tsx
import { CANSLIM, canslimValues, factorColor } from '../utils/canslim'

const vals = canslimValues(item)
{CANSLIM.map((m, i) => (
  <div key={m.letter}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span>{m.letter} · {m.name}</span>
      <span style={{ color: factorColor(vals[i]), fontWeight: 800 }}>{vals[i] ?? '–'}</span>
    </div>
    <div style={{ height: 7, background: 'var(--track)', borderRadius: 99 }}>
      <div style={{ width: `${vals[i] ?? 0}%`, height: '100%', background: factorColor(vals[i]), borderRadius: 99 }} />
    </div>
    <small style={{ color: 'var(--text-3)' }}>{m.desc}</small>
  </div>
))}
```

---

## 4. null 처리 (중요)

`CLAUDE.md`에 따르면 상위 30위 중 C 21개·A 27개가 `null`(DART 커버리지 부족).
컴포넌트는 이미 null-safe:

- **게이지/막대 숫자** → `'–'` 로 표기
- **레이더** → 0으로 그리되 꼭짓점을 **빈 원(hollow)** 으로 → "값 없음"과 "0점"을 구분
- **막대 색** → `factorColor(null)` = 연회색(`--border-sub`)

즉 데이터 공백이 "약함"으로 오독되지 않습니다.

---

## 5. 데이터 연동 (GAP #2)

`ScreenerPage.tsx`의 mockData를 실제 API로 교체:

```ts
// api/client.ts 에 이미 baseURL/axios가 있다면:
const { data } = await client.get<ScreenerPage>('/api/screener', {
  params: { page, size, sector, minScore, sortBy: 'compositeScore', order: 'desc' },
})
setItems(data.items); setTotal(data.total)
```

- 정렬/필터는 **서버 파라미터**로 (2,558종목 → 클라 정렬 금지)
- 프로토타입의 스코어/수급 슬라이더 → `minScore`, `minSScore` 등 쿼리로 매핑

---

## 6. 테마

컴포넌트는 하드코딩 색이 하나도 없습니다. 필요한 변수:

- 기존 `index.css`에 있음: `--accent` `--accent-strong` `--accent-soft` `--track` `--surface` `--border` `--border-sub` `--text-3` `--text-4` `--up` `--down`
- 신규 1개만 추가 권장(없으면 `--border`로 폴백됨):
  ```css
  :root, [data-theme='light'] { --radar-grid: #e8ecf1; }
  [data-theme='dark']        { --radar-grid: #2d3440; }
  ```

`color-mix()`는 모던 브라우저 지원. 구형 대응이 필요하면 `factorColor`의 중간 두 단계를 고정 hex로 바꾸세요.
