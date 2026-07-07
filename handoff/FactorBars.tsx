// frontend/src/components/FactorBars.tsx
// 랭킹 행/카드용 미니 막대 7개. 좁은 폭에서 CAN SLIM 프로파일을 한눈에.
import { CANSLIM, factorColor } from '../utils/canslim'

interface Props {
  values: (number | null)[]  // canslimValues(item) 결과, 길이 7
  height?: number            // px, 기본 34
  barWidth?: number          // px, 기본 7
  gap?: number               // px, 기본 5
}

export default function FactorBars({ values, height = 34, barWidth = 7, gap = 5 }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap, height }}>
      {values.map((v, i) => (
        <div
          key={CANSLIM[i].letter}
          title={`${CANSLIM[i].letter} · ${CANSLIM[i].name}${v == null ? ' (미집계)' : ` ${v}점`}`}
          style={{ width: barWidth, height: '100%', display: 'flex', alignItems: 'flex-end', background: 'var(--track)', borderRadius: 3, overflow: 'hidden' }}
        >
          <div style={{ width: '100%', height: `${v ?? 0}%`, background: factorColor(v), borderRadius: 3 }} />
        </div>
      ))}
    </div>
  )
}
