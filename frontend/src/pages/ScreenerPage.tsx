import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchScreener } from '../api/client'
import type { ScreenerItem } from '../types'

type ScoreKey = 'cScore' | 'aScore' | 'nScore' | 'sScore' | 'lScore' | 'iScore'
const SCORE_KEYS: ScoreKey[] = ['cScore', 'aScore', 'nScore', 'sScore', 'lScore', 'iScore']

function scoreColor(v: number | null): string {
  if (v === null) return 'transparent'
  if (v >= 85) return 'rgba(72,187,120,0.25)'
  if (v >= 70) return 'rgba(72,187,120,0.12)'
  if (v >= 55) return 'rgba(246,173,85,0.18)'
  if (v >= 40) return 'rgba(237,137,54,0.2)'
  return 'rgba(245,101,101,0.2)'
}

function scoreText(v: number | null): string {
  if (v === null) return 'rgba(255,255,255,0.2)'
  if (v >= 70) return '#68d391'
  if (v >= 55) return '#f6ad55'
  if (v >= 40) return '#ed8936'
  return '#fc8181'
}

function compositeColor(v: number): string {
  if (v >= 85) return '#68d391'
  if (v >= 70) return '#9ae6b4'
  if (v >= 55) return '#f6ad55'
  if (v >= 40) return '#ed8936'
  return '#fc8181'
}

function HeatCell({ value }: { value: number | null }) {
  return (
    <td style={{
      padding: '0 10px',
      background: scoreColor(value),
      color: scoreText(value),
      fontWeight: value !== null ? 600 : 400,
      fontSize: 12,
      textAlign: 'center',
      borderRight: '1px solid #1a202c',
    }}>
      {value !== null ? value.toFixed(1) : '·'}
    </td>
  )
}

export default function ScreenerPage() {
  const [items, setItems] = useState<ScreenerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    fetchScreener('KR', 200)
      .then(setItems)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = query.trim()
    ? items.filter(i =>
        i.ticker.includes(query.trim()) ||
        i.name.toLowerCase().includes(query.trim().toLowerCase()))
    : items

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#4a5568' }}>
      데이터 로딩 중...
    </div>
  )
  if (error) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#fc8181' }}>
      {error}
    </div>
  )

  const topScore = items[0]?.compositeScore ?? 0
  const avgScore = items.length
    ? (items.reduce((s, i) => s + i.compositeScore, 0) / items.length).toFixed(1)
    : '—'

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid #21262d',
        padding: '20px 32px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0d1117',
        backdropFilter: 'blur(8px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.5px' }}>CANSLIM</span>
            <span style={{ fontSize: 18, fontWeight: 300, color: '#58a6ff', marginLeft: 6 }}>Screener</span>
          </div>
          {items[0] && (
            <div style={{ display: 'flex', gap: 16 }}>
              <Chip label="Market" value={items[0].market} />
              <Chip label="Date" value={items[0].scoreDate} />
              <Chip label="Top" value={String(topScore)} color="#68d391" />
              <Chip label="Avg" value={String(avgScore)} />
            </div>
          )}
        </div>
        <input
          placeholder="종목명 / 티커 검색"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{
            background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
            color: '#e6edf3', padding: '6px 12px', fontSize: 13, width: 200,
            outline: 'none',
          }}
        />
      </div>

      {/* Table */}
      <div style={{ padding: '0 32px 40px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 52 }} />
            <col style={{ width: 88 }} />
            <col style={{ width: 'auto' }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 64 }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: '2px solid #21262d' }}>
              {['#', 'TICKER', 'NAME', 'SCORE', 'C', 'A', 'N', 'S', 'L', 'I', 'PCT'].map((h, i) => (
                <th key={h} style={{
                  padding: '10px 10px',
                  textAlign: i <= 1 || i >= 9 ? 'center' : i === 3 ? 'right' : 'left',
                  fontSize: 10, fontWeight: 600, color: '#8b949e',
                  letterSpacing: '0.08em', whiteSpace: 'nowrap',
                  borderRight: i >= 3 && i <= 8 ? '1px solid #1a202c' : 'none',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((item, idx) => {
              const isHovered = hoveredId === item.securityId
              return (
                <tr
                  key={item.securityId}
                  onClick={() => navigate(`/stock/${item.securityId}`)}
                  onMouseEnter={() => setHoveredId(item.securityId)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    cursor: 'pointer',
                    background: isHovered ? '#161b22' : idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                    borderBottom: '1px solid #161b22',
                    transition: 'background 0.1s',
                  }}
                >
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11, color: '#484f58' }}>
                    {item.marketRank}
                  </td>
                  <td style={{
                    padding: '8px 10px', textAlign: 'center',
                    fontWeight: 700, fontSize: 12,
                    color: isHovered ? '#79c0ff' : '#58a6ff',
                    letterSpacing: '0.02em', fontFamily: 'monospace',
                  }}>
                    {item.ticker}
                  </td>
                  <td style={{
                    padding: '8px 10px', fontSize: 13,
                    color: isHovered ? '#e6edf3' : '#c9d1d9',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {item.name}
                  </td>
                  <td style={{
                    padding: '8px 10px', textAlign: 'right',
                    fontSize: 15, fontWeight: 700,
                    color: compositeColor(item.compositeScore),
                  }}>
                    {item.compositeScore.toFixed(2)}
                  </td>
                  {SCORE_KEYS.map(k => <HeatCell key={k} value={item[k]} />)}
                  <td style={{
                    padding: '8px 10px', textAlign: 'center',
                    fontSize: 11, color: '#8b949e',
                  }}>
                    {(item.marketPercentile * 100).toFixed(0)}%
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#484f58' }}>
            검색 결과 없음
          </div>
        )}
      </div>
    </div>
  )
}

function Chip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 10, color: '#484f58', fontWeight: 600, letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: color ?? '#8b949e', fontWeight: 600 }}>
        {value}
      </span>
    </div>
  )
}
