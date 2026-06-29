import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchScreener, fetchSectors } from '../api/client'
import { isPremium } from '../api/auth'
import MacroTicker from '../components/MacroTicker'
import type { ScreenerItem } from '../types'
import { fmtPrice, fmtRate, fmtMarketCap, fmtAmt, fmtVolume, fmtHigh52pct } from '../utils/format'

// ── types ──────────────────────────────────────────────────────
type ViewTab = 'overview' | 'technical' | 'flow'
type FlowUnit = '억원' | '백만원'
type SortDir = 'desc' | 'asc'
type SortKey = keyof Pick<ScreenerItem,
  'compositeScore' | 'cScore' | 'aScore' | 'nScore' | 'sScore' | 'lScore' | 'iScore' | 'mScore' |
  'closePrice' | 'changeRate' | 'weekHigh52' | 'turnover' | 'volume' |
  'foreignNetBuy10d' | 'instNetBuy10d' | 'marketPercentile' | 'marketCap'
>

// ── color helpers ──────────────────────────────────────────────
const scoreColor = (v: number | null) => {
  if (v === null) return 'transparent'
  if (v >= 85) return 'rgba(74,222,128,0.18)'
  if (v >= 70) return 'rgba(74,222,128,0.09)'
  if (v >= 55) return 'rgba(250,189,68,0.15)'
  if (v >= 40) return 'rgba(249,115,22,0.18)'
  return 'rgba(248,113,113,0.15)'
}
const scoreText = (v: number | null) => {
  if (v === null) return 'var(--text-4)'
  if (v >= 70) return '#4ade80'
  if (v >= 55) return '#fabd44'
  if (v >= 40) return '#f97316'
  return '#f87171'
}
const compositeGrade = (v: number) => {
  if (v >= 85) return { color: '#4ade80', label: 'A+' }
  if (v >= 75) return { color: '#86efac', label: 'A' }
  if (v >= 65) return { color: '#fabd44', label: 'B+' }
  if (v >= 55) return { color: '#fbbf24', label: 'B' }
  if (v >= 45) return { color: '#f97316', label: 'C' }
  return { color: '#f87171', label: 'D' }
}
const changeColor = (v: number | null) => {
  if (v === null) return '#4b5563'
  if (v > 0) return '#4ade80'
  if (v < 0) return '#f87171'
  return '#6b7280'
}

// ── format helpers ─────────────────────────────────────────────
const fmtFlow = (v: number | null, unit: FlowUnit) => {
  if (v === null) return '—'
  if (unit === '억원') return (v > 0 ? '+' : '') + (v / 1e8).toFixed(1)
  return (v > 0 ? '+' : '') + (v / 1e6).toFixed(0)
}

// ── sub-components ─────────────────────────────────────────────
function ScoreCell({ value }: { value: number | null }) {
  return (
    <td style={{
      padding: '0 5px', textAlign: 'center',
      background: scoreColor(value), color: scoreText(value),
      fontWeight: value !== null ? 600 : 400, fontSize: 11,
      borderRight: '1px solid var(--score-sep)',
    }}>
      {value !== null ? value.toFixed(1) : <span style={{ color: 'var(--text-4)' }}>·</span>}
    </td>
  )
}

function SortTh({ label, sortKey: sk, current, dir, onSort, align = 'right', style = {} }: {
  label: string; sortKey?: SortKey; current: SortKey; dir: SortDir
  onSort: (k: SortKey) => void; align?: React.CSSProperties['textAlign']; style?: React.CSSProperties
}) {
  const active = sk && current === sk
  return (
    <th
      onClick={sk ? () => onSort(sk) : undefined}
      style={{
        padding: '7px 6px', textAlign: align, fontSize: 10, fontWeight: 600,
        color: active ? 'var(--text-1)' : 'var(--text-3)', letterSpacing: '0.05em',
        cursor: sk ? 'pointer' : 'default', userSelect: 'none',
        whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-nav)', ...style,
      }}
    >
      {label}
      {sk && <span style={{ marginLeft: 2, opacity: active ? 1 : 0.3, fontSize: 9 }}>
        {active ? (dir === 'desc' ? '▼' : '▲') : '⇅'}
      </span>}
    </th>
  )
}

// ── 지표 안내 팝업 ─────────────────────────────────────────────
const GUIDE_KEY = 'score_guide_hidden_until'

const FACTORS = [
  { num: 1, name: '현재 분기 실적', desc: '최근 분기 EPS가 전년 동기 대비 크게 증가한 종목을 선별합니다. 일시적 이익이 아닌 핵심 사업에서의 실적 개선이 기준입니다.' },
  { num: 2, name: '연간 순이익 성장', desc: '최근 3개년 연평균 순이익 성장률을 측정합니다. 일관된 복리 성장을 보여주는 기업이 높은 점수를 받습니다.' },
  { num: 3, name: '신고가 / 신성장 동력', desc: '52주 신고가 대비 근접도와 신제품·신사업 모멘텀을 반영합니다. 박스권 돌파 여부가 핵심 신호입니다.' },
  { num: 4, name: '수요·공급 (수급)', desc: '주가 상승 시 거래량 증가, 하락 시 거래량 감소 패턴을 분석합니다. 기관·외인의 집중 매수 여부도 반영합니다.' },
  { num: 5, name: '업종 선도주 여부', desc: '동종 업종 내 상대강도 순위를 측정합니다. 상위 10~15%의 선도주에 집중하고 후발주는 배제합니다.' },
  { num: 6, name: '기관 투자자 참여', desc: '외국인·기관의 최근 10거래일 순매수 강도를 반영합니다. 스마트머니의 방향성이 중요한 선행 지표입니다.' },
  { num: 7, name: '시장 방향성', desc: '코스피·코스닥 전반의 추세와 지수 건전도를 평가합니다. 시장이 약세일 때는 우량주도 하락하므로 가장 중요한 필터입니다.' },
]

