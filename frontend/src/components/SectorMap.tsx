import { useEffect, useState } from 'react'
import { fetchSectorSummary } from '../api/client'

interface SectorStat {
  sector: string
  count: number
  avgScore: number
  avgChange: number
  totalCap: number
  topStock: string
  topScore: number
}

interface Props {
  onSectorClick?: (sector: string) => void
}

export default function SectorMap({ onSectorClick }: Props) {
  const [sectors, setSectors] = useState<SectorStat[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredSector, setHoveredSector] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    // 백엔드 집계 엔드포인트(GROUP BY + 캐시) — 2600종목 전송 없이 섹터 요약만
    fetchSectorSummary('KR')
      .then(rows => {
        const stats: SectorStat[] = rows.map(r => ({
          sector: r.sector ?? '기타',
          count: r.count ?? 0,
          avgScore: Number(r.avgScore ?? 0),
          avgChange: Number(r.avgChange ?? 0),
          totalCap: Number(r.totalCap ?? 0),
          topStock: r.topName ?? '',
          topScore: Number(r.topScore ?? 0),
        }))
        setSectors(stats)   // 백엔드가 이미 시총 desc 정렬
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: 'var(--text-4)' }}>
      섹터 데이터 로딩 중...
    </div>
  )

  // Calculate total market cap for sizing
  const totalAllCap = sectors.reduce((s, sec) => s + sec.totalCap, 0)

  // Color function based on avgChange
  const cellColor = (change: number) => {
    if (change >= 3) return '#166534'
    if (change >= 1.5) return '#15803d'
    if (change >= 0.5) return '#1a6b3a'
    if (change >= 0) return '#1a3a2a'
    if (change >= -0.5) return '#3a1a1a'
    if (change >= -1.5) return '#7f1d1d'
    if (change >= -3) return '#991b1b'
    return '#b91c1c'
  }

  const textColor = (change: number) => {
    if (change >= 1) return '#4ade80'
    if (change >= 0) return '#86efac'
    if (change >= -1) return '#fca5a5'
    return '#f87171'
  }

  // Layout: simple treemap-like grid
  // Split into rows based on cumulative area
  const rows: SectorStat[][] = []
  let currentRow: SectorStat[] = []
  let currentRowCap = 0
  const rowTargetCap = totalAllCap / 4 // ~4 rows

  sectors.forEach(sec => {
    currentRow.push(sec)
    currentRowCap += sec.totalCap
    if (currentRowCap >= rowTargetCap && currentRow.length >= 2) {
      rows.push(currentRow)
      currentRow = []
      currentRowCap = 0
    }
  })
  if (currentRow.length > 0) rows.push(currentRow)

  return (
    <div style={{ padding: '20px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>섹터맵</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
          섹터별 등락률과 시가총액을 한눈에 — 크기: 시총, 색상: 등락률
        </div>
      </div>

      {/* Treemap */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderRadius: 10, overflow: 'hidden' }}>
        {rows.map((row, ri) => {
          const rowTotal = row.reduce((s, sec) => s + sec.totalCap, 0)
          return (
            <div key={ri} style={{ display: 'flex', gap: 2, height: 120 }}>
              {row.map(sec => {
                const pct = (sec.totalCap / rowTotal) * 100
                const isHovered = hoveredSector === sec.sector
                return (
                  <div
                    key={sec.sector}
                    onClick={() => onSectorClick?.(sec.sector)}
                    onMouseEnter={() => setHoveredSector(sec.sector)}
                    onMouseLeave={() => setHoveredSector(null)}
                    style={{
                      width: `${pct}%`, minWidth: 60,
                      background: cellColor(sec.avgChange),
                      padding: '8px 10px', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                      overflow: 'hidden', position: 'relative',
                      opacity: isHovered ? 1 : 0.9,
                      outline: isHovered ? '2px solid #58a6ff' : 'none',
                      outlineOffset: -2,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <div>
                      <div style={{
                        fontSize: pct > 15 ? 13 : 11, fontWeight: 700,
                        color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{sec.sector}</div>
                      <div style={{
                        fontSize: pct > 15 ? 22 : 16, fontWeight: 900,
                        color: textColor(sec.avgChange), marginTop: 2,
                      }}>
                        {sec.avgChange >= 0 ? '+' : ''}{sec.avgChange.toFixed(2)}%
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>
                      {sec.count}종목 · 평균 {sec.avgScore.toFixed(0)}점
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Hovered sector detail */}
      {hoveredSector && (() => {
        const sec = sectors.find(s => s.sector === hoveredSector)
        if (!sec) return null
        return (
          <div style={{
            marginTop: 12, padding: '12px 16px',
            background: 'var(--bg-nav)', border: '1px solid var(--border)', borderRadius: 8,
            display: 'flex', alignItems: 'center', gap: 20,
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{sec.sector}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{sec.count}개 종목</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-4)' }}>평균 등락률</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: textColor(sec.avgChange) }}>
                {sec.avgChange >= 0 ? '+' : ''}{sec.avgChange.toFixed(2)}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-4)' }}>평균 SCORE</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: sec.avgScore >= 60 ? '#4ade80' : '#fabd44' }}>
                {sec.avgScore.toFixed(1)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-4)' }}>Top 종목</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                {sec.topStock} <span style={{ color: '#58a6ff', fontSize: 11 }}>{sec.topScore.toFixed(1)}</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-4)' }}>총 시총</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                {sec.totalCap >= 1e12 ? (sec.totalCap / 1e12).toFixed(0) + '조' : (sec.totalCap / 1e8).toFixed(0) + '억'}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Legend */}
      <div style={{
        marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
      }}>
        {[
          { label: '-3%↓', bg: '#b91c1c' },
          { label: '-1.5%', bg: '#7f1d1d' },
          { label: '0%', bg: '#1a3a2a' },
          { label: '+1.5%', bg: '#15803d' },
          { label: '+3%↑', bg: '#166534' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: 'var(--text-4)' }}>
            <div style={{ width: 14, height: 10, borderRadius: 2, background: l.bg }} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  )
}
