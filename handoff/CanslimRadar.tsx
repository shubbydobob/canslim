// frontend/src/components/CanslimRadar.tsx
// C·A·N·S·L·I·M 7축 레이더. null 값은 0으로 그리되 꼭짓점은 빈 원(hollow)으로 표시.
import { CANSLIM } from '../utils/canslim'

interface Props {
  values: (number | null)[]  // canslimValues(item) 결과, 길이 7
  size?: number              // px, 기본 260
}

export default function CanslimRadar({ values, size = 260 }: Props) {
  const cx = size / 2, cy = size / 2, R = size * 0.36, n = 7
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const pt = (i: number, rad: number): [number, number] => [cx + Math.cos(ang(i)) * rad, cy + Math.sin(ang(i)) * rad]
  const vals = values.map(v => v ?? 0)
  const ring = (rad: (i: number) => number) =>
    vals.map((_, i) => pt(i, rad(i)).map(x => x.toFixed(1)).join(',')).join(' ')

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0.25, 0.5, 0.75, 1].map(lv => (
        <polygon key={lv} points={ring(() => R * lv)} fill="none" stroke="var(--radar-grid, var(--border))" strokeWidth={1} />
      ))}
      {vals.map((_, i) => {
        const [x, y] = pt(i, R)
        return <line key={i} x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="var(--radar-grid, var(--border))" strokeWidth={1} />
      })}
      <polygon
        points={ring(i => (R * vals[i]) / 100)}
        fill="color-mix(in srgb, var(--accent) 14%, transparent)"
        stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round"
      />
      {vals.map((v, i) => {
        const [x, y] = pt(i, (R * v) / 100)
        const isNull = values[i] == null
        return (
          <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={3}
            fill={isNull ? 'var(--surface)' : 'var(--accent)'}
            stroke="var(--accent)" strokeWidth={isNull ? 1.5 : 0} />
        )
      })}
      {CANSLIM.map((m, i) => {
        const [x, y] = pt(i, R + size * 0.07)
        return (
          <text key={m.letter} x={x.toFixed(1)} y={y.toFixed(1)}
            fill="var(--text-3)" fontSize={12} fontWeight={700}
            textAnchor="middle" dominantBaseline="middle">{m.letter}</text>
        )
      })}
    </svg>
  )
}
