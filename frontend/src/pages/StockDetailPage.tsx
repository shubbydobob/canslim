import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area,
} from 'recharts'
import { fetchStockScore, fetchStockHistory, fetchStockFinancials } from '../api/client'
import TradingViewChart from '../components/TradingViewChart'
import PriceChart from '../components/PriceChart'
import type { ScreenerItem, ScoreHistory, FinancialRecord } from '../types'

type ScoreKey = 'cScore' | 'aScore' | 'nScore' | 'sScore' | 'lScore' | 'iScore' | 'mScore'

const FACTORS: { key: ScoreKey; label: string; desc: string; color: string }[] = [
  { key: 'cScore', label: 'C', desc: '분기실적',  color: '#f6ad55' },
  { key: 'aScore', label: 'A', desc: '연간성장',  color: '#68d391' },
  { key: 'nScore', label: 'N', desc: '신고가',    color: '#76e4f7' },
  { key: 'sScore', label: 'S', desc: '수급강도',  color: '#b794f4' },
  { key: 'lScore', label: 'L', desc: '상대강도',  color: '#fc8181' },
  { key: 'iScore', label: 'I', desc: '기관수급',  color: '#63b3ed' },
  { key: 'mScore', label: 'M', desc: '시장방향',  color: '#d6bcfa' },
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

function fmtPrice(v: number | null) {
  if (v === null) return '—'
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 })
}
function fmtRate(v: number | null) {
  if (v === null) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%'
}
function fmtAmt(v: number | null) {
  if (v === null) return '—'
  const b = v / 100_000_000
  if (b >= 1000) return (b / 1000).toFixed(1) + '천억'
  return b.toFixed(0) + '억'
}
function fmtVol(v: number | null) {
  if (v === null) return '—'
  if (v >= 10_000_000) return (v / 10_000_000).toFixed(1) + '천만주'
  return (v / 10_000).toFixed(0) + '만주'
}
function fmtFinAmt(v: number | null) {
  if (v === null) return null
  const b = v / 100_000_000
  return Math.round(b)
}

function FactorCard({ label, desc, value, color }: {
  label: string; desc: string; value: number | null; color: string
}) {
  const pct = value ?? 0
  const { grade, color: gc } = scoreGrade(value)
  return (
    <div style={{
      background: '#161b22', borderRadius: 10, padding: '16px 18px',
      border: '1px solid #21262d', flex: 1, minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <span style={{
            display: 'inline-block', width: 26, height: 26, borderRadius: 6,
            background: color + '22', border: `1px solid ${color}44`,
            textAlign: 'center', lineHeight: '26px', fontSize: 12, fontWeight: 800, color,
          }}>{label}</span>
          <div style={{ fontSize: 10, color: '#8b949e', marginTop: 4 }}>{desc}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: value !== null ? color : '#484f58', lineHeight: 1 }}>
            {value !== null ? value.toFixed(1) : '—'}
          </div>
          <div style={{ fontSize: 11, color: gc, fontWeight: 600, marginTop: 2 }}>{grade}</div>
        </div>
      </div>
      <div style={{ height: 3, background: '#21262d', borderRadius: 2 }}>
        <div style={{ height: 3, borderRadius: 2, width: `${pct}%`, background: value !== null ? color : 'transparent', transition: 'width 0.5s' }} />
      </div>
    </div>
  )
}

const ScoreTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: '#8b949e', marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.stroke || p.fill }}>
          <span>{p.name}</span>
          <span style={{ fontWeight: 600 }}>{p.value?.toFixed ? p.value.toFixed(1) : p.value ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}

const FinTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: '#8b949e', marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.fill }}>
          <span>{p.name}</span>
          <span style={{ fontWeight: 600 }}>{p.value != null ? p.value.toLocaleString() + '억' : '—'}</span>
        </div>
      ))}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: '#8b949e', letterSpacing: '0.08em', marginBottom: 16 }}>
      {children}
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#161b22', borderRadius: 10, padding: '20px 22px', border: '1px solid #21262d', ...style }}>
      {children}
    </div>
  )
}

