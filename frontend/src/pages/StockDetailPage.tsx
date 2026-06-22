import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { fetchStockScore, fetchStockHistory } from '../api/client'
import type { ScreenerItem, ScoreHistory } from '../types'

type ScoreKey = 'cScore' | 'aScore' | 'nScore' | 'sScore' | 'lScore' | 'iScore'

const FACTORS: { key: ScoreKey; label: string; desc: string; color: string }[] = [
  { key: 'cScore', label: 'C', desc: 'Current Earnings',    color: '#f6ad55' },
  { key: 'aScore', label: 'A', desc: 'Annual Earnings',     color: '#68d391' },
  { key: 'nScore', label: 'N', desc: 'New Products/Highs',  color: '#76e4f7' },
  { key: 'sScore', label: 'S', desc: 'Supply & Demand',     color: '#b794f4' },
  { key: 'lScore', label: 'L', desc: 'Leader or Laggard',   color: '#fc8181' },
  { key: 'iScore', label: 'I', desc: 'Inst. Sponsorship',   color: '#63b3ed' },
]

function scoreGrade(v: number | null): { grade: string; color: string } {
  if (v === null) return { grade: 'N/A', color: '#484f58' }
  if (v >= 85) return { grade: 'A+', color: '#68d391' }
  if (v >= 70) return { grade: 'A',  color: '#9ae6b4' }
  if (v >= 55) return { grade: 'B+', color: '#f6ad55' }
  if (v >= 40) return { grade: 'B',  color: '#ed8936' }
  if (v >= 25) return { grade: 'C',  color: '#fc8181' }
  return { grade: 'D', color: '#f56565' }
}

function FactorCard({
  label, desc, value, color,
}: {
  label: string; desc: string; value: number | null; color: string
}) {
  const pct = value ?? 0
  const { grade, color: gc } = scoreGrade(value)
  return (
    <div style={{
      background: '#161b22', borderRadius: 10, padding: '18px 20px',
      border: '1px solid #21262d', flex: 1, minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <span style={{
            display: 'inline-block', width: 28, height: 28, borderRadius: 6,
            background: color + '22', border: `1px solid ${color}44`,
            textAlign: 'center', lineHeight: '28px',
            fontSize: 13, fontWeight: 800, color,
          }}>{label}</span>
          <div style={{ fontSize: 10, color: '#8b949e', marginTop: 4 }}>{desc}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: value !== null ? color : '#484f58', lineHeight: 1 }}>
            {value !== null ? value.toFixed(1) : '—'}
          </div>
          <div style={{ fontSize: 11, color: gc, fontWeight: 600, marginTop: 2 }}>{grade}</div>
        </div>
      </div>
      {/* mini bar */}
      <div style={{ height: 3, background: '#21262d', borderRadius: 2 }}>
        <div style={{
          height: 3, borderRadius: 2,
          width: `${pct}%`, background: value !== null ? color : 'transparent',
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
      padding: '10px 14px', fontSize: 12,
    }}>
      <div style={{ color: '#8b949e', marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.stroke }}>
          <span>{p.name}</span>
          <span style={{ fontWeight: 600 }}>{p.value?.toFixed(1) ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}

export default function StockDetailPage() {
  const { securityId } = useParams<{ securityId: string }>()
  const navigate = useNavigate()
  const id = Number(securityId)

  const [stock, setStock] = useState<ScreenerItem | null>(null)
  const [history, setHistory] = useState<ScoreHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchStockScore(id), fetchStockHistory(id)])
      .then(([s, h]) => { setStock(s); setHistory([...h].reverse()) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#4a5568' }}>
      로딩 중...
    </div>
  )
  if (error) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: 12 }}>
      <div style={{ color: '#fc8181', fontSize: 15 }}>데이터를 불러올 수 없습니다</div>
      <div style={{ color: '#484f58', fontSize: 12 }}>{error}</div>
      <button onClick={() => navigate('/')} style={{ marginTop: 8, color: '#58a6ff', fontSize: 13, cursor: 'pointer' }}>
        ← 목록으로
      </button>
    </div>
  )
  if (!stock) return null

  const composite = stock.compositeScore
  const cColor = composite >= 85 ? '#68d391' : composite >= 70 ? '#9ae6b4' : composite >= 55 ? '#f6ad55' : '#fc8181'

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117' }}>
      {/* Top bar */}
      <div style={{
        borderBottom: '1px solid #21262d', padding: '14px 32px',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, zIndex: 10, background: '#0d1117',
      }}>
        <button
          onClick={() => navigate('/')}
          style={{ color: '#8b949e', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          ← 스크리너
        </button>
        <span style={{ color: '#21262d' }}>|</span>
        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#58a6ff', fontSize: 14 }}>{stock.ticker}</span>
        <span style={{ color: '#c9d1d9', fontSize: 14 }}>{stock.name}</span>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 32px 60px' }}>
        {/* Hero */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          marginBottom: 32, paddingBottom: 24, borderBottom: '1px solid #21262d',
        }}>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6, fontWeight: 600, letterSpacing: '0.08em' }}>
              {stock.market} · {stock.scoreDate}
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-1px', color: '#e6edf3' }}>
              {stock.name}
            </div>
            <div style={{ fontSize: 16, fontFamily: 'monospace', color: '#58a6ff', marginTop: 4 }}>
              {stock.ticker}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2, fontWeight: 600 }}>COMPOSITE SCORE</div>
            <div style={{ fontSize: 56, fontWeight: 900, color: cColor, lineHeight: 1, letterSpacing: '-2px' }}>
              {composite.toFixed(2)}
            </div>
            <div style={{ fontSize: 12, color: '#8b949e', marginTop: 4 }}>
              Rank <span style={{ color: '#e6edf3', fontWeight: 600 }}>{stock.marketRank}</span>
              {' · '}
              Top <span style={{ color: '#e6edf3', fontWeight: 600 }}>
                {(100 - stock.marketPercentile * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* Factor cards */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
          {FACTORS.map(f => (
            <FactorCard key={f.key} label={f.label} desc={f.desc} value={stock[f.key]} color={f.color} />
          ))}
        </div>

        {/* History chart */}
        {history.length > 1 && (
          <div style={{
            background: '#161b22', borderRadius: 10, padding: '24px 24px 16px',
            border: '1px solid #21262d',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#8b949e', marginBottom: 20, letterSpacing: '0.05em' }}>
              SCORE HISTORY
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={history} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  {FACTORS.map(f => (
                    <linearGradient key={f.key} id={`grad-${f.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={f.color} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={f.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                <XAxis
                  dataKey="scoreDate"
                  tick={{ fontSize: 10, fill: '#8b949e' }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: '#8b949e' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                  formatter={(v) => <span style={{ color: '#8b949e' }}>{v}</span>}
                />
                {FACTORS.map(f => (
                  <Area
                    key={f.key}
                    type="monotone"
                    dataKey={f.key}
                    name={f.label}
                    stroke={f.color}
                    fill={`url(#grad-${f.key})`}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
