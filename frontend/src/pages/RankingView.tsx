import { useState } from 'react'
import type { ScreenerItem } from '../types'

interface Props {
  items: ScreenerItem[]
  loading: boolean
  onStockClick: (id: number) => void
}

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

export default function RankingView({ items, loading, onStockClick }: Props) {
  const [hovered, setHovered] = useState<number | null>(null)

  const topItems = [...items]
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, 50)
  const maxScore = topItems[0]?.compositeScore ?? 100

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '80px 0', color: 'var(--text-3)', fontSize: 13 }}>
        <span className="spinner" />
        랭킹 데이터 로딩 중...
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{
          fontSize: 22,
          fontWeight: 800,
          color: 'var(--text-1)',
          letterSpacing: '-0.02em',
          marginBottom: 4,
        }}>
          스코어 랭킹
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
          CAN SLIM 종합점수 기준 상위 50개 종목
        </p>
      </div>

      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '36px 28px 100px 1fr 120px 52px 60px',
          gap: 0,
          padding: '10px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
        }}>
          {['순위', '#', '티커', '종목명', '스코어', '등락률', '섹터'].map((h, i) => (
            <div key={i} style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.07em',
              color: 'var(--text-4)',
              textTransform: 'uppercase',
              textAlign: i === 0 ? 'center' : i >= 5 ? 'right' : 'left',
            }}>
              {h}
            </div>
          ))}
        </div>

        {topItems.map((item, idx) => {
          const sc = scoreColor(item.compositeScore)
          const isHov = hovered === item.securityId
          const barPct = maxScore > 0 ? (item.compositeScore / maxScore) * 100 : 0
          const medal = idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : idx === 2 ? '#CD7F32' : null

          return (
            <div
              key={item.securityId}
              onClick={() => onStockClick(item.securityId)}
              onMouseEnter={() => setHovered(item.securityId)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: 'grid',
                gridTemplateColumns: '36px 28px 100px 1fr 120px 52px 60px',
                gap: 0,
                padding: '10px 20px',
                cursor: 'pointer',
                background: isHov ? 'var(--bg-elevated)' : idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                borderBottom: '1px solid var(--border)',
                transition: 'background 0.1s',
                alignItems: 'center',
              }}
            >
              {/* Rank number */}
              <div style={{
                fontSize: 13,
                fontWeight: 800,
                color: medal ?? 'var(--text-4)',
                fontFamily: 'var(--font-mono)',
                textAlign: 'center',
              }}>
                {idx + 1}
              </div>

              {/* Market rank */}
              <div style={{
                fontSize: 10,
                color: 'var(--text-4)',
                fontFamily: 'var(--font-mono)',
              }}>
                {item.marketRank}
              </div>

              {/* Ticker */}
              <div style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--accent)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.03em',
              }}>
                {item.ticker}
                {item.breakoutToday && (
                  <span style={{
                    fontSize: 9, background: '#16a34a', color: '#fff',
                    borderRadius: 3, padding: '1px 4px', marginLeft: 5,
                  }}>NEW</span>
                )}
              </div>

              {/* Name + bar */}
              <div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-1)',
                  marginBottom: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {item.name}
                </div>
                <div style={{
                  height: 4,
                  background: 'var(--track)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  maxWidth: 200,
                }}>
                  <div style={{
                    height: '100%',
                    width: `${barPct}%`,
                    background: sc,
                    borderRadius: 2,
                    transition: 'width 0.4s',
                  }} />
                </div>
              </div>

              {/* Score */}
              <div style={{
                fontSize: 18,
                fontWeight: 800,
                color: sc,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '-0.02em',
              }}>
                {Math.round(item.compositeScore)}
                <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 3, fontWeight: 400 }}>점</span>
              </div>

              {/* Change rate */}
              <div style={{
                fontSize: 12,
                fontWeight: 700,
                color: changeColor(item.changeRate),
                fontFamily: 'var(--font-mono)',
                textAlign: 'right',
              }}>
                {item.changeRate !== null
                  ? (item.changeRate >= 0 ? '+' : '') + item.changeRate.toFixed(2) + '%'
                  : '—'}
              </div>

              {/* Sector */}
              <div style={{
                fontSize: 10,
                color: 'var(--text-3)',
                textAlign: 'right',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {item.sector ?? '—'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