function GuidePopup({ onClose }: { onClose: (hide24h: boolean) => void }) {
  const [hide24h, setHide24h] = useState(false)
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    }} onClick={() => onClose(hide24h)}>
      <div style={{
        background: 'var(--bg-nav)', border: '1px solid var(--border)', borderRadius: 10,
        width: '90%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto',
        padding: '28px 28px 20px', boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
      }} onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
              성장주 7대 핵심지표 안내
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              각 지표는 0~100점으로 환산되며 가중 합산하여 종합점수를 산출합니다
            </div>
          </div>
          <button onClick={() => onClose(hide24h)} style={{
            background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer',
            fontSize: 18, padding: '0 0 0 12px', lineHeight: 1,
          }}>✕</button>
        </div>

        {/* 지표 목록 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FACTORS.map(f => (
            <div key={f.num} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start',
              padding: '10px 12px', borderRadius: 6,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                background: '#1f6feb22', border: '1px solid #1f6feb55',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800, color: '#58a6ff',
              }}>{f.num}</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>
                  {f.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 하단 */}
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 11, color: 'var(--text-3)' }}>
            <input type="checkbox" checked={hide24h} onChange={e => setHide24h(e.target.checked)}
              style={{ width: 13, height: 13, accentColor: '#1f6feb', cursor: 'pointer' }} />
            24시간 보지 않기
          </label>
          <button onClick={() => onClose(hide24h)} style={{
            background: '#1f6feb', border: 'none', borderRadius: 6,
            color: '#fff', fontSize: 12, fontWeight: 600,
            padding: '7px 20px', cursor: 'pointer',
          }}>확인</button>
        </div>
      </div>
    </div>
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
  const [sector, setSector] = useState('')
  const [capRange, setCapRange] = useState<'all' | 'large' | 'mid' | 'small'>('all')
  const [sectors, setSectors] = useState<string[]>([])
  const [viewTab, setViewTab] = useState<ViewTab>('overview')
  const [minScore, setMinScore] = useState(0)
  const [watchlist, setWatchlist] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem('screener_watchlist')
      return raw ? new Set<number>(JSON.parse(raw)) : new Set<number>()
    } catch { return new Set<number>() }
  })
  const [showWatchOnly, setShowWatchOnly] = useState(false)
  const [showBreakoutOnly, setShowBreakoutOnly] = useState(false)
  const [showPremiumModal, setShowPremiumModal] = useState<'watchlist' | 'pdf' | null>(null)
  const [showGuide, setShowGuide] = useState(() => {
    const until = localStorage.getItem(GUIDE_KEY)
    return !until || Date.now() > parseInt(until)
  })
  const [mainTab, setMainTab] = useState<'screener' | 'market'>('screener')
  const [visitCount, setVisitCount] = useState<number | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('canslim_theme') as 'dark' | 'light') ?? 'dark'
  )
  const [histTab, setHistTab] = useState<'KOSPI' | 'KOSDAQ'>('KOSPI')
  const [marketStates, setMarketStates] = useState<Array<{
    market: string; marketPhase?: string; trendDirection?: string; stateDate?: string
    indexClose?: number; ma50d?: number; ma200d?: number; distributionDayCount?: number
  }>>([])
  const [marketHistory, setMarketHistory] = useState<Record<string, Array<{
    stateDate: string; marketPhase: string; trendDirection: string
    indexClose: number; ma50d: number; ma200d: number
  }>>>({})
  const closeGuide = (hide24h: boolean) => {
    if (hide24h) localStorage.setItem(GUIDE_KEY, String(Date.now() + 24 * 60 * 60 * 1000))
    setShowGuide(false)
  }
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  const CAP_PARAMS: Record<string, { minCap?: number; maxCap?: number }> = {
    all:   {},
    large: { minCap: 1_000_000_000_000 },
    mid:   { minCap: 200_000_000_000, maxCap: 1_000_000_000_000 },
    small: { maxCap: 200_000_000_000 },
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  useEffect(() => {
    fetch('/api/stats/visit', { method: 'POST' })
      .then(r => r.json())
      .then(d => setVisitCount(d.total))
      .catch(() => {})
  }, [])
  useEffect(() => { fetchSectors().then(setSectors) }, [])
  useEffect(() => {
    fetch('/api/admin/market-state').then(r => r.json()).then(setMarketStates).catch(() => {})
  }, [])
  useEffect(() => {
    if (mainTab !== 'market') return
    Promise.all(['KOSPI', 'KOSDAQ'].map(m =>
      fetch(`/api/admin/market-state/history?market=${m}&days=60`)
        .then(r => r.json())
        .then((rows: typeof marketHistory[string]) => [m, [...rows].reverse()] as const)
    )).then(pairs => setMarketHistory(Object.fromEntries(pairs))).catch(() => {})
  }, [mainTab])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const { minCap, maxCap } = CAP_PARAMS[capRange]
    fetchScreener('KR', page, size, query.trim(), sector, minCap, maxCap, sortKey, sortDir, minScore)
      .then(d => {
        setItems(d.items)
        setTotal(d.total)
        // 관심종목 스코어 변동 알림
        if (watchlist.size > 0 && 'Notification' in window && Notification.permission === 'granted') {
          const prevKey = 'watchlist_prev_scores'
          let prev: Record<number, number> = {}
          try { prev = JSON.parse(localStorage.getItem(prevKey) ?? '{}') } catch {}
          const alerts: string[] = []
          d.items.forEach(item => {
            if (!watchlist.has(item.securityId)) return
            const prevScore = prev[item.securityId]
            const delta = prevScore != null ? item.compositeScore - prevScore : null
            if (delta != null && Math.abs(delta) >= 3) {
              alerts.push(`${item.name} ${delta > 0 ? '▲' : '▼'}${Math.abs(delta).toFixed(1)}pt (${item.compositeScore.toFixed(1)})`)
            }
            prev[item.securityId] = item.compositeScore
          })
          try { localStorage.setItem(prevKey, JSON.stringify(prev)) } catch {}
          if (alerts.length > 0) {
            new Notification('관심종목 스코어 변동', {
              body: alerts.join('\n'),
              icon: '/favicon.ico',
            })
          }
          // 관심종목 브레이크아웃 알림
          const breakouts = d.items.filter(i => watchlist.has(i.securityId) && i.breakoutToday)
          if (breakouts.length > 0) {
            new Notification('관심종목 브레이크아웃 🚀', {
              body: breakouts.map(i => `${i.name}(${i.ticker}) 52주 신고가 돌파`).join('\n'),
              icon: '/favicon.ico',
            })
          }
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [page, size, query, sector, capRange, sortKey, sortDir, minScore, watchlist])

  const FREE_WATCHLIST_LIMIT = 5

  const toggleWatch = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setWatchlist(prev => {
      const next = new Set(prev)
      const adding = !next.has(id)
      // 무료 관심종목 5개 제한
      if (adding && !isPremium() && next.size >= FREE_WATCHLIST_LIMIT) {
        setShowPremiumModal('watchlist')
        return prev
      }
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem('screener_watchlist', JSON.stringify([...next])) } catch {}
      // 처음 추가 시 알림 권한 요청
      if (adding && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission()
      }
      return next
    })
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
    setPage(0)
  }
  const handleQuery = (v: string) => { setQuery(v); setPage(0) }
  const handleSize = (v: number) => { setSize(v); setPage(0) }
  const totalPages = Math.ceil(total / size)

  const onTableScroll = () => {
    if (mirrorRef.current && scrollRef.current)
      mirrorRef.current.scrollLeft = scrollRef.current.scrollLeft
  }
  const onMirrorScroll = () => {
    if (scrollRef.current && mirrorRef.current)
      scrollRef.current.scrollLeft = mirrorRef.current.scrollLeft
  }

  // ── styles ──────────────────────────────────────────────────
  const S = {
    filterSelect: {
      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4,
      color: '#9ca3af', padding: '4px 8px', fontSize: 11, outline: 'none',
      cursor: 'pointer',
    } as React.CSSProperties,
    filterInput: {
      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4,
      color: 'var(--text-1)', padding: '4px 10px', fontSize: 12, outline: 'none', width: 200,
    } as React.CSSProperties,
    capBtn: (active: boolean) => ({
      padding: '4px 9px', fontSize: 10, fontWeight: 600,
      background: active ? '#1f3a5f' : 'transparent',
      color: active ? '#58a6ff' : 'var(--text-3)',
      border: 'none', cursor: 'pointer',
      borderRight: '1px solid var(--border)',
    } as React.CSSProperties),
    tab: (active: boolean) => ({
      padding: '8px 16px', fontSize: 12, fontWeight: active ? 600 : 400,
      color: active ? 'var(--text-1)' : 'var(--text-3)',
      background: 'none', border: 'none', cursor: 'pointer',
      borderBottom: active ? '2px solid #1f6feb' : '2px solid transparent',
      marginBottom: -1,
    } as React.CSSProperties),
    td: {
      padding: '5px 6px', fontSize: 11, color: '#9ca3af',
      borderBottom: '1px solid var(--bg-nav)',
    } as React.CSSProperties,
  }

  const flowColLabel = (label: string) =>
    `${label}(${flowUnit === '억원' ? '억' : '백만'})`

  // ── table header & row per tab ──────────────────────────────
  const renderHead = () => {
    const Th = (props: Omit<React.ComponentProps<typeof SortTh>, 'current' | 'dir' | 'onSort'>) =>
      <SortTh {...props} current={sortKey} dir={sortDir} onSort={handleSort} />

    if (viewTab === 'overview') return (
      <tr>
        <th style={{ ...S.td, width: 28, textAlign: 'center', color: 'var(--text-3)', fontSize: 10, borderBottom: '1px solid var(--border)', background: 'var(--bg-nav)' }}>★</th>
        <th style={{ ...S.td, width: 36, textAlign: 'center', color: 'var(--text-3)', fontSize: 10, borderBottom: '1px solid var(--border)', background: 'var(--bg-nav)' }}>#</th>
        <Th label="티커" align="center" style={{ width: 72 }} />
        <Th label="종목명" align="left" style={{ width: 140 }} />
        <Th label="섹터" align="left" style={{ width: 80 }} />
        <Th label="SCORE" sortKey="compositeScore" style={{ width: 70 }} />
        <Th label="Δ" style={{ width: 48, textAlign: 'center' }} />
        <Th label="분기실적" sortKey="cScore" align="center" style={{ width: 52 }} />
        <Th label="연간성장" sortKey="aScore" align="center" style={{ width: 52 }} />
        <Th label="신고가" sortKey="nScore" align="center" style={{ width: 52 }} />
        <Th label="수급" sortKey="sScore" align="center" style={{ width: 52 }} />
        <Th label="선도성" sortKey="lScore" align="center" style={{ width: 52 }} />
        <Th label="기관" sortKey="iScore" align="center" style={{ width: 52 }} />
        <Th label="시장" sortKey="mScore" align="center" style={{ width: 48 }} />
        <Th label="종가" sortKey="closePrice" style={{ width: 78 }} />
        <Th label="등락률" sortKey="changeRate" style={{ width: 64 }} />
        <Th label="시가총액" sortKey="marketCap" style={{ width: 78 }} />
        <Th label="베이스" align="center" style={{ width: 52 }} />
      </tr>
    )

    if (viewTab === 'technical') return (
      <tr>
        <th style={{ ...S.td, width: 36, textAlign: 'center', color: 'var(--text-3)', fontSize: 10, borderBottom: '1px solid var(--border)', background: 'var(--bg-nav)' }}>#</th>
        <Th label="티커" align="center" style={{ width: 72 }} />
        <Th label="종목명" align="left" style={{ width: 160 }} />
        <Th label="종가" sortKey="closePrice" style={{ width: 88 }} />
        <Th label="등락률" sortKey="changeRate" style={{ width: 70 }} />
        <Th label="52주고점비" sortKey="weekHigh52" style={{ width: 80 }} />
        <Th label="거래량" sortKey="volume" style={{ width: 80 }} />
        <Th label="거래대금" sortKey="turnover" style={{ width: 88 }} />
        <Th label="RS%" sortKey="marketPercentile" style={{ width: 60 }} />
        <Th label="시가총액" sortKey="marketCap" style={{ width: 88 }} />
        <Th label="SCORE" sortKey="compositeScore" style={{ width: 68 }} />
      </tr>
    )

    // flow
    return (
      <tr>
        <th style={{ ...S.td, width: 36, textAlign: 'center', color: 'var(--text-3)', fontSize: 10, borderBottom: '1px solid var(--border)', background: 'var(--bg-nav)' }}>#</th>
        <Th label="티커" align="center" style={{ width: 72 }} />
        <Th label="종목명" align="left" style={{ width: 160 }} />
        <Th label={flowColLabel('외국인')} sortKey="foreignNetBuy10d" style={{ width: 96, color: '#22d3ee' }} />
        <Th label={flowColLabel('기관')} sortKey="instNetBuy10d" style={{ width: 88, color: '#a78bfa' }} />
        <Th label="거래대금" sortKey="turnover" style={{ width: 88 }} />
        <Th label="거래량" sortKey="volume" style={{ width: 80 }} />
        <Th label="수급" sortKey="sScore" align="center" style={{ width: 56 }} />
        <Th label="기관" sortKey="iScore" align="center" style={{ width: 56 }} />
        <Th label="RS%" sortKey="marketPercentile" style={{ width: 60 }} />
        <Th label="SCORE" sortKey="compositeScore" style={{ width: 68 }} />
      </tr>
    )
  }

  const renderRow = (item: ScreenerItem, _idx: number) => {
    const hovered = hoveredId === item.securityId
    const grade = compositeGrade(item.compositeScore)
    const isWatched = watchlist.has(item.securityId)

    const watchBtn = (
      <td style={{ ...S.td, textAlign: 'center', padding: '0 2px' }}
        onClick={e => toggleWatch(item.securityId, e)}>
        <span style={{ fontSize: 13, cursor: 'pointer', color: isWatched ? '#facc15' : 'var(--text-4)',
          lineHeight: 1, userSelect: 'none' }}>
          {isWatched ? '★' : '☆'}
        </span>
      </td>
    )

    const base = (
      <>
        <td style={{ ...S.td, textAlign: 'center', color: 'var(--text-4)', fontSize: 10 }}>
          {item.marketRank}
        </td>
        <td style={{ ...S.td, textAlign: 'center', fontWeight: 700, fontFamily: 'monospace',
          fontSize: 12, color: hovered ? '#93c5fd' : '#3b82f6' }}>
          {item.ticker}
          {item.breakoutToday === true && (
            <span style={{ fontSize: 8, background: '#16a34a', color: '#fff', borderRadius: 3, padding: '1px 3px', marginLeft: 3 }}>NEW</span>
          )}
        </td>
        <td style={{ ...S.td, fontSize: 12, color: hovered ? 'var(--text-1)' : 'var(--text-1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
          {item.name}
        </td>
      </>
    )

    const scoreChip = (
      <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, fontSize: 13, color: grade.color }}>
        {item.compositeScore.toFixed(1)}
        <span style={{ fontSize: 9, marginLeft: 3, opacity: 0.7 }}>{grade.label}</span>
      </td>
    )

    const deltaCell = (() => {
      const d = item.scoreDelta
      if (d === null || d === undefined) return (
        <td style={{ ...S.td, textAlign: 'center', color: 'var(--text-4)' }}>-</td>
      )
      const abs = Math.abs(d)
      const bold = abs >= 2
      const color = d > 0 ? '#4ade80' : d < 0 ? '#f87171' : '#6b7280'
      const text = d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1)
      return (
        <td style={{ ...S.td, textAlign: 'center', color, fontWeight: bold ? 700 : 400, fontSize: 11 }}>
          {text}
        </td>
      )
    })()

    if (viewTab === 'overview') return (
      <>
        {watchBtn}
        {base}
        <td style={{ ...S.td, fontSize: 10, color: '#1d4ed8', opacity: 0.9,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.sector ?? '·'}
        </td>
        {scoreChip}
        {deltaCell}
        <ScoreCell value={item.cScore} />
        <ScoreCell value={item.aScore} />
        <ScoreCell value={item.nScore} />
        <ScoreCell value={item.sScore} />
        <ScoreCell value={item.lScore} />
        <ScoreCell value={item.iScore} />
        <ScoreCell value={item.mScore} />
        <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-1)' }}>
          {fmtPrice(item.closePrice)}
        </td>
        <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: changeColor(item.changeRate) }}>
          {fmtRate(item.changeRate)}
        </td>
        <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-3)' }}>
          {fmtMarketCap(item.marketCap)}
        </td>
        <td style={{ ...S.td, textAlign: 'center', fontSize: 10, color: 'var(--text-3)' }}>
          {item.baseDays ? `${item.baseDays}일` : '-'}
        </td>
      </>
    )

    if (viewTab === 'technical') {
      const high52pct = fmtHigh52pct(item.closePrice, item.weekHigh52)
      const isNearHigh = item.weekHigh52 !== null && item.closePrice !== null &&
        item.weekHigh52 > 0 && (item.closePrice / item.weekHigh52) >= 0.97
      return (
        <>
          {base}
          <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-1)', fontSize: 12, fontWeight: 600 }}>
            {fmtPrice(item.closePrice)}
          </td>
          <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: changeColor(item.changeRate) }}>
            {fmtRate(item.changeRate)}
          </td>
          <td style={{ ...S.td, textAlign: 'right', color: isNearHigh ? '#4ade80' : '#6b7280' }}>
            {high52pct}
          </td>
          <td style={{ ...S.td, textAlign: 'right' }}>{fmtVolume(item.volume)}</td>
          <td style={{ ...S.td, textAlign: 'right' }}>{fmtAmt(item.turnover)}</td>
          <td style={{ ...S.td, textAlign: 'right', color: '#9ca3af' }}>
            {(item.marketPercentile * 100).toFixed(0)}
          </td>
          <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-3)' }}>
            {fmtMarketCap(item.marketCap)}
          </td>
          {scoreChip}
        </>
      )
    }

    // flow tab
    return (
      <>
        {base}
        <td style={{ ...S.td, textAlign: 'right', fontWeight: 600,
          color: item.foreignNetBuy10d === null ? '#374151' : item.foreignNetBuy10d > 0 ? '#22d3ee' : '#f87171' }}>
          {fmtFlow(item.foreignNetBuy10d, flowUnit)}
        </td>
        <td style={{ ...S.td, textAlign: 'right', fontWeight: 600,
          color: item.instNetBuy10d === null ? '#374151' : item.instNetBuy10d > 0 ? '#a78bfa' : '#f87171' }}>
          {fmtFlow(item.instNetBuy10d, flowUnit)}
        </td>
        <td style={{ ...S.td, textAlign: 'right' }}>{fmtAmt(item.turnover)}</td>
        <td style={{ ...S.td, textAlign: 'right' }}>{fmtVolume(item.volume)}</td>
        <ScoreCell value={item.sScore} />
        <ScoreCell value={item.iScore} />
        <td style={{ ...S.td, textAlign: 'right', color: '#9ca3af' }}>
          {(item.marketPercentile * 100).toFixed(0)}
        </td>
        {scoreChip}
      </>
    )
  }

  // ── pagination helpers ──────────────────────────────────────
  const pageNums = (() => {
    const total7 = Math.min(totalPages, 7)
    const start = Math.max(0, Math.min(page - 3, totalPages - total7))
    return Array.from({ length: total7 }, (_, i) => start + i)
  })()

  if (error) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center',
      height: '100vh', color: '#f87171' }}>{error}</div>
  )

  const displayItems = items
    .filter(i => !showWatchOnly || watchlist.has(i.securityId))
    .filter(i => !showBreakoutOnly || i.breakoutToday)
  const hasActiveFilter = sector !== '' || capRange !== 'all' || query !== '' || minScore > 0 || showWatchOnly || showBreakoutOnly
  const activeFilterCount = [sector !== '', capRange !== 'all', query !== '', minScore > 0, showWatchOnly, showBreakoutOnly].filter(Boolean).length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-1)' }}>
      {showGuide && <GuidePopup onClose={closeGuide} />}

      {/* 프리미엄 게이팅 모달 */}
      {showPremiumModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowPremiumModal(null)}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-sub)', borderRadius: 10,
            padding: '28px 32px', maxWidth: 400, width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>✦</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>
              {showPremiumModal === 'watchlist'
                ? '관심종목은 프리미엄에서 무제한으로'
                : 'PDF 리포트는 프리미엄 전용'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.7, marginBottom: 20 }}>
              {showPremiumModal === 'watchlist'
                ? `무료 플랜은 관심종목을 최대 ${FREE_WATCHLIST_LIMIT}개까지 등록할 수 있습니다.\n프리미엄으로 업그레이드하면 무제한으로 이용하실 수 있습니다.`
                : '종목 상세 PDF 리포트는 프리미엄 전용 기능입니다.'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowPremiumModal(null)}
                style={{ flex: 1, padding: '8px 0', fontSize: 12, background: 'none',
                  border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-3)', cursor: 'pointer' }}>
                닫기
              </button>
              <button onClick={() => { setShowPremiumModal(null); navigate('/premium') }}
                style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700,
                  background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
                프리미엄 알아보기
              </button>
            </div>
          </div>
        </div>
      )}
      <MacroTicker />

      {/* ══ Section 1: 브랜드 네비게이션 ═══════════════════════ */}
      <div style={{
        background: 'var(--bg-nav)', borderBottom: '1px solid var(--border)',
        padding: '0 20px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', height: 40,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.5px', cursor: 'pointer' }}
              onClick={() => setShowGuide(true)}>
              성장주<span style={{ color: '#1f6feb' }}>스크리너</span>
            </span>
          </div>
          <nav style={{ display: 'flex', gap: 0 }}>
            {([
              { label: '스크리너', action: () => setMainTab('screener'), active: mainTab === 'screener' },
              { label: '시장',     action: () => setMainTab('market'),   active: mainTab === 'market' },
              { label: '플래너',   action: () => navigate('/calc'),      active: false },
            ]).map(({ label, action, active }) => (
              <span key={label} onClick={action} style={{
                padding: '0 12px', fontSize: 12,
                color: active ? 'var(--text-1)' : 'var(--text-3)',
                fontWeight: active ? 600 : 400,
                cursor: 'pointer', lineHeight: '40px',
                borderBottom: active ? '2px solid #1f6feb' : '2px solid transparent',
              }}>{label}</span>
            ))}
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {items[0] && (
            <div style={{ display: 'flex', gap: 20 }}>
              <Stat label="기준일" value={items[0].scoreDate} />
              <Stat label="Top" value={String(items[0].compositeScore)} color="#4ade80" />
              <Stat label="Avg" value={(items.reduce((s, i) => s + i.compositeScore, 0) / items.length).toFixed(1)} />
            </div>
          )}
          {/* 다크/라이트 토글 */}
          <button
            onClick={() => {
              const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
              document.documentElement.setAttribute('data-theme', next)
              localStorage.setItem('canslim_theme', next)
              setTheme(next as 'dark' | 'light')
            }}
            title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
            style={{
              width: 32, height: 18, borderRadius: 9, border: '1px solid var(--border-sub)',
              background: theme === 'light' ? '#e2e8f0' : 'var(--bg-elevated)',
              padding: 0, position: 'relative', flexShrink: 0,
              display: 'flex', alignItems: 'center', transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', width: 12, height: 12, borderRadius: '50%',
              background: theme === 'light' ? '#fabd44' : '#58a6ff',
              top: 2, left: theme === 'light' ? 16 : 2,
              transition: 'left 0.2s, background 0.2s',
            }} />
          </button>
          {visitCount !== null && (
            <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 10 }}>👥</span>
              {visitCount.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* ══ 시장 탭 ══════════════════════════════════════════════ */}
      {mainTab === 'market' && (() => {
        // 국면별 스타일 + 메시지
        const phaseInfo = (p?: string) => p === 'BULL'
          ? { bg: 'rgba(74,222,128,0.08)', border: '#166534', text: '#4ade80', icon: '🟢', label: '강세장', verdict: '신규 매수 가능', desc: '주가가 장기 상승 추세 위에서 움직이고 있습니다.' }
          : p === 'BEAR'
          ? { bg: 'rgba(248,113,113,0.08)', border: '#7f1d1d', text: '#f87171', icon: '🔴', label: '약세장', verdict: '신규 매수 자제', desc: '주가가 장기 하락 추세 아래에 있습니다. 현금 비중을 높이세요.' }
          : { bg: 'rgba(250,189,68,0.08)', border: '#78350f', text: '#fabd44', icon: '🟡', label: '조정', verdict: '관망 권장', desc: '단기 조정 구간입니다. 추세 확인 후 진입하세요.' }

        // M스코어 = 오늘 items의 mScore (전 종목 동일값)
        const mScore = items.length > 0 ? (items[0].mScore ?? 0) : 0
        const mColor = mScore >= 40 ? '#4ade80' : mScore >= 20 ? '#fabd44' : '#f87171'
        const mVerdict = mScore >= 40 ? '시장 전반이 상승 흐름에 있습니다.'
          : mScore >= 20 ? '일부 종목만 강세입니다. 종목 선별이 중요합니다.'
          : '대부분 종목이 고점 대비 크게 하락해 있습니다. 신중한 접근이 필요합니다.'

        // 종합 투자 조언
        const kospi = marketStates.find(m => m.market === 'KOSPI')
        const kosdaq = marketStates.find(m => m.market === 'KOSDAQ')
        const bothBull = kospi?.marketPhase === 'BULL' && kosdaq?.marketPhase === 'BULL'
        const anyBear  = kospi?.marketPhase === 'BEAR'  || kosdaq?.marketPhase === 'BEAR'
        const advice = bothBull && mScore >= 30
          ? { color: '#4ade80', text: '매수 적기 — 스크리너 상위 종목에서 진입 기회를 찾으세요.' }
          : anyBear && mScore < 20
          ? { color: '#f87171', text: '매수 금지 — 현금 보유 또는 기존 포지션 손절 기준 점검을 권장합니다.' }
          : { color: '#fabd44', text: '선별적 접근 — 강한 실적과 수급을 동반한 종목만 소규모 진입하세요.' }

        const hist = marketHistory[histTab] ?? []

        return (
          <div style={{ padding: '20px', maxWidth: 900, margin: '0 auto' }}>

            {/* ① 종합 투자 의견 */}
            <div style={{
              background: 'var(--bg-nav)', border: `1px solid ${advice.color}33`,
              borderRadius: 10, padding: '16px 20px', marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ fontSize: 22 }}>💡</div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4, fontWeight: 600, letterSpacing: '0.05em' }}>오늘의 투자 의견</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: advice.color }}>{advice.text}</div>
              </div>
            </div>

            {/* ② KOSPI / KOSDAQ 국면 카드 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              {[kospi, kosdaq].map(ms => {
                if (!ms) return null
                const pi = phaseInfo(ms.marketPhase)
                return (
                  <div key={ms.market} style={{
                    background: 'var(--bg-nav)', border: `1px solid var(--border)`,
                    borderRadius: 10, padding: '16px 20px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 18 }}>{pi.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{ms.market} · {pi.label}</div>
                        <div style={{ fontSize: 11, color: pi.text, fontWeight: 600 }}>{pi.verdict}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>{pi.desc}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 8 }}>기준일 {ms.stateDate}</div>
                  </div>
                )
              })}
            </div>

            {/* ③ 시장 건강도 (M스코어) */}
            <div style={{
              background: 'var(--bg-nav)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '16px 20px', marginBottom: 16,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 10 }}>시장 건강도</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ fontSize: 32, fontWeight: 800, color: mColor, minWidth: 70 }}>{mScore.toFixed(1)}<span style={{ fontSize: 14, color: 'var(--text-3)' }}>점</span></div>
                <div style={{ flex: 1 }}>
                  {/* 게이지 바 */}
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginBottom: 8, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${mScore}%`, background: mColor, borderRadius: 3, transition: 'width 0.5s' }} />
                  </div>
                  <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>{mVerdict}</div>
                </div>
              </div>
            </div>

            {/* ④ 국면 변화 이력 (타임라인) */}
            <div style={{ background: 'var(--bg-nav)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.06em' }}>최근 60일 국면 변화</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['KOSPI', 'KOSDAQ'] as const).map(m => (
                    <button key={m} onClick={() => setHistTab(m)} style={{
                      fontSize: 11, padding: '2px 10px', borderRadius: 4, cursor: 'pointer',
                      background: histTab === m ? 'rgba(31,111,235,0.2)' : 'none',
                      border: histTab === m ? '1px solid #1f6feb' : '1px solid var(--border)',
                      color: histTab === m ? '#58a6ff' : 'var(--text-3)',
                    }}>{m}</button>
                  ))}
                </div>
              </div>
              {/* 국면 타임라인 - 연속 블록 시각화 */}
              <div style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  {hist.map(h => {
                    const pi = phaseInfo(h.marketPhase)
                    return (
                      <div key={h.stateDate} title={`${h.stateDate} · ${pi.label}`}
                        style={{ width: 10, height: 28, borderRadius: 2, background: pi.text, opacity: 0.7, cursor: 'default' }} />
                    )
                  })}
                </div>
                {/* 범례 + 최근 변화 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10 }}>
                  {[['#4ade80', '강세장'], ['#fabd44', '조정'], ['#f87171', '약세장']].map(([c, l]) => (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-3)' }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{l}
                    </div>
                  ))}
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-4)' }}>← 과거 · 최근 →</span>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ══ 시장 M 배너 ══════════════════════════════════════════ */}
      {mainTab === 'screener' && !loading && items.length > 0 && (() => {
        const avgM = items.reduce((s, i) => s + (i.mScore ?? 0), 0) / items.length
        const { bg, border, label, desc } = avgM >= 60
          ? { bg: 'rgba(74,222,128,0.08)', border: '#4ade80', label: '매수 구간', desc: '시장 모멘텀 양호' }
          : avgM >= 40
          ? { bg: 'rgba(250,189,68,0.08)', border: '#fabd44', label: '관망 구간', desc: '추세 불확실' }
          : { bg: 'rgba(248,113,113,0.08)', border: '#f87171', label: '약세 구간 — 신규 매수 자제', desc: '하락 압력 우세' }
        const dot = avgM >= 60 ? '🟢' : avgM >= 40 ? '🟡' : '🔴'
        return (
          <div style={{
            margin: '0 20px', marginTop: 8, marginBottom: 4,
            background: bg, border: `1px solid ${border}`,
            borderRadius: 6, padding: '5px 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>
              {dot} 시장 M 지수: {avgM.toFixed(1)} · {label}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{desc}</span>
          </div>
        )
      })()}

      {mainTab === 'screener' && <>
      {/* ══ Section 2: 필터 패널 ════════════════════════════════ */}
      <div style={{ background: 'var(--bg-nav)', borderBottom: '2px solid var(--border)', padding: '12px 20px' }}>
        <div style={{
          border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-base)',
          overflow: 'hidden',
        }}>
          {/* 패널 헤더 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em' }}>
              스크리너 필터
              {activeFilterCount > 0 && (
                <span style={{
                  marginLeft: 8, background: '#1f3a5f', color: '#58a6ff',
                  borderRadius: 10, padding: '1px 7px', fontSize: 9,
                }}>{activeFilterCount}개 적용중</span>
              )}
            </span>
            {hasActiveFilter && (
              <button onClick={() => { setSector(''); setCapRange('all'); setQuery(''); setMinScore(0); setShowWatchOnly(false); setShowBreakoutOnly(false); setPage(0) }}
                style={{ fontSize: 10, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
                초기화
              </button>
            )}
          </div>

          {/* 필터 그리드 */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr',
            gap: '1px', background: 'var(--border)',
          }}>
            {/* 섹터 */}
            <FilterCell label="섹터">
              <select value={sector} onChange={e => { setSector(e.target.value); setPage(0) }}
                style={S.filterSelect}>
                <option value="">전체</option>
                {sectors.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </FilterCell>

            {/* 시가총액 */}
            <FilterCell label="시가총액">
              <div style={{ display: 'flex', gap: 3 }}>
                {(['all', 'large', 'mid', 'small'] as const).map(k => (
                  <button key={k} onClick={() => { setCapRange(k); setPage(0) }} style={{
                    padding: '3px 9px', fontSize: 10, fontWeight: 600, borderRadius: 3,
                    background: capRange === k ? '#1f3a5f' : 'var(--bg-surface)',
                    color: capRange === k ? '#58a6ff' : 'var(--text-3)',
                    border: `1px solid ${capRange === k ? '#1d4ed8' : 'var(--border)'}`,
                    cursor: 'pointer',
                  }}>
                    {k === 'all' ? '전체' : k === 'large' ? '대형(1조↑)' : k === 'mid' ? '중형' : '소형'}
                  </button>
                ))}
              </div>
            </FilterCell>

            {/* 검색 */}
            <FilterCell label="종목검색">
              <input placeholder="종목명 / 티커" value={query}
                onChange={e => handleQuery(e.target.value)}
                style={{ ...S.filterInput, width: 180 }} />
            </FilterCell>

            {/* 수급단위 */}
            <FilterCell label="수급단위">
              <div style={{ display: 'flex', gap: 3 }}>
                {(['억원', '백만원'] as FlowUnit[]).map(u => (
                  <button key={u} onClick={() => setFlowUnit(u)} style={{
                    padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 3,
                    background: flowUnit === u ? '#1a2a40' : 'var(--bg-surface)',
                    color: flowUnit === u ? '#38bdf8' : 'var(--text-3)',
                    border: `1px solid ${flowUnit === u ? '#0e7490' : 'var(--border)'}`,
                    cursor: 'pointer',
                  }}>{u}</button>
                ))}
              </div>
            </FilterCell>

            {/* SCORE 최소 */}
            <FilterCell label="SCORE 최소">
              <div style={{ display: 'flex', gap: 3 }}>
                {([0, 60, 70, 80] as const).map(v => (
                  <button key={v} onClick={() => { setMinScore(v); setPage(0) }} style={{
                    padding: '3px 9px', fontSize: 10, fontWeight: 600, borderRadius: 3,
                    background: minScore === v ? '#1f3a5f' : 'var(--bg-surface)',
                    color: minScore === v ? '#58a6ff' : 'var(--text-3)',
                    border: `1px solid ${minScore === v ? '#1d4ed8' : 'var(--border)'}`,
                    cursor: 'pointer',
                  }}>
                    {v === 0 ? '전체' : String(v)}
                  </button>
                ))}
              </div>
            </FilterCell>

            {/* 관심종목 */}
            <FilterCell label="관심종목">
              <button onClick={() => setShowWatchOnly(v => !v)} style={{
                padding: '3px 12px', fontSize: 10, fontWeight: 600, borderRadius: 3,
                background: showWatchOnly ? '#2d1a4a' : 'var(--bg-surface)',
                color: showWatchOnly ? '#c084fc' : 'var(--text-3)',
                border: `1px solid ${showWatchOnly ? '#7c3aed' : 'var(--border)'}`,
                cursor: 'pointer',
              }}>
                {showWatchOnly ? '★ 관심종목만' : '☆ 전체보기'}
              </button>
              {showWatchOnly && (
                <span style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>
                  현재 페이지 내 필터
                </span>
              )}
              <button onClick={() => { setShowBreakoutOnly(v => !v); setPage(0) }} style={{
                padding: '3px 12px', fontSize: 10, fontWeight: 600, borderRadius: 3,
                background: showBreakoutOnly ? '#052e16' : 'var(--bg-surface)',
                color: showBreakoutOnly ? '#4ade80' : 'var(--text-3)',
                border: `1px solid ${showBreakoutOnly ? '#16a34a' : 'var(--border)'}`,
                cursor: 'pointer',
              }}>
                {showBreakoutOnly ? '🚀 돌파 종목만' : '⬆ 오늘 돌파'}
              </button>
            </FilterCell>
          </div>
        </div>
      </div>

      {/* ══ 이번주 상승 종목 하이라이트 ══════════════════════════ */}
      {!loading && (() => {
        const risers = [...items]
          .filter(i => i.scoreDelta != null && i.scoreDelta > 0)
          .sort((a, b) => (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0))
          .slice(0, 5)
        if (risers.length === 0) return null
        return (
          <div style={{ padding: '6px 20px 0' }}>
            <div style={{
              background: 'var(--bg-nav)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '8px 12px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.06em', flexShrink: 0 }}>
                이번주 상승
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {risers.map(item => (
                  <div key={item.securityId}
                    onClick={() => navigate(`/stock/${item.securityId}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)',
                      borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                    }}>
                    <span style={{ fontSize: 11, color: 'var(--text-1)', fontWeight: 600 }}>{item.name}</span>
                    <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 700 }}>
                      +{(item.scoreDelta ?? 0).toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ══ Section 3: 결과바 + 뷰탭 (sticky) ══════════════════ */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'var(--bg-nav)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
      }}>
        {/* 뷰 탭 */}
        <div style={{ display: 'flex' }}>
          {([
            ['overview', '개요'],
            ['technical', '기술적'],
            ['flow', '수급'],
          ] as [ViewTab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setViewTab(key)} style={S.tab(viewTab === key)}>
              {label}
            </button>
          ))}
        </div>

        {/* 결과 카운트 + 행수 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!loading && (
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>{total.toLocaleString()}</span>
              {' '}종목
              {hasActiveFilter && <span style={{ color: '#1d4ed8' }}> (필터 적용)</span>}
            </span>
          )}
          <select value={size} onChange={e => handleSize(Number(e.target.value))}
            style={{ ...S.filterSelect, fontSize: 10 }}>
            {[30, 50, 100].map(n => <option key={n} value={n}>{n}행</option>)}
          </select>
        </div>
      </div>

      {/* ── Table area ───────────────────────────────────────── */}
      <div style={{ padding: '0 20px' }}>
        <div ref={scrollRef} onScroll={onTableScroll} className="hide-scrollbar"
          style={{ overflowX: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-4)', fontSize: 13 }}>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
              {' '}데이터 로딩 중...
            </div>
          ) : (
            <table style={{
              width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed',
              minWidth: viewTab === 'overview' ? 900 : 700,
            }}>
              <thead>{renderHead()}</thead>
              <tbody>
                {displayItems.map((item, idx) => (
                  <tr key={item.securityId}
                    onClick={() => navigate(`/stock/${item.securityId}`)}
                    onMouseEnter={() => setHoveredId(item.securityId)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      cursor: 'pointer',
                      background: hoveredId === item.securityId ? 'var(--bg-surface)'
                        : idx % 2 === 0 ? 'var(--bg-base)' : 'var(--bg-nav)',
                      transition: 'background 0.08s',
                    }}>
                    {renderRow(item, idx)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!loading && items.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-4)', fontSize: 13 }}>
              검색 결과 없음
            </div>
          )}
        </div>

        {/* sticky mirror scrollbar */}
        <div ref={mirrorRef} onScroll={onMirrorScroll} style={{
          position: 'sticky', bottom: 0, overflowX: 'auto', overflowY: 'hidden',
          zIndex: 5, background: 'var(--bg-base)', borderTop: '1px solid var(--bg-surface)',
        }}>
          <div style={{
            minWidth: viewTab === 'overview' ? 900 : 700, height: 1,
          }} />
        </div>
      </div>

      {/* ── Pagination ───────────────────────────────────────── */}
      {!loading && totalPages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 20px 32px', borderTop: '1px solid var(--bg-surface)',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
            {total.toLocaleString()}종목 · {page + 1}/{totalPages}페이지
          </span>
          <div style={{ display: 'flex', gap: 3 }}>
            <PgBtn label="«" onClick={() => setPage(0)} disabled={page === 0} />
            <PgBtn label="‹" onClick={() => setPage(p => p - 1)} disabled={page === 0} />
            {pageNums.map(p => (
              <PgBtn key={p} label={String(p + 1)} onClick={() => setPage(p)} active={p === page} />
            ))}
            <PgBtn label="›" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} />
            <PgBtn label="»" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} />
          </div>
          <div style={{ width: 120 }} />
        </div>
      )}
      </>}
    </div>
  )
}

