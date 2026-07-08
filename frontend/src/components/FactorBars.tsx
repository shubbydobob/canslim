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
    <div className="factor-bars" style={{ ['--fb-gap' as string]: `${gap}px`, ['--fb-h' as string]: `${height}px` }}>
      {values.map((v, i) => (
        <div
          key={CANSLIM[i].letter}
          title={`${CANSLIM[i].letter} · ${CANSLIM[i].name}${v == null ? ' (미집계)' : ` ${v}점`}`}
          className="factor-bar"
          style={{ ['--fb-w' as string]: `${barWidth}px` }}
        >
          <i style={{ ['--fb-fill' as string]: `${v ?? 0}%`, ['--fb-color' as string]: factorColor(v) }} />
        </div>
      ))}
    </div>
  )
}
