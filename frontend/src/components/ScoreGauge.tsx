// frontend/src/components/ScoreGauge.tsx
// 종합 스코어 도넛 게이지. compositeScore 하나만 넘기면 됩니다.
import { scoreTier } from '../utils/canslim'

interface Props {
  score: number | null       // item.compositeScore
  size?: number              // px, 기본 200
  label?: string             // 미지정 시 티어 라벨(강함/보통…)
}

export default function ScoreGauge({ score, size = 200, label }: Props) {
  const tier = scoreTier(score)
  const r = 86
  const c = 2 * Math.PI * r
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score))
  const off = c * (1 - pct / 100)

  return (
    <div className="score-gauge" style={{ ['--sg-size' as string]: `${size}px` }}>
      <svg width="100%" height="100%" viewBox="0 0 200 200">
        <circle cx={100} cy={100} r={r} fill="none" stroke="var(--track)" strokeWidth={14} />
        <circle
          className="sg-progress"
          cx={100} cy={100} r={r} fill="none"
          stroke={tier.color} strokeWidth={14} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off}
          transform="rotate(-90 100 100)"
        />
      </svg>
      <div className="score-gauge-label" style={{ ['--sg-color' as string]: tier.color, ['--sg-tint' as string]: tier.tint }}>
        <span className="score-gauge-num" style={{ ['--sg-fs' as string]: `${size * 0.24}px` }}>
          {score == null ? '–' : Math.round(score)}
        </span>
        <span className="score-gauge-tier">
          {label ?? tier.label}
        </span>
      </div>
    </div>
  )
}
