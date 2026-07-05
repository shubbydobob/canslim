import { useState, useEffect } from 'react'
import type { ScreenerItem } from '../types'
import { fetchScreenerStats } from '../api/client'
import type { ScreenerStats } from '../api/client'

interface Props {
  items: ScreenerItem[]
  loading: boolean
  marketStates: Array<{
    market: string
    marketPhase?: string
    trendDirection?: string
    stateDate?: string
  }>
  onViewRanking: () => void
  onSectorClick: (sector: string) => void
  onStockClick: (id: number) => void
}

function computeMarketLabel(marketStates: Props['marketStates'], items: ScreenerItem[]): { label: string; color: string; bg: string } {
  const kospi = marketStates.find(m => m.market === 'KOSPI')
  const avgM = items.length > 0
    ? items.reduce((s, i) => s + (i.mScore ?? 0), 0) / items.length
    : 0

  if (kospi?.marketPhase === 'BULL' && avgM >= 40) {
    return { label: '위험선호 우위', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' }
  }
  if (kospi?.marketPhase === 'BEAR' || avgM < 20) {
    return { label: '하락 조심', color: '#f87171', bg: 'rgba(248,113,113,0.12)' }
  }
  return { label: '선별적 접근', color: '#fabd44', bg: 'rgba(250,189,68,0.12)' }
}

function HorizontalBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{
      height: 6,
      background: 'var(--track)',
      borderRadius: 3,
      overflow: 'hidden',
      flex: 1,
    }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: color,
        borderRadius: 3,
        transition: 'width 0.4s ease',
      }} />
    </div>
  )
}

