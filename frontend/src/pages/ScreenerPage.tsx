import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchScreener } from '../api/client'
import MacroTicker from '../components/MacroTicker'
import type { ScreenerItem } from '../types'

type ScoreKey = 'cScore' | 'aScore' | 'nScore' | 'sScore' | 'lScore' | 'iScore' | 'mScore'
const SCORE_KEYS: ScoreKey[] = ['cScore', 'aScore', 'nScore', 'sScore', 'lScore', 'iScore', 'mScore']
type FlowUnit = '억원' | '백만원'
type SortDir = 'desc' | 'asc'
type SortKey = keyof Pick<ScreenerItem,
  'compositeScore' | 'cScore' | 'aScore' | 'nScore' | 'sScore' | 'lScore' | 'iScore' | 'mScore' |
  'closePrice' | 'changeRate' | 'weekHigh52' | 'turnover' | 'volume' | 'foreignNetBuy10d' | 'instNetBuy10d' | 'marketPercentile' | 'marketCap'
>

// ── color helpers ──────────────────────────────────────────────
function scoreColor(v: number | null): string {
  if (v === null) return 'transparent'
  if (v >= 85) return 'rgba(72,187,120,0.25)'
  if (v >= 70) return 'rgba(72,187,120,0.12)'
  if (v >= 55) return 'rgba(246,173,85,0.18)'
  if (v >= 40) return 'rgba(237,137,54,0.2)'
  return 'rgba(245,101,101,0.2)'
}
function scoreText(v: number | null): string {
  if (v === null) return 'rgba(255,255,255,0.15)'
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
function updownColor(v: number | null): string {
  if (v === null) return 'rgba(255,255,255,0.2)'
  if (v > 0) return '#68d391'
  if (v < 0) return '#fc8181'
  return '#8b949e'
}

// ── format helpers ─────────────────────────────────────────────
function fmtPrice(v: number | null): string {
  if (v === null) return '·'
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 })
}
function fmtRate(v: number | null): string {
  if (v === null) return '·'
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%'
}
function fmtHigh52(v: number | null): string {
  if (v === null) return '·'
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 })
}
function fmtFlow(v: number | null, unit: FlowUnit): string {
  if (v === null) return '·'
  if (unit === '억원') {
    const b = v / 100_000_000
    return (b > 0 ? '+' : '') + b.toFixed(1)
  } else {
    const m = v / 1_000_000
    return (m > 0 ? '+' : '') + m.toFixed(0)
  }
}
function fmtVolume(v: number | null): string {
  if (v === null) return '·'
  if (v >= 10_000_000) return (v / 10_000_000).toFixed(1) + '천만'
  if (v >= 1_000_000) return (v / 10_000).toFixed(0) + '만'
  if (v >= 10_000) return (v / 10_000).toFixed(1) + '만'
  return v.toLocaleString()
}
function fmtTurnover(v: number | null): string {
  if (v === null) return '·'
  const b = v / 100_000_000
  if (b >= 1000) return (b / 1000).toFixed(1) + '천억'
  return b.toFixed(0) + '억'
}
function fmtMarketCap(v: number | null): string {
  if (v === null) return '·'
  const b = v / 100_000_000
  if (b >= 1_000_000) return (b / 1_000_000).toFixed(1) + '조'
  if (b >= 10_000) return (b / 10_000).toFixed(1) + '조'
  if (b >= 1_000) return (b / 1_000).toFixed(0) + '천억'
  return b.toFixed(0) + '억'
}

// ── sub-components ─────────────────────────────────────────────
function HeatCell({ value }: { value: number | null }) {
  return (
    <td style={{
      padding: '0 6px', background: scoreColor(value),
      color: scoreText(value), fontWeight: value !== null ? 600 : 400,
      fontSize: 11, textAlign: 'center', borderRight: '1px solid #1a202c',
    }}>
      {value !== null ? value.toFixed(1) : '·'}
    </td>
  )
}

function Chip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 10, color: '#484f58', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 12, color: color ?? '#8b949e', fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function PageBtn({ label, onClick, disabled, active }: {
  label: string; onClick: () => void; disabled?: boolean; active?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      minWidth: 30, height: 26, padding: '0 7px',
      background: active ? '#1f6feb' : disabled ? 'transparent' : '#161b22',
      border: `1px solid ${active ? '#1f6feb' : '#30363d'}`,
      borderRadius: 4, color: disabled ? '#484f58' : active ? '#fff' : '#8b949e',
      fontSize: 11, cursor: disabled ? 'default' : 'pointer', fontWeight: active ? 700 : 400,
    }}>
      {label}
    </button>
  )
}