export default function StockDetailPage() {
  const { securityId } = useParams<{ securityId: string }>()
  const navigate = useNavigate()
  const id = Number(securityId)

  const [stock, setStock] = useState<ScreenerItem | null>(null)
  const [history, setHistory] = useState<ScoreHistory[]>([])
  const [financials, setFinancials] = useState<FinancialRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chartTab, setChartTab] = useState<'tv' | 'own'>('tv')

  useEffect(() => {
    Promise.all([fetchStockScore(id), fetchStockHistory(id), fetchStockFinancials(id)])
      .then(([s, h, f]) => {
        setStock(s)
        setHistory([...h].reverse())
        setFinancials(f)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#4a5568' }}>
      로딩 중...
    </div>
  )
  if (error || !stock) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: 12 }}>
      <div style={{ color: '#fc8181' }}>{error ?? '데이터 없음'}</div>
      <button onClick={() => navigate('/')} style={{ color: '#58a6ff', cursor: 'pointer' }}>← 목록으로</button>
    </div>
  )

  const composite = stock.compositeScore
  const cColor = composite >= 85 ? '#68d391' : composite >= 70 ? '#9ae6b4' : composite >= 55 ? '#f6ad55' : '#fc8181'

  // 연간 재무 데이터 (차트용)
  const annualFin = financials
    .filter(f => f.periodType === 'ANNUAL')
    .slice(0, 6)
    .reverse()
    .map(f => ({
      label: `${f.fiscalYear}`,
      매출액: fmtFinAmt(f.revenue),
      영업이익: fmtFinAmt(f.operatingIncome),
      순이익: fmtFinAmt(f.netIncome),
    }))

  const hasFinancials = annualFin.length > 0

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117' }}>
      {/* Top bar */}
      <div style={{
        borderBottom: '1px solid #21262d', padding: '12px 28px',
        display: 'flex', alignItems: 'center', gap: 14,
        position: 'sticky', top: 0, zIndex: 10, background: '#0d1117',
      }}>
        <button onClick={() => navigate('/')}
          style={{ color: '#8b949e', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          ← 종목 레이더
        </button>
        <span style={{ color: '#30363d' }}>|</span>
        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#58a6ff', fontSize: 14 }}>{stock.ticker}</span>
        <span style={{ color: '#c9d1d9', fontSize: 14 }}>{stock.name}</span>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 28px 60px' }}>

        {/* ── Hero ── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #21262d',
        }}>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 5, fontWeight: 600, letterSpacing: '0.08em' }}>
              {stock.market} · {stock.scoreDate}
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-1px', color: '#e6edf3' }}>{stock.name}</div>
            <div style={{ fontSize: 14, fontFamily: 'monospace', color: '#58a6ff', marginTop: 3 }}>{stock.ticker}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2, fontWeight: 600 }}>COMPOSITE SCORE</div>
            <div style={{ fontSize: 50, fontWeight: 900, color: cColor, lineHeight: 1, letterSpacing: '-2px' }}>
              {composite.toFixed(2)}
            </div>
            <div style={{ fontSize: 12, color: '#8b949e', marginTop: 4 }}>
              Rank <span style={{ color: '#e6edf3', fontWeight: 600 }}>{stock.marketRank}</span>
              {' · '}Top <span style={{ color: '#e6edf3', fontWeight: 600 }}>{(100 - stock.marketPercentile * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* ── 가격 정보 바 ── */}
        <div style={{
          display: 'flex', gap: 0, marginBottom: 20,
          background: '#161b22', borderRadius: 10, border: '1px solid #21262d',
          overflow: 'hidden',
        }}>
          {[
            { label: '현재가', value: fmtPrice(stock.closePrice), mono: true },
            { label: '등락률', value: fmtRate(stock.changeRate), color: stock.changeRate !== null ? (stock.changeRate > 0 ? '#68d391' : stock.changeRate < 0 ? '#fc8181' : '#8b949e') : '#8b949e' },
            { label: '52주 신고가', value: fmtPrice(stock.weekHigh52) },
            { label: '거래대금', value: fmtAmt(stock.turnover) },
            { label: '거래량', value: fmtVol(stock.volume) },
          ].map(({ label, value, color, mono }, i) => (
            <div key={label} style={{
              flex: 1, padding: '14px 18px',
              borderRight: i < 4 ? '1px solid #21262d' : 'none',
            }}>
              <div style={{ fontSize: 10, color: '#484f58', fontWeight: 600, marginBottom: 4 }}>{label}</div>
              <div style={{
                fontSize: 15, fontWeight: 700,
                color: color ?? '#c9d1d9',
                fontFamily: mono ? 'monospace' : 'inherit',
              }}>{value}</div>
            </div>
          ))}
        </div>

        {/* ── 팩터 카드 ── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
          {FACTORS.map(f => (
            <FactorCard key={f.key} label={f.label} desc={f.desc} value={stock[f.key]} color={f.color} />
          ))}
        </div>

        {/* ── 주가 차트 ── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <SectionTitle>주가 차트</SectionTitle>
            <div style={{ display: 'flex', border: '1px solid #30363d', borderRadius: 6, overflow: 'hidden' }}>
              {([['tv', 'TradingView'], ['own', '직접 차트']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setChartTab(key)} style={{
                  padding: '4px 12px', fontSize: 11, fontWeight: 600,
                  background: chartTab === key ? '#1f6feb' : '#161b22',
                  color: chartTab === key ? '#fff' : '#8b949e',
                  border: 'none', cursor: 'pointer',
                }}>{label}</button>
              ))}
            </div>
          </div>
          {chartTab === 'tv'
            ? <TradingViewChart ticker={stock.ticker} height={480} />
            : <PriceChart securityId={id} height={480} />}
        </div>

        {/* ── 연간 실적 ── */}
        {hasFinancials && (
          <Card style={{ marginBottom: 24 }}>
            <SectionTitle>연간 실적 (억원)</SectionTitle>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={annualFin} margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8b949e' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#8b949e' }} tickLine={false} axisLine={false}
                  tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v)} />
                <Tooltip content={<FinTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
                  formatter={v => <span style={{ color: '#8b949e' }}>{v}</span>} />
                <Bar dataKey="매출액" fill="#58a6ff" radius={[3, 3, 0, 0]} maxBarSize={36} />
                <Bar dataKey="영업이익" fill="#68d391" radius={[3, 3, 0, 0]} maxBarSize={36} />
                <Bar dataKey="순이익" fill="#f6ad55" radius={[3, 3, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* ── 스코어 히스토리 ── */}
        {history.length > 1 && (
          <Card>
            <SectionTitle>스코어 히스토리</SectionTitle>
            <ResponsiveContainer width="100%" height={240}>
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
                <XAxis dataKey="scoreDate" tick={{ fontSize: 10, fill: '#8b949e' }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#8b949e' }} tickLine={false} axisLine={false} />
                <Tooltip content={<ScoreTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                  formatter={v => <span style={{ color: '#8b949e' }}>{v}</span>} />
                {FACTORS.map(f => (
                  <Area key={f.key} type="monotone" dataKey={f.key} name={f.label}
                    stroke={f.color} fill={`url(#grad-${f.key})`}
                    strokeWidth={1.5} dot={false} connectNulls />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        )}
      </div>
    </div>
  )
}