export default function DashboardView({
  items,
  loading,
  marketStates,
  onViewRanking,
  onSectorClick,
  onStockClick,
}: Props) {
  const [hoveredRankId, setHoveredRankId] = useState<number | null>(null)
  const [stats, setStats] = useState<ScreenerStats | null>(null)

  useEffect(() => {
    fetchScreenerStats('KR').then(setStats).catch(() => {})
  }, [])

  // ── Stats (전체 2558종목 기준) ──────────────────────────────────
  const bullCount = stats?.bullCount ?? 0
  const avgScore  = stats ? Math.round(stats.avgScore) : 0
  const upCount   = stats?.upCount ?? 0
  const total     = stats?.total ?? 0
  const sectorStats = (stats?.sectorStats ?? []).map(r => ({
    sector:    r.sector,
    count:     Number(r.cnt),
    avgChange: r.avg_change != null ? Number(r.avg_change) : 0,
    avgScore:  r.avg_score  != null ? Number(r.avg_score)  : 0,
  }))
  const marketLabel = computeMarketLabel(marketStates, items)

  // TOP 15 for ranking panel
  const topItems = [...items]
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, 15)
  const maxScore = topItems[0]?.compositeScore ?? 100

  // Score color
  const scoreColor = (v: number) => {
    if (v >= 85) return '#4ade80'
    if (v >= 70) return '#86efac'
    if (v >= 55) return '#fabd44'
    return '#f87171'
  }

  const changeColor = (v: number | null) => {
    if (v === null) return 'var(--text-4)'
    if (v > 0) return 'var(--up)'
    if (v < 0) return 'var(--down)'
    return 'var(--text-3)'
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200 }}>

      {/* ── Stat cards ──────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr) 1fr',
        gap: 12,
        marginBottom: 24,
      }}>

        {/* Card 1: 강세 종목 */}
        <StatCard
          label="강세 종목 (70점+)"
          value={bullCount.toLocaleString()}
          unit="종목"
          subtext={total > 0 ? `전체 ${total.toLocaleString()}종목 중` : ''}
          accent="var(--accent)"
        />

        {/* Card 2: 평균 종합 스코어 */}
        <StatCard
          label="평균 종합 스코어"
          value={String(avgScore)}
          unit="점"
          subtext="CAN SLIM 가중 합산"
          accent="var(--accent)"
          valueColor="var(--accent)"
        />

        {/* Card 3: 상승 종목 */}
        <StatCard
          label="상승 종목"
          value={upCount.toLocaleString()}
          unit={`/ ${total.toLocaleString()}`}
          subtext={total > 0 ? `${Math.round((upCount / total) * 100)}% 상승` : ''}
          accent="var(--up)"
          valueColor="var(--up)"
        />

        {/* Card 4: 시장 상태 (accent bg) */}
        <div style={{
          background: marketLabel.bg,
          border: `1px solid ${marketLabel.color}44`,
          borderRadius: 12,
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', color: marketLabel.color, textTransform: 'uppercase' }}>
            시장 상태
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: marketLabel.color, lineHeight: 1.2 }}>
            {marketLabel.label}
          </div>
          <div style={{ fontSize: 11, color: marketLabel.color, opacity: 0.75 }}>
            {marketStates.find(m => m.market === 'KOSPI')?.stateDate ?? '—'}
          </div>
        </div>
      </div>

      {/* ── Bottom 2-col: Ranking + Sector Heatmap ──────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
        alignItems: 'start',
      }}>

        {/* LEFT: TOP Ranking */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          {/* Panel header */}
          <div style={{
            padding: '14px 18px 12px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
              스코어 TOP 랭킹
            </span>
            <button
              onClick={onViewRanking}
              style={{
                fontSize: 11,
                color: 'var(--accent)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              전체보기 →
            </button>
          </div>

          {/* Ranking list */}
          <div style={{ padding: '8px 0' }}>
            {loading && Array.from({ length: 10 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px' }}>
                <div style={{ width: 18, height: 10, borderRadius: 3, background: 'var(--bg-elevated)' }} />
                <div style={{ flex: '0 0 90px', height: 10, borderRadius: 3, background: 'var(--bg-elevated)' }} />
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-elevated)' }} />
                <div style={{ width: 28, height: 10, borderRadius: 3, background: 'var(--bg-elevated)' }} />
              </div>
            ))}
            {!loading && topItems.map((item, idx) => {
              const hovered = hoveredRankId === item.securityId
              const sc = scoreColor(item.compositeScore)
              return (
                <div
                  key={item.securityId}
                  onClick={() => onStockClick(item.securityId)}
                  onMouseEnter={() => setHoveredRankId(item.securityId)}
                  onMouseLeave={() => setHoveredRankId(null)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 18px',
                    cursor: 'pointer',
                    background: hovered ? 'var(--bg-elevated)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: idx < 3 ? 'var(--accent)' : 'var(--text-4)',
                    width: 18,
                    textAlign: 'right',
                    fontFamily: 'var(--font-mono)',
                    flexShrink: 0,
                  }}>
                    {idx + 1}
                  </span>

                  <div style={{ flex: '0 0 90px', overflow: 'hidden' }}>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-1)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.name}
                    </div>
                    <div style={{
                      fontSize: 10,
                      color: 'var(--accent)',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                    }}>
                      {item.ticker}
                    </div>
                  </div>

                  <HorizontalBar value={item.compositeScore} max={maxScore} color={sc} />

                  <span style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: sc,
                    fontFamily: 'var(--font-mono)',
                    width: 28,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}>
                    {Math.round(item.compositeScore)}
                  </span>

                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: changeColor(item.changeRate),
                    fontFamily: 'var(--font-mono)',
                    width: 44,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}>
                    {item.changeRate !== null
                      ? (item.changeRate >= 0 ? '+' : '') + item.changeRate.toFixed(2) + '%'
                      : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* RIGHT: Sector Heatmap */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          {/* Panel header */}
          <div style={{
            padding: '14px 18px 12px',
            borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
              섹터 히트맵
            </span>
          </div>

          {/* Sector grid */}
          <div style={{
            padding: '12px',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 6,
          }}>
            {sectorStats.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '32px 0', color: 'var(--text-4)', fontSize: 12 }}>
                섹터 데이터 없음
              </div>
            ) : (
              sectorStats
                .sort((a, b) => Math.abs(b.avgChange) - Math.abs(a.avgChange))
                .slice(0, 15)
                .map(sec => {
                  const isUp = sec.avgChange >= 0
                  const bgColor = isUp
                    ? `rgba(232, 51, 63, ${Math.min(0.18, Math.abs(sec.avgChange) * 0.05)})`
                    : `rgba(47, 115, 224, ${Math.min(0.18, Math.abs(sec.avgChange) * 0.05)})`
                  const borderColor = isUp
                    ? `rgba(232, 51, 63, ${Math.min(0.35, Math.abs(sec.avgChange) * 0.1)})`
                    : `rgba(47, 115, 224, ${Math.min(0.35, Math.abs(sec.avgChange) * 0.1)})`
                  const textClr = isUp ? 'var(--up)' : 'var(--down)'

                  return (
                    <button
                      key={sec.sector}
                      onClick={() => onSectorClick(sec.sector)}
                      style={{
                        background: bgColor,
                        border: `1px solid ${borderColor}`,
                        borderRadius: 8,
                        padding: '10px 10px 8px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'opacity 0.12s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '0.8' }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                    >
                      <div style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--text-1)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginBottom: 4,
                      }}>
                        {sec.sector}
                      </div>
                      <div style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: textClr,
                        fontFamily: 'var(--font-mono)',
                        marginBottom: 3,
                      }}>
                        {sec.avgChange >= 0 ? '+' : ''}{sec.avgChange.toFixed(2)}%
                      </div>
                      <div style={{
                        fontSize: 9,
                        color: 'var(--text-4)',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {sec.count}종목
                      </div>
                    </button>
                  )
                })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── StatCard helper ────────────────────────────────────────────
function StatCard({
  label,
  value,
  unit,
  subtext,
  accent,
  valueColor,
}: {
  label: string
  value: string
  unit?: string
  subtext?: string
  accent: string
  valueColor?: string
}) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Top accent line */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        background: accent,
        opacity: 0.6,
      }} />
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        color: 'var(--text-3)',
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{
          fontSize: 26,
          fontWeight: 800,
          color: valueColor ?? 'var(--text-1)',
          fontFamily: 'var(--font-mono)',
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>
            {unit}
          </span>
        )}
      </div>
      {subtext && (
        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
          {subtext}
        </div>
      )}
    </div>
  )
}