// ── main component ─────────────────────────────────────────────
export default function ScreenerPage() {
  const [items, setItems] = useState<ScreenerItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(30)
  const [flowUnit, setFlowUnit] = useState<FlowUnit>('억원')
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('compositeScore')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    fetchScreener('KR', page, size, query.trim())
      .then(data => { setItems(data.items); setTotal(data.total) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [page, size, query])

  const handleQuery = (v: string) => { setQuery(v); setPage(0) }
  const handleSize = (v: number) => { setSize(v); setPage(0) }
  const totalPages = Math.ceil(total / size)

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sortedItems = [...items].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity
    const bv = b[sortKey] ?? -Infinity
    return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number)
  })

  const inputStyle: React.CSSProperties = {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
    color: '#e6edf3', padding: '6px 10px', fontSize: 13, outline: 'none',
  }

  if (error) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#fc8181' }}>
      {error}
    </div>
  )

  const topScore = items[0]?.compositeScore ?? 0
  const avgScore = items.length
    ? (items.reduce((s, i) => s + i.compositeScore, 0) / items.length).toFixed(1) : '—'

  // flow column header label with unit
  const flowLabel = (label: string) => `${label}(${flowUnit === '억원' ? '억' : '백만'})`

  const HEADERS: { h: string; align: string; w: number; sort?: SortKey; purple?: boolean; cyan?: boolean }[] = [
    { h: '#', align: 'center', w: 40 },
    { h: 'TICKER', align: 'center', w: 76 },
    { h: 'NAME', align: 'left', w: 130 },
    { h: '섹터', align: 'left', w: 72 },
    { h: 'SCORE', align: 'right', w: 68, sort: 'compositeScore' },
    { h: '분기실적', align: 'center', w: 56, sort: 'cScore' },
    { h: '연간성장', align: 'center', w: 56, sort: 'aScore' },
    { h: '신고가N', align: 'center', w: 52, sort: 'nScore' },
    { h: '수급강도', align: 'center', w: 56, sort: 'sScore' },
    { h: '상대강도', align: 'center', w: 56, sort: 'lScore' },
    { h: '기관수급', align: 'center', w: 56, sort: 'iScore' },
    { h: '시장M', align: 'center', w: 48, sort: 'mScore', purple: true },
    { h: '종가', align: 'right', w: 76, sort: 'closePrice' },
    { h: '등락률', align: 'right', w: 60, sort: 'changeRate' },
    { h: '52주신고가', align: 'right', w: 70, sort: 'weekHigh52' },
    { h: '시가총액', align: 'right', w: 76, sort: 'marketCap' },
    { h: '거래대금', align: 'right', w: 68, sort: 'turnover' },
    { h: '거래량', align: 'right', w: 64, sort: 'volume' },
    { h: flowLabel('외국인'), align: 'right', w: 76, sort: 'foreignNetBuy10d', cyan: true },
    { h: flowLabel('기관'), align: 'right', w: 68, sort: 'instNetBuy10d', cyan: true },
    { h: 'PCT', align: 'center', w: 48, sort: 'marketPercentile' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117' }}>
      <MacroTicker />

      {/* Header */}
      <div style={{
        borderBottom: '1px solid #21262d', padding: '12px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10, background: '#0d1117',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <span style={{ fontSize: 16, fontWeight: 700 }}>종목</span>
            <span style={{ fontSize: 16, fontWeight: 300, color: '#58a6ff', marginLeft: 5 }}>레이더</span>
          </div>
          {items[0] && (
            <div style={{ display: 'flex', gap: 12 }}>
              <Chip label="Date" value={items[0].scoreDate} />
              <Chip label="Top" value={String(topScore)} color="#68d391" />
              <Chip label="Avg" value={String(avgScore)} />
              <Chip label="종목" value={`${total}`} />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* 수급 단위 토글 */}
          <div style={{ display: 'flex', border: '1px solid #30363d', borderRadius: 6, overflow: 'hidden' }}>
            {(['억원', '백만원'] as FlowUnit[]).map(u => (
              <button key={u} onClick={() => setFlowUnit(u)} style={{
                padding: '5px 10px', fontSize: 11, fontWeight: 600,
                background: flowUnit === u ? '#1f6feb' : '#161b22',
                color: flowUnit === u ? '#fff' : '#8b949e',
                border: 'none', cursor: 'pointer',
              }}>{u}</button>
            ))}
          </div>
          <select value={size} onChange={e => handleSize(Number(e.target.value))}
            style={{ ...inputStyle, width: 70, cursor: 'pointer' }}>
            {[30, 50, 100].map(n => <option key={n} value={n}>{n}개</option>)}
          </select>
          <input placeholder="종목명 / 티커 검색" value={query}
            onChange={e => handleQuery(e.target.value)}
            style={{ ...inputStyle, width: 190 }} />
        </div>
      </div>

      {/* Table */}
      <div style={{ padding: '0 20px 40px', overflowX: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#4a5568', fontSize: 14 }}>
            데이터 로딩 중...
          </div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 1380 }}>
              <colgroup>
                {HEADERS.map(h => <col key={h.h} style={{ width: h.w }} />)}
              </colgroup>
              <thead>
                <tr style={{ borderBottom: '2px solid #21262d' }}>
                  {HEADERS.map(({ h, align, purple, cyan, sort }) => {
                    const isActive = sort && sortKey === sort
                    const arrow = isActive ? (sortDir === 'desc' ? ' ▼' : ' ▲') : sort ? ' ⇅' : ''
                    return (
                      <th key={h} onClick={sort ? () => handleSort(sort) : undefined} style={{
                        padding: '8px 6px', textAlign: align as any,
                        fontSize: 10, fontWeight: 600,
                        color: isActive ? '#e6edf3' : purple ? '#b794f4' : cyan ? '#76e4f7' : '#8b949e',
                        letterSpacing: '0.06em', whiteSpace: 'nowrap',
                        cursor: sort ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}>
                        {h}{arrow}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item, idx) => {
                  const isHovered = hoveredId === item.securityId
                  return (
                    <tr key={item.securityId}
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
                      <td style={{ padding: '6px 6px', textAlign: 'center', fontSize: 11, color: '#484f58' }}>
                        {item.marketRank}
                      </td>
                      <td style={{ padding: '6px 6px', textAlign: 'center', fontWeight: 700, fontSize: 12, fontFamily: 'monospace', color: isHovered ? '#79c0ff' : '#58a6ff' }}>
                        {item.ticker}
                      </td>
                      <td style={{ padding: '6px 6px', fontSize: 12, color: isHovered ? '#e6edf3' : '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </td>
                      <td style={{ padding: '6px 6px', fontSize: 10, color: '#58a6ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.8 }}>
                        {item.sector ?? '·'}
                      </td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: compositeColor(item.compositeScore) }}>
                        {item.compositeScore.toFixed(2)}
                      </td>
                      {SCORE_KEYS.map(k => <HeatCell key={k} value={item[k]} />)}
                      {/* 종가 */}
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontSize: 11, color: '#c9d1d9', fontFamily: 'monospace' }}>
                        {fmtPrice(item.closePrice)}
                      </td>
                      {/* 등락률 */}
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: updownColor(item.changeRate) }}>
                        {fmtRate(item.changeRate)}
                      </td>
                      {/* 52주 신고가 */}
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontSize: 11, color: item.weekHigh52 !== null && item.closePrice !== null && item.weekHigh52 <= item.closePrice * 1.02 ? '#68d391' : '#8b949e' }}>
                        {fmtHigh52(item.weekHigh52)}
                      </td>
                      {/* 시가총액 */}
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontSize: 11, color: '#8b949e' }}>
                        {fmtMarketCap(item.marketCap)}
                      </td>
                      {/* 거래대금 */}
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontSize: 11, color: '#8b949e' }}>
                        {fmtTurnover(item.turnover)}
                      </td>
                      {/* 거래량 */}
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontSize: 11, color: '#8b949e' }}>
                        {fmtVolume(item.volume)}
                      </td>
                      {/* 외국인 */}
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: updownColor(item.foreignNetBuy10d) }}>
                        {fmtFlow(item.foreignNetBuy10d, flowUnit)}
                      </td>
                      {/* 기관 */}
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: updownColor(item.instNetBuy10d) }}>
                        {fmtFlow(item.instNetBuy10d, flowUnit)}
                      </td>
                      {/* PCT */}
                      <td style={{ padding: '6px 6px', textAlign: 'center', fontSize: 11, color: '#8b949e' }}>
                        {(item.marketPercentile * 100).toFixed(0)}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {items.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#484f58' }}>
                검색 결과 없음
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, padding: '20px 0' }}>
                <PageBtn label="◀◀" onClick={() => setPage(0)} disabled={page === 0} />
                <PageBtn label="◀" onClick={() => setPage(p => p - 1)} disabled={page === 0} />
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  const start = Math.max(0, Math.min(page - 3, totalPages - 7))
                  const p = start + i
                  return <PageBtn key={p} label={String(p + 1)} onClick={() => setPage(p)} active={p === page} />
                })}
                <PageBtn label="▶" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} />
                <PageBtn label="▶▶" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} />
                <span style={{ fontSize: 11, color: '#484f58', marginLeft: 6 }}>
                  {page + 1} / {totalPages}p ({total}종목)
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