// ── small helpers ──────────────────────────────────────────────
function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontSize: 9, color: 'var(--text-4)', fontWeight: 600, letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 12, color: color ?? 'var(--text-3)', fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function FilterCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div style={{
        background: '#0d1117', padding: '8px 12px',
        display: 'flex', alignItems: 'center',
        borderRight: '1px solid #21262d',
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-4)',
          letterSpacing: '0.06em', whiteSpace: 'nowrap',
        }}>{label}</span>
      </div>
      <div style={{
        background: '#0b0f17', padding: '8px 12px',
        display: 'flex', alignItems: 'center',
        borderRight: '1px solid #21262d',
      }}>
        {children}
      </div>
    </>
  )
}

function PgBtn({ label, onClick, disabled, active }: {
  label: string; onClick: () => void; disabled?: boolean; active?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      minWidth: 28, height: 26, padding: '0 6px',
      background: active ? '#1f3a5f' : 'transparent',
      border: `1px solid ${active ? '#1f6feb' : '#21262d'}`,
      borderRadius: 4, color: disabled ? '#21262d' : active ? '#58a6ff' : '#4b5563',
      fontSize: 11, cursor: disabled ? 'default' : 'pointer', fontWeight: active ? 700 : 400,
    }}>
      {label}
    </button>
  )
}
