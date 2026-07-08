import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchScreener, fetchSectors, fetchLiveQuotes, fetchLiveInvestors } from '../api/client'
import type { LiveQuote, LiveInvestor } from '../api/client'
import { isPremium } from '../api/auth'
import MacroTicker from '../components/MacroTicker'
import StockDetailPanel from '../components/StockDetailPanel'
import GachaModal from '../components/GachaModal'
import AppSidebar from '../components/AppSidebar'
import DashboardView from './DashboardView'
import RankingView from './RankingView'
import StatusBadges from '../components/StatusBadges'
import { useIsMobile } from '../hooks/useIsMobile'
import type { ScreenerItem } from '../types'
import { fmtPrice, fmtRate, fmtMarketCap, fmtAmt, fmtVolume } from '../utils/format'


// ── types ──────────────────────────────────────────────────────
type ViewTab = 'table' | 'detail'
type SortDir = 'desc' | 'asc'
type MainTab = 'dashboard' | 'ranking' | 'screener' | 'watchlist'
type SortKey = keyof Pick<ScreenerItem,
  'compositeScore' | 'cScore' | 'aScore' | 'nScore' | 'sScore' | 'lScore' | 'iScore' | 'mScore' |
  'closePrice' | 'changeRate' | 'weekHigh52' | 'turnover' | 'volume' |
  'foreignNetBuy10d' | 'instNetBuy10d' | 'programNetBuy10d' | 'marketPercentile' | 'marketCap'
>

// 평일 09:00~18:30 KST(실시간 오버레이 창) 여부 — 브라우저 로컬 타임존과 무관하게 UTC→KST 환산.
function isKrMarketHours(): boolean {
  const now = new Date()
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000)
  const day = kst.getDay()
  if (day === 0 || day === 6) return false
  const mins = kst.getHours() * 60 + kst.getMinutes()
  return mins >= 540 && mins <= 1110   // 09:00 ~ 18:30
}

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
  if (v === null) return 'var(--text-3)'
  if (v > 0) return 'var(--up)'    // 상승 = 빨강 (한국식)
  if (v < 0) return 'var(--down)'  // 하락 = 파랑
  return 'var(--text-3)'
}

// ── format helpers ─────────────────────────────────────────────
// ── sub-components ─────────────────────────────────────────────

function ScoreCell({ value }: { value: number | null }) {
  return (
    <td style={{
      padding: '0 5px', textAlign: 'center', fontFamily: 'var(--font-mono)',
      background: scoreColor(value), color: scoreText(value),
      fontWeight: value !== null ? 600 : 400, fontSize: 12,
      borderRight: '1px solid var(--score-sep)',
    }}>
      {value !== null ? Math.round(value) : <span style={{ color: 'var(--text-4)' }}>·</span>}
    </td>
  )
}

function SortTh({ label, sortKey: sk, current, dir, onSort, align = 'right', style = {}, tip }: {
  label: string; sortKey?: SortKey; current: SortKey; dir: SortDir
  onSort: (k: SortKey) => void; align?: React.CSSProperties['textAlign']; style?: React.CSSProperties
  tip?: string
}) {
  const active = sk && current === sk
  return (
    <th
      onClick={sk ? () => onSort(sk) : undefined}
      title={tip}
      style={{
        padding: '7px 6px', textAlign: align, fontSize: 11, fontWeight: 600,
        color: active ? 'var(--text-1)' : 'var(--text-3)', letterSpacing: '0.05em',
        cursor: sk ? 'pointer' : 'default', userSelect: 'none',
        whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-nav)', ...style,
      }}
    >
      {label}
      {sk && <span style={{ marginLeft: 2, opacity: active ? 1 : 0.3, fontSize: 11 }}>
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
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '0.5px' }}>NEXT<span style={{ color: 'var(--accent)' }}>PICK</span></span> · 7대 핵심 스코어
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
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
                background: 'var(--accent)22', border: '1px solid var(--accent)55',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 800, color: '#58a6ff',
              }}>{f.num}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>
                  {f.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 하단 */}
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, color: 'var(--text-3)' }}>
            <input type="checkbox" checked={hide24h} onChange={e => setHide24h(e.target.checked)}
              style={{ width: 13, height: 13, accentColor: 'var(--accent)', cursor: 'pointer' }} />
            24시간 보지 않기
          </label>
          <button onClick={() => onClose(hide24h)} style={{
            background: 'var(--accent)', border: 'none', borderRadius: 6,
            color: '#fff', fontSize: 13, fontWeight: 600,
            padding: '7px 20px', cursor: 'pointer',
          }}>확인</button>
        </div>
      </div>
    </div>
  )
}

// ── main component ─────────────────────────────────────────────
export default function ScreenerPage() {
  const isMobile = useIsMobile()
  const [items, setItems] = useState<ScreenerItem[]>([])
  const [liveMap, setLiveMap] = useState<Record<string, LiveQuote>>({})
  const [investorMap, setInvestorMap] = useState<Record<string, LiveInvestor>>({})
  const [flashMap, setFlashMap] = useState<Record<string, 'up' | 'down'>>({})
  const prevPriceRef = useRef<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const reqSeqRef = useRef(0)   // 검색 응답 레이스 가드
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(30)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('compositeScore')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [sector, setSector] = useState('')
  const [capRange, setCapRange] = useState<'all' | 'large' | 'mid' | 'small'>('all')
  const [sectors, setSectors] = useState<string[]>([])
  const [viewTab, setViewTab] = useState<ViewTab>(
    () => (sessionStorage.getItem('screener_viewTab') as ViewTab) || 'table'
  )
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
  const [mainTab, setMainTab] = useState<MainTab>(
    () => {
      const saved = sessionStorage.getItem('screener_mainTab') as MainTab | null
      const valid: MainTab[] = ['dashboard', 'ranking', 'screener', 'watchlist']
      return (saved && valid.includes(saved)) ? saved : 'dashboard'
    }
  )
  const [selectedStockId, setSelectedStockId] = useState<number | null>(null)
  const [showGacha, setShowGacha] = useState(false)
  const [visitCount, setVisitCount] = useState<number | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('canslim_theme') as 'dark' | 'light' | null
    if (saved) return saved
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [marketStates, setMarketStates] = useState<Array<{
    market: string; marketPhase?: string; trendDirection?: string; stateDate?: string
    indexClose?: number; ma50d?: number; ma200d?: number; distributionDayCount?: number
  }>>([])
  const closeGuide = (hide24h: boolean) => {
    if (hide24h) localStorage.setItem(GUIDE_KEY, String(Date.now() + 24 * 60 * 60 * 1000))
    setShowGuide(false)
  }
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const isPopRef = useRef(false)         // popstate로 인한 뷰 변경은 history push 생략
  const histMountedRef = useRef(false)   // 최초 마운트는 replaceState로 현재 엔트리에 심음

  const CAP_PARAMS: Record<string, { minCap?: number; maxCap?: number }> = {
    all:   {},
    large: { minCap: 1_000_000_000_000 },
    mid:   { minCap: 200_000_000_000, maxCap: 1_000_000_000_000 },
    small: { maxCap: 200_000_000_000 },
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  // 탭 상태 유지 (새로고침 시 복원)
  useEffect(() => { sessionStorage.setItem('screener_viewTab', viewTab) }, [viewTab])
  useEffect(() => { sessionStorage.setItem('screener_mainTab', mainTab) }, [mainTab])

  // ── 브라우저 뒤로가기 동기화 ─────────────────────────────────────
  // 대시보드/랭킹/스크리너/관심종목 탭 전환과 종목상세 진입이 모두 `/` 단일
  // 라우트 안에서 state로만 처리돼, history에 아무것도 안 쌓여 뒤로가기 시
  // 앱을 아예 벗어나던 문제. 뷰가 바뀔 때마다 history 엔트리를 쌓고(pushState),
  // popstate(뒤로/앞으로)에서 그 스냅샷으로 뷰를 복원해 앱 안에서 이동하게 한다.
  useEffect(() => {
    const view = { mainTab, viewTab, selectedStockId }
    if (!histMountedRef.current) {
      histMountedRef.current = true
      window.history.replaceState({ __appView: view }, '')
      return
    }
    if (isPopRef.current) { isPopRef.current = false; return }
    window.history.pushState({ __appView: view }, '')
  }, [mainTab, viewTab, selectedStockId])

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const v = (e.state as { __appView?: { mainTab: MainTab; viewTab: ViewTab; selectedStockId: number | null } } | null)?.__appView
      if (!v) return   // 앱 뷰 스냅샷이 아니면(최초 진입 이전 등) 브라우저 기본 동작
      isPopRef.current = true
      setMainTab(v.mainTab)
      setViewTab(v.viewTab)
      setSelectedStockId(v.selectedStockId ?? null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
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

  // 관심종목은 알림용으로만 참조 — fetch 의존성에서 제외해 ★ 토글 시 전체 재조회 방지
  const watchlistRef = useRef(watchlist)
  watchlistRef.current = watchlist

  // 검색어 디바운스 — 매 키스트로크마다 전체조회하지 않도록 300ms 지연
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQuery(query); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const { minCap, maxCap } = CAP_PARAMS[capRange]
    const seq = ++reqSeqRef.current   // 최신 요청만 반영 (응답 레이스 방지)
    const fetchSize = mainTab === 'ranking' ? Math.max(size, 50) : size
    fetchScreener('KR', page, fetchSize, debouncedQuery.trim(), sector, minCap, maxCap, sortKey, sortDir, minScore)
      .then(d => {
        if (seq !== reqSeqRef.current) return   // 늦게 도착한 옛 응답 무시
        setItems(d.items)
        setTotal(d.total)
        // 관심종목 스코어 변동 알림
        const watchlist = watchlistRef.current
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
              alerts.push(`${item.name} ${delta > 0 ? '▲' : '▼'}${Math.round(Math.abs(delta))}pt (${Math.round(item.compositeScore)})`)
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
      .catch(e => { if (seq === reqSeqRef.current) setError(e.message) })
      .finally(() => { if (seq === reqSeqRef.current) setLoading(false) })
  }, [page, size, mainTab, debouncedQuery, sector, capRange, sortKey, sortDir, minScore])

  // 장중 실시간 시세 오버레이 — 화면에 보이는 종목만, 4초 폴링.
  // 장외 시간엔 백엔드가 빈 결과 → 배치(EOD)값 유지.
  // 대시보드 탭은 자체 폴링(DashboardView)이 있어 여기선 스킵(KIS 이중 호출 방지).
  useEffect(() => {
    if (!items.length || mainTab === 'dashboard') { setLiveMap({}); return }
    const tickers = items.map(i => i.ticker)
    let cancelled = false
    const load = () => fetchLiveQuotes(tickers).then(m => {
      if (cancelled) return
      // 가격 변동 감지 → 플래시 (상승=up / 하락=down)
      const flashes: Record<string, 'up' | 'down'> = {}
      for (const t in m) {
        const np = m[t]?.price
        const pp = prevPriceRef.current[t]
        if (np != null && pp != null && np !== pp) flashes[t] = np > pp ? 'up' : 'down'
        if (np != null) prevPriceRef.current[t] = np
      }
      setLiveMap(m)
      if (Object.keys(flashes).length) {
        setFlashMap(flashes)
        setTimeout(() => { if (!cancelled) setFlashMap({}) }, 900)
      }
    })
    load()
    const id = setInterval(load, 4_000)   // 시세 4초 폴링 (등락률·가격·거래대금·프로그램)
    return () => { cancelled = true; clearInterval(id) }
  }, [items, mainTab])

  // 당일 외인·기관 수급 오버레이 — 시세와 분리해 15초 폴링(쿼터 절약).
  useEffect(() => {
    if (!items.length || mainTab === 'dashboard') { setInvestorMap({}); return }
    const tickers = items.map(i => i.ticker)
    let cancelled = false
    const load = () => fetchLiveInvestors(tickers).then(m => { if (!cancelled) setInvestorMap(m) })
    load()
    const id = setInterval(load, 15_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [items, mainTab])

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
  const handleQuery = (v: string) => { setQuery(v) }   // page 리셋·조회는 디바운스 이펙트에서
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
      color: '#9ca3af', padding: '4px 8px', fontSize: 12, outline: 'none',
      cursor: 'pointer',
    } as React.CSSProperties,
    filterInput: {
      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4,
      color: 'var(--text-1)', padding: '4px 10px', fontSize: 13, outline: 'none', width: 200,
    } as React.CSSProperties,
    capBtn: (active: boolean) => ({
      padding: '4px 9px', fontSize: 11, fontWeight: 600,
      background: active ? '#1f3a5f' : 'transparent',
      color: active ? '#58a6ff' : 'var(--text-3)',
      border: 'none', cursor: 'pointer',
      borderRight: '1px solid var(--border)',
    } as React.CSSProperties),
    tab: (active: boolean) => ({
      padding: '8px 16px', fontSize: 13, fontWeight: active ? 600 : 400,
      color: active ? 'var(--text-1)' : 'var(--text-3)',
      background: 'none', border: 'none', cursor: 'pointer',
      borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
      marginBottom: -1,
    } as React.CSSProperties),
    td: {
      padding: '5px 6px', fontSize: 12, color: '#9ca3af',
      borderBottom: '1px solid var(--bg-nav)',
    } as React.CSSProperties,
  }

  // ── table header & row ──────────────────────────────────────
  const renderHead = () => {
    const Th = (props: Omit<React.ComponentProps<typeof SortTh>, 'current' | 'dir' | 'onSort'>) =>
      <SortTh {...props} current={sortKey} dir={sortDir} onSort={handleSort} />

    return (
      <tr>
        <th style={{ ...S.td, width: 28, textAlign: 'center', color: 'var(--text-3)', fontSize: 11, borderBottom: '1px solid var(--border)', background: 'var(--bg-nav)' }}>★</th>
        <th style={{ ...S.td, width: 36, textAlign: 'center', color: 'var(--text-3)', fontSize: 11, borderBottom: '1px solid var(--border)', background: 'var(--bg-nav)' }}>#</th>
        <Th label="티커" align="center" style={{ width: 72 }} />
        <Th label="종목명" align="left" style={{ width: 140 }} />
        <Th label="섹터" align="left" style={{ width: 80 }} />
        <Th label="SCORE" sortKey="compositeScore" style={{ width: 70 }} tip="C·A·N·S·L·I 가중합산 종합점수 (0~100)" />
        <Th label="Δ" style={{ width: 48, textAlign: 'center' }} tip="전일 대비 종합점수 변동" />
        <Th label="실적" sortKey="cScore" align="center" style={{ width: 46 }} tip="분기실적: 당분기 EPS 전년대비 성장률" />
        <Th label="성장" sortKey="aScore" align="center" style={{ width: 46 }} tip="연간성장: 3년 EPS 연평균 성장률 + ROE" />
        <Th label="고가" sortKey="nScore" align="center" style={{ width: 46 }} tip="신고가: 52주 고점 근접도 + 돌파 여부" />
        <Th label="수급" sortKey="sScore" align="center" style={{ width: 46 }} tip="수급: 시총 희소성 + 거래량 급증도" />
        <Th label="선도" sortKey="lScore" align="center" style={{ width: 46 }} tip="선도성: 시장 내 상대강도 순위 (상위일수록 높음)" />
        <Th label="기관" sortKey="iScore" align="center" style={{ width: 46 }} tip="기관투자: 외인+기관 10일 순매수 강도" />
        <Th label="종가" sortKey="closePrice" style={{ width: 78 }} />
        <Th label="등락률" sortKey="changeRate" style={{ width: 64 }} tip="전일 종가 대비 당일 등락률" />
        <Th label="거래량" sortKey="volume" style={{ width: 64 }} tip="당일 누적 거래량 (만·천만주)" />
        <Th label="거래대금" sortKey="turnover" style={{ width: 72 }} tip="당일 누적 거래대금 (억·천억원)" />
        <Th label="외인" sortKey="foreignNetBuy10d" style={{ width: 62 }} tip="외국인 순매수 (억원) — 장중: 당일 실시간(잠정), 장외: 최근 10거래일 누적" />
        <Th label="기관" sortKey="instNetBuy10d" style={{ width: 62 }} tip="기관 순매수 (억원) — 장중: 당일 실시간(잠정), 장외: 최근 10거래일 누적" />
        <Th label="프로그램" sortKey="programNetBuy10d" style={{ width: 62 }} tip="프로그램 순매수 (억원) — 장중 당일 실시간(잠정). 장외엔 미제공" />
        <Th label="시총" sortKey="marketCap" style={{ width: 68 }} />
      </tr>
    )
  }

  // 장중 라이브를 배치 아이템 위에 머지.
  // 시세(빠른 폴링)=liveMap, 외인·기관 수급(느린 폴링)=investorMap, 프로그램=시세에 포함.
  const mergeLive = (item: ScreenerItem): ScreenerItem => {
    const q = liveMap[item.ticker]
    const inv = investorMap[item.ticker]
    if (!q && !inv) return item
    return {
      ...item,
      closePrice: q?.price ?? item.closePrice,
      changeRate: q?.changeRate ?? item.changeRate,
      volume: q?.volume ?? item.volume,
      turnover: q?.turnover ?? item.turnover,
      // 당일 실시간 순매수(장중 잠정) — 없으면 undefined 유지(렌더에서 10일 누적 폴백)
      programNetBuyToday: q?.programNetBuyToday,
      foreignNetBuyToday: inv?.foreignNetBuyToday,
      instNetBuyToday: inv?.instNetBuyToday,
    }
  }

  const renderRow = (item: ScreenerItem, _idx: number) => {
    const hovered = hoveredId === item.securityId
    const grade = compositeGrade(item.compositeScore)
    const isWatched = watchlist.has(item.securityId)
    // 수급: 장중이면 당일 실시간(원), 장외면 10일 누적(원). 값(억원)으로 표시.
    const foreignVal = item.foreignNetBuyToday ?? item.foreignNetBuy10d
    const instVal    = item.instNetBuyToday ?? item.instNetBuy10d
    const progVal    = item.programNetBuyToday ?? item.programNetBuy10d
    const flowLive   = item.foreignNetBuyToday != null || item.instNetBuyToday != null

    const watchBtn = (
      <td style={{ ...S.td, textAlign: 'center', padding: '0 2px' }}
        onClick={e => toggleWatch(item.securityId, e)}>
        <span style={{ fontSize: 14, cursor: 'pointer', color: isWatched ? '#facc15' : 'var(--text-4)',
          lineHeight: 1, userSelect: 'none' }}>
          {isWatched ? '★' : '☆'}
        </span>
      </td>
    )

    const base = (
      <>
        <td style={{ ...S.td, textAlign: 'center', color: 'var(--text-4)', fontSize: 11 }}>
          {item.marketRank}
        </td>
        <td style={{ ...S.td, textAlign: 'center', fontWeight: 700, fontFamily: 'monospace',
          fontSize: 13, color: hovered ? '#93c5fd' : '#3b82f6' }}>
          {item.ticker}
          {item.breakoutToday === true && (
            <span style={{ fontSize: 10, background: '#16a34a', color: '#fff', borderRadius: 3, padding: '1px 3px', marginLeft: 3 }}>NEW</span>
          )}
        </td>
        <td style={{ ...S.td, fontSize: 13, color: 'var(--text-1)', maxWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
            <StatusBadges statuses={liveMap[item.ticker]?.statuses ?? item.statuses} size="sm" />
          </div>
        </td>
      </>
    )

    const scoreChip = (
      <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, fontSize: 14, color: grade.color }}>
        {Math.round(item.compositeScore)}
        <span style={{ fontSize: 11, marginLeft: 3, opacity: 0.7 }}>{grade.label}</span>
      </td>
    )

    const deltaCell = (() => {
      const d = item.scoreDelta
      if (d === null || d === undefined) return (
        <td style={{ ...S.td, textAlign: 'center', color: 'var(--text-4)' }}>-</td>
      )
      const abs = Math.abs(d)
      const bold = abs >= 2
      const color = d > 0 ? 'var(--up)' : d < 0 ? 'var(--down)' : 'var(--text-3)'
      const text = d > 0 ? `+${Math.round(d)}` : `${Math.round(d)}`
      return (
        <td style={{ ...S.td, textAlign: 'center', color, fontWeight: bold ? 700 : 400, fontSize: 12 }}>
          {text}
        </td>
      )
    })()

    return (
      <>
        {watchBtn}
        {base}
        <td style={{ ...S.td, fontSize: 11, color: 'var(--accent-strong)', opacity: 0.9,
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
        <td className={flashMap[item.ticker] ? `flash-${flashMap[item.ticker]}` : undefined}
          style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-1)' }}>
          {fmtPrice(item.closePrice)}
        </td>
        <td className={flashMap[item.ticker] ? `flash-${flashMap[item.ticker]}` : undefined}
          style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: changeColor(item.changeRate) }}>
          {fmtRate(item.changeRate)}
        </td>
        <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-3)', fontFamily: 'monospace' }}>
          {fmtVolume(item.volume)}
        </td>
        <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-3)' }}>
          {fmtAmt(item.turnover)}
        </td>
        <td title={flowLive ? '당일 실시간(잠정)' : undefined}
          style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600,
          color: foreignVal == null ? 'var(--text-4)' : foreignVal > 0 ? '#22d3ee' : '#f87171' }}>
          {foreignVal == null ? '—' : (foreignVal > 0 ? '+' : '') + Math.round(foreignVal / 1e8) + '억'}
        </td>
        <td title={flowLive ? '당일 실시간(잠정)' : undefined}
          style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600,
          color: instVal == null ? 'var(--text-4)' : instVal > 0 ? '#a78bfa' : '#f87171' }}>
          {instVal == null ? '—' : (instVal > 0 ? '+' : '') + Math.round(instVal / 1e8) + '억'}
        </td>
        <td title={item.programNetBuyToday != null ? '당일 실시간(잠정)' : undefined}
          style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600,
          color: progVal == null ? 'var(--text-4)' : progVal > 0 ? '#34d399' : '#f87171' }}>
          {progVal == null ? '—' : (progVal > 0 ? '+' : '') + Math.round(progVal / 1e8) + '억'}
        </td>
        <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-3)' }}>
          {fmtMarketCap(item.marketCap)}
        </td>
      </>
    )
  }

  // ── 모바일 카드 렌더 (좁은 화면 전용) ────────────────────────
  const renderCard = (item: ScreenerItem, _idx: number) => {
    const grade = compositeGrade(item.compositeScore)
    const isWatched = watchlist.has(item.securityId)
    const flash = flashMap[item.ticker]
    // 수급: 장중 당일 실시간(원) → 장외 10일 누적(원). 억원 표시.
    const flow: { k: string; v: number | null | undefined; c: string }[] = [
      { k: '외인', v: item.foreignNetBuyToday ?? item.foreignNetBuy10d, c: '#22d3ee' },
      { k: '기관', v: item.instNetBuyToday ?? item.instNetBuy10d, c: '#a78bfa' },
      { k: '프로', v: item.programNetBuyToday ?? item.programNetBuy10d, c: '#34d399' },
    ]
    const flowLive = item.foreignNetBuyToday != null || item.instNetBuyToday != null
    const factors: { k: string; v: number | null }[] = [
      { k: '실적', v: item.cScore }, { k: '성장', v: item.aScore }, { k: '고가', v: item.nScore },
      { k: '수급', v: item.sScore }, { k: '선도', v: item.lScore }, { k: '기관', v: item.iScore },
    ]
    return (
      <div key={item.securityId}
        onClick={() => { setSelectedStockId(item.securityId); setViewTab('detail') }}
        style={{
          background: 'var(--bg-nav)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '12px 14px', marginBottom: 8, cursor: 'pointer',
        }}>
        {/* 1행: 순위·종목명·티커/섹터 | 관심·SCORE */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>#{item.marketRank}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
              {item.breakoutToday === true && (
                <span style={{ fontSize: 9, background: '#16a34a', color: '#fff', borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>NEW</span>
              )}
              <StatusBadges statuses={liveMap[item.ticker]?.statuses ?? item.statuses} size="xs" />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3, fontFamily: 'var(--font-mono)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: '#3b82f6', fontWeight: 700 }}>{item.ticker}</span>
              {item.sector && <span> · {item.sector}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <span onClick={e => toggleWatch(item.securityId, e)}
              style={{ fontSize: 18, lineHeight: 1, color: isWatched ? '#facc15' : 'var(--text-4)', userSelect: 'none' }}>
              {isWatched ? '★' : '☆'}
            </span>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: grade.color, lineHeight: 1 }}>
                {Math.round(item.compositeScore)}
              </div>
              <div style={{ fontSize: 10, color: grade.color, opacity: 0.85, marginTop: 1 }}>{grade.label}</div>
            </div>
          </div>
        </div>

        {/* 2행: 종가 · 등락률 · 시총 */}
        <div className={flash ? `flash-${flash}` : undefined}
          style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 10, borderRadius: 6,
            fontFamily: 'var(--font-mono)' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>{fmtPrice(item.closePrice)}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: changeColor(item.changeRate) }}>{fmtRate(item.changeRate)}</span>
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>거래량 {fmtVolume(item.volume)}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>시총 {fmtMarketCap(item.marketCap)}</span>
        </div>

        {/* 3행: C·A·N·S·L·I 팩터 스트립 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, marginTop: 10 }}>
          {factors.map(f => (
            <div key={f.k} style={{ textAlign: 'center', background: scoreColor(f.v), borderRadius: 5, padding: '4px 0' }}>
              <div style={{ fontSize: 9, color: 'var(--text-4)' }}>{f.k}</div>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: scoreText(f.v) }}>
                {f.v !== null ? Math.round(f.v) : '·'}
              </div>
            </div>
          ))}
        </div>

        {/* 4행: 수급 (외인·기관·프로그램, 억원) — 장중 당일 실시간, 장외 10일 누적 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4, marginTop: 8, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          {flow.map(f => (
            <span key={f.k} style={{ color: 'var(--text-4)' }}>
              {f.k} <b style={{ color: f.v == null ? 'var(--text-4)' : f.v > 0 ? f.c : '#f87171' }}>
                {f.v == null ? '—' : (f.v > 0 ? '+' : '') + Math.round(f.v / 1e8) + '억'}
              </b>
            </span>
          ))}
          {flowLive && <span style={{ marginLeft: 'auto', color: '#22c55e', fontSize: 9 }}>● 실시간</span>}
        </div>
      </div>
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

  // 실시간 오버레이가 덮어쓰는 필드로 정렬할 땐, 백엔드 정렬(배치 채점일 기준)과
  // 화면 표시(실시간 등락률 등)가 어긋나 "정렬이 안 된 것처럼" 보인다.
  // 이 필드들은 라이브 병합값으로 현재 페이지를 다시 정렬해 표시와 순서를 일치시킨다.
  // (전체 정렬은 백엔드 페이징이 담당 — 장중 실시간 전체 정렬은 보이는 종목 한계상 페이지 단위.)
  const LIVE_SORT_KEYS = new Set<SortKey>([
    'changeRate', 'closePrice', 'turnover', 'volume',
    'foreignNetBuy10d', 'instNetBuy10d', 'programNetBuy10d',
  ])
  // 정렬 기준값 = 화면 표시와 동일. 수급은 장중 당일 실시간 우선(→ 표시-순서 일치).
  const liveSortVal = (item: ScreenerItem, key: SortKey): number | null => {
    switch (key) {
      case 'foreignNetBuy10d': return item.foreignNetBuyToday ?? item.foreignNetBuy10d
      case 'instNetBuy10d':    return item.instNetBuyToday ?? item.instNetBuy10d
      case 'programNetBuy10d': return item.programNetBuyToday ?? item.programNetBuy10d
      default:                 return item[key] as number | null
    }
  }
  const displayItems = (() => {
    const arr = items
      .filter(i => !showWatchOnly || watchlist.has(i.securityId))
      .filter(i => !showBreakoutOnly || i.breakoutToday)
    const liveActive = Object.keys(liveMap).length > 0 || Object.keys(investorMap).length > 0
    if (!LIVE_SORT_KEYS.has(sortKey) || !liveActive) return arr
    const dir = sortDir === 'asc' ? 1 : -1
    return arr.map(mergeLive).sort((a, b) => {
      const av = liveSortVal(a, sortKey)
      const bv = liveSortVal(b, sortKey)
      if (av == null && bv == null) return 0
      if (av == null) return 1          // null은 항상 뒤로
      if (bv == null) return -1
      return (av - bv) * dir
    })
  })()
  const hasActiveFilter = sector !== '' || capRange !== 'all' || query !== '' || minScore > 0 || showWatchOnly || showBreakoutOnly
  const activeFilterCount = [sector !== '', capRange !== 'all', query !== '', minScore > 0, showWatchOnly, showBreakoutOnly].filter(Boolean).length

  // ── sector stats for dashboard ─────────────────────────────
  const sectorStats = (() => {
    const map = new Map<string, { changes: number[]; scores: number[]; count: number }>()
    for (const item of items) {
      const s = item.sector ?? '기타'
      if (!map.has(s)) map.set(s, { changes: [], scores: [], count: 0 })
      const g = map.get(s)!
      g.count++
      if (item.changeRate != null) g.changes.push(item.changeRate)
      g.scores.push(item.compositeScore)
    }
    return Array.from(map.entries()).map(([sector, g]) => ({
      sector,
      avgChange: g.changes.length ? g.changes.reduce((a, b) => a + b, 0) / g.changes.length : 0,
      count: g.count,
      avgScore: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
    }))
  })()

  const topSector = sectorStats.length > 0
    ? sectorStats.reduce((best, s) => s.avgChange > best.avgChange ? s : best, sectorStats[0])
    : null

  const toggleTheme = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('canslim_theme', next)
    setTheme(next as 'dark' | 'light')
  }

  return (
    <div style={{ height: '100dvh', background: 'var(--bg-base)', color: 'var(--text-1)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
            <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.7, marginBottom: 20 }}>
              {showPremiumModal === 'watchlist'
                ? `무료 플랜은 관심종목을 최대 ${FREE_WATCHLIST_LIMIT}개까지 등록할 수 있습니다.\n프리미엄으로 업그레이드하면 무제한으로 이용하실 수 있습니다.`
                : '종목 상세 PDF 리포트는 프리미엄 전용 기능입니다.'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowPremiumModal(null)}
                style={{ flex: 1, padding: '8px 0', fontSize: 13, background: 'none',
                  border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-3)', cursor: 'pointer' }}>
                닫기
              </button>
              <button onClick={() => { setShowPremiumModal(null); navigate('/premium') }}
                style={{ flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 700,
                  background: 'var(--accent)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
                프리미엄 알아보기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MacroTicker (full-width top strip) ═════════════════ */}
      <MacroTicker />

      {/* ══ New Header ══════════════════════════════════════════ */}
      <header className="nav-bar" style={{
        background: 'var(--bg-nav)',
        borderBottom: '1px solid var(--border)',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 48,
        flexShrink: 0,
        gap: 16,
      }}>
        {/* Left: Logo + tagline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: '1px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              whiteSpace: 'nowrap',
            }}
            onClick={() => setShowGuide(true)}
          >
            <span style={{
              width: 8, height: 8,
              background: 'var(--accent)',
              borderRadius: 2,
              display: 'inline-block',
              boxShadow: '0 0 6px var(--accent)',
            }} />
            NEXT<span style={{ color: 'var(--accent)' }}>PICK</span>
          </span>
          <span style={{
            fontSize: 11,
            color: 'var(--text-4)',
            borderLeft: '1px solid var(--border)',
            paddingLeft: 10,
            whiteSpace: 'nowrap',
          }}>
            주도주 스코어
          </span>
        </div>

        {/* Center: Search */}
        <div style={{ flex: 1, maxWidth: 360, position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, pointerEvents: 'none' }}>
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            placeholder="종목명 · 코드 · 섹터 검색"
            value={query}
            onChange={e => handleQuery(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-1)',
              padding: '7px 12px 7px 32px',
              fontSize: 13,
              outline: 'none',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
          />
        </div>

        {/* Right: date, theme toggle, gacha, visitor */}
        <div className="nav-right" style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          {items[0] && (
            <span style={{ fontSize: 11, color: 'var(--text-4)', whiteSpace: 'nowrap' }}>
              매일 갱신 · {items[0].scoreDate}
            </span>
          )}

          {/* Gacha */}
          <button onClick={() => setShowGacha(true)} style={{
            background: 'linear-gradient(135deg, #1f6feb, #7c3aed)',
            border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
            color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '0.03em',
            display: 'flex', alignItems: 'center', gap: 4,
            boxShadow: '0 2px 8px rgba(31,111,235,0.3)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(31,111,235,0.5)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(31,111,235,0.3)' }}>
            PICK
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
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

          {/* Visitor count */}
          {visitCount !== null && (
            <span style={{ fontSize: 11, color: 'var(--text-4)', whiteSpace: 'nowrap' }}>
              👥 {visitCount.toLocaleString()}
            </span>
          )}

          {/* Planner link */}
          <button onClick={() => navigate('/calc')} style={{
            fontSize: 12, color: 'var(--text-3)', background: 'none', border: '1px solid var(--border)',
            borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
          }}>
            플래너
          </button>
        </div>

        {/* Mobile right */}
        <div className="nav-right-mobile" style={{ display: 'none', alignItems: 'center', gap: 12 }}>
          <button onClick={toggleTheme}
            style={{ width: 32, height: 18, borderRadius: 9, border: '1px solid var(--border-sub)',
              background: theme === 'light' ? '#e2e8f0' : 'var(--bg-elevated)',
              padding: 0, position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', width: 12, height: 12, borderRadius: '50%',
              background: theme === 'light' ? '#fabd44' : '#58a6ff',
              top: 2, left: theme === 'light' ? 16 : 2, transition: 'left 0.2s' }} />
          </button>
        </div>
      </header>

      {/* ══ Body: sidebar + main content ═══════════════════════ */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Sidebar */}
        <AppSidebar
          activeTab={mainTab}
          onTabChange={(tab) => {
            setMainTab(tab)
            if (tab === 'screener' && viewTab === 'detail') setViewTab('table')
          }}
          watchlistCount={watchlist.size}
          topSector={topSector ? { name: topSector.sector, change: topSector.avgChange } : null}
          totalStocks={total}
        />

        {/* Main content area */}
        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden',
          paddingBottom: isMobile ? 64 : 0 }}>

      {/* ══ 시장 탭 (legacy — now accessible via sector/market logic) ═════ */}
      {mainTab === 'dashboard' && (
        <DashboardView
          items={items}
          loading={loading}
          marketStates={marketStates}
          onViewRanking={() => setMainTab('ranking')}
          onSectorClick={(s) => { setSector(s); setMainTab('screener'); setViewTab('table'); setPage(0) }}
          onStockClick={(id) => { setSelectedStockId(id); setMainTab('screener'); setViewTab('detail') }}
        />
      )}

      {mainTab === 'ranking' && (
        <RankingView
          items={items}
          loading={loading}
          liveMap={liveMap}
          onStockClick={(id) => { setSelectedStockId(id); setMainTab('screener'); setViewTab('detail') }}
        />
      )}

      {mainTab === 'watchlist' && (
        <RankingView
          items={items.filter(i => watchlist.has(i.securityId))}
          loading={loading}
          liveMap={liveMap}
          onStockClick={(id) => { setSelectedStockId(id); setMainTab('screener'); setViewTab('detail') }}
        />
      )}

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
          <div className="m-banner" style={{
            margin: '0 20px', marginTop: 8, marginBottom: 4,
            background: bg, border: `1px solid ${border}`,
            borderRadius: 6, padding: '5px 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 4,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
              {dot} 시장 M 지수: {Math.round(avgM)} · {label}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{desc}</span>
          </div>
        )
      })()}

      {mainTab === 'screener' && <>
      {/* ══ Section 2: 필터 패널 ════════════════════════════════ */}
      <div className="screener-filter-wrap" style={{ background: 'var(--bg-nav)', borderBottom: '2px solid var(--border)', padding: '12px 20px' }}>
        <div style={{
          border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-base)',
          overflow: 'hidden',
        }}>
          {/* 패널 헤더 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em' }}>
              스크리너 필터
              {activeFilterCount > 0 && (
                <span style={{
                  marginLeft: 8, background: '#1f3a5f', color: '#58a6ff',
                  borderRadius: 10, padding: '1px 7px', fontSize: 11,
                }}>{activeFilterCount}개 적용중</span>
              )}
            </span>
            {hasActiveFilter && (
              <button onClick={() => { setSector(''); setCapRange('all'); setQuery(''); setMinScore(0); setShowWatchOnly(false); setShowBreakoutOnly(false); setPage(0) }}
                style={{ fontSize: 11, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
                초기화
              </button>
            )}
          </div>

          {/* 필터 그리드 */}
          <div className="filter-grid" style={{
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
                    padding: '3px 9px', fontSize: 11, fontWeight: 600, borderRadius: 3,
                    background: capRange === k ? '#1f3a5f' : 'var(--bg-surface)',
                    color: capRange === k ? '#58a6ff' : 'var(--text-3)',
                    border: `1px solid ${capRange === k ? 'var(--accent-strong)' : 'var(--border)'}`,
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

            {/* SCORE 최소 */}
            <FilterCell label="SCORE 최소">
              <div style={{ display: 'flex', gap: 3 }}>
                {([0, 60, 70, 80] as const).map(v => (
                  <button key={v} onClick={() => { setMinScore(v); setPage(0) }} style={{
                    padding: '3px 9px', fontSize: 11, fontWeight: 600, borderRadius: 3,
                    background: minScore === v ? '#1f3a5f' : 'var(--bg-surface)',
                    color: minScore === v ? '#58a6ff' : 'var(--text-3)',
                    border: `1px solid ${minScore === v ? 'var(--accent-strong)' : 'var(--border)'}`,
                    cursor: 'pointer',
                  }}>
                    {v === 0 ? '전체' : String(v)}
                  </button>
                ))}
              </div>
            </FilterCell>

            {/* 정렬 */}
            <FilterCell label="정렬">
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {([
                  ['compositeScore', '종합점수'],
                  ['turnover', '거래대금'],
                  ['marketCap', '시총'],
                  ['changeRate', '등락률'],
                ] as const).map(([k, lbl]) => (
                  <button key={k} onClick={() => { setSortKey(k as SortKey); setSortDir('desc'); setPage(0) }} style={{
                    padding: '3px 9px', fontSize: 11, fontWeight: 600, borderRadius: 3,
                    background: sortKey === k ? '#1f3a5f' : 'var(--bg-surface)',
                    color: sortKey === k ? '#58a6ff' : 'var(--text-3)',
                    border: `1px solid ${sortKey === k ? 'var(--accent-strong)' : 'var(--border)'}`,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </FilterCell>

            {/* 관심종목 */}
            <FilterCell label="관심종목">
              <button onClick={() => setShowWatchOnly(v => !v)} style={{
                padding: '3px 12px', fontSize: 11, fontWeight: 600, borderRadius: 3,
                background: showWatchOnly ? '#2d1a4a' : 'var(--bg-surface)',
                color: showWatchOnly ? '#c084fc' : 'var(--text-3)',
                border: `1px solid ${showWatchOnly ? '#7c3aed' : 'var(--border)'}`,
                cursor: 'pointer',
              }}>
                {showWatchOnly ? '★ 관심종목만' : '☆ 전체보기'}
              </button>
              {showWatchOnly && (
                <span style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                  현재 페이지 내 필터
                </span>
              )}
              <button onClick={() => { setShowBreakoutOnly(v => !v); setPage(0) }} style={{
                padding: '3px 12px', fontSize: 11, fontWeight: 600, borderRadius: 3,
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
          <div className="rising-wrap" style={{ padding: '6px 20px 0' }}>
            <div style={{
              background: 'var(--bg-nav)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '8px 12px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.06em', flexShrink: 0 }}>
                이번주 상승
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {risers.map(item => (
                  <div key={item.securityId}
                    onClick={() => { setSelectedStockId(item.securityId); setViewTab('detail') }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      background: 'rgba(232,51,63,0.08)', border: '1px solid rgba(232,51,63,0.25)',
                      borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                    }}>
                    <span style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 600 }}>{item.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--up)', fontWeight: 700 }}>
                      +{Math.round(item.scoreDelta ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ══ Section 3: 결과바 + 뷰탭 (sticky) ══════════════════ */}
      <div className="result-bar" style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'var(--bg-nav)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
      }}>
        {/* 뷰 탭 */}
        <div style={{ display: 'flex' }}>
          <button onClick={() => setViewTab('table')} style={S.tab(viewTab === 'table')}>
            스크리너
          </button>
          <div style={{ position: 'relative' }}
            onMouseEnter={e => {
              if (!selectedStockId) {
                const tip = e.currentTarget.querySelector('[data-tip]') as HTMLElement
                if (tip) tip.style.display = 'block'
              }
            }}
            onMouseLeave={e => {
              const tip = e.currentTarget.querySelector('[data-tip]') as HTMLElement
              if (tip) tip.style.display = 'none'
            }}>
            <button
              onClick={() => { if (selectedStockId) setViewTab('detail') }}
              style={{
                ...S.tab(viewTab === 'detail'),
                color: viewTab === 'detail' ? '#58a6ff' : selectedStockId ? 'var(--text-3)' : 'var(--text-4)',
                cursor: selectedStockId ? 'pointer' : 'default',
              }}>
              종목 상세
            </button>
            <div data-tip style={{
              display: 'none', position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
              background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
              padding: '6px 12px', fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap',
              zIndex: 30, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', marginTop: 4,
            }}>
              종목을 선택해주세요
            </div>
          </div>
        </div>

        {/* 결과 카운트 + 행수 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* 라이브 상태 배지 — 실시간 / 지연(장중 오류) / 종가(장외) 3-상태 */}
          {(() => {
            const live = Object.keys(liveMap).length > 0
            const state = live ? 'live' : (isKrMarketHours() ? 'delayed' : 'batch')
            const c = state === 'live'
              ? { bg: 'rgba(34,197,94,0.15)', color: '#22c55e', text: '● 실시간', tip: '장중 실시간 시세 반영 중' }
              : state === 'delayed'
              ? { bg: 'rgba(234,179,8,0.15)', color: '#eab308', text: '● 지연', tip: '장중이나 실시간 시세 지연/오류 — 종가 기준 표시 중 (KIS 쿼터·네트워크 확인)' }
              : { bg: 'var(--bg-elevated)', color: 'var(--text-4)', text: '종가', tip: '장 마감/장외 — 종가(EOD) 기준' }
            return (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                background: c.bg, color: c.color, whiteSpace: 'nowrap' }} title={c.tip}>
                {c.text}
              </span>
            )
          })()}
          {!loading && (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>{total.toLocaleString()}</span>
              {' '}종목
              {hasActiveFilter && <span style={{ color: 'var(--accent-strong)' }}> (필터 적용)</span>}
            </span>
          )}
          <select value={size} onChange={e => handleSize(Number(e.target.value))}
            style={{ ...S.filterSelect, fontSize: 11 }}>
            {[30, 50, 100].map(n => <option key={n} value={n}>{n}행</option>)}
          </select>
        </div>
      </div>

      {/* ── 활성 필터 칩 ─────────────────────────────────────── */}
      {hasActiveFilter && (() => {
        const capLabel: Record<string, string> = { large: '대형(1조↑)', mid: '중형', small: '소형' }
        const chips: { label: string; clear: () => void }[] = []
        if (query) chips.push({ label: `검색 "${query}"`, clear: () => handleQuery('') })
        if (sector) chips.push({ label: `섹터 · ${sector}`, clear: () => { setSector(''); setPage(0) } })
        if (capRange !== 'all') chips.push({ label: `시총 · ${capLabel[capRange]}`, clear: () => { setCapRange('all'); setPage(0) } })
        if (minScore > 0) chips.push({ label: `SCORE ≥ ${minScore}`, clear: () => { setMinScore(0); setPage(0) } })
        if (showWatchOnly) chips.push({ label: '★ 관심종목', clear: () => setShowWatchOnly(false) })
        if (showBreakoutOnly) chips.push({ label: '⤊ 오늘 돌파', clear: () => setShowBreakoutOnly(false) })
        const clearAll = () => { setSector(''); setCapRange('all'); setQuery(''); setMinScore(0); setShowWatchOnly(false); setShowBreakoutOnly(false); setPage(0) }
        return (
          <div className="filter-chips" style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
            padding: '8px 20px', background: 'var(--bg-base)', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', marginRight: 2 }}>필터</span>
            {chips.map((c, i) => (
              <button key={i} onClick={c.clear} title="제거" style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontWeight: 600, padding: '3px 6px 3px 10px', borderRadius: 999,
                background: 'var(--accent-soft)', color: 'var(--accent-strong)',
                border: '1px solid var(--accent)', cursor: 'pointer',
              }}>
                {c.label}
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 14, height: 14, borderRadius: '50%', fontSize: 11, lineHeight: 1,
                  background: 'var(--accent)', color: 'var(--accent-contrast)',
                }}>×</span>
              </button>
            ))}
            <button onClick={clearAll} style={{
              fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999,
              background: 'transparent', color: 'var(--text-3)',
              border: '1px solid var(--border-sub)', cursor: 'pointer', marginLeft: 2,
            }}>전체 해제</button>
          </div>
        )
      })()}

      {/* ── Detail panel (inline) ───────────────────────────── */}
      {viewTab === 'detail' && selectedStockId && (
        <StockDetailPanel
          securityId={selectedStockId}
          onSelectStock={(id) => setSelectedStockId(id)}
          onBack={() => window.history.back()}
        />
      )}

      {/* ── Table area ───────────────────────────────────────── */}
      {viewTab !== 'detail' && <><div className="table-wrap" style={{ padding: '0 20px' }}>
        <div ref={scrollRef} onScroll={onTableScroll} className="hide-scrollbar"
          style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="loading-box">
              <span className="spinner" />
              종목 데이터 불러오는 중…
            </div>
          ) : isMobile ? (
            /* 모바일/앱: 카드 리스트 (가로 스크롤 없는 세로 레이아웃) */
            <div style={{ padding: '2px 0' }}>
              {displayItems.map((item, idx) => renderCard(mergeLive(item), idx))}
            </div>
          ) : (
            <table style={{
              width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed',
              minWidth: 1200,
            }}>
              <thead>{renderHead()}</thead>
              <tbody>
                {displayItems.map((item, idx) => (
                  <tr key={item.securityId}
                    onClick={() => { setSelectedStockId(item.securityId); setViewTab('detail') }}
                    onMouseEnter={() => setHoveredId(item.securityId)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      cursor: 'pointer',
                      background: hoveredId === item.securityId ? 'var(--bg-surface)'
                        : idx % 2 === 0 ? 'var(--bg-base)' : 'var(--bg-nav)',
                      transition: 'background 0.08s',
                    }}>
                    {renderRow(mergeLive(item), idx)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!loading && items.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-4)', fontSize: 14 }}>
              검색 결과 없음
            </div>
          )}
        </div>

        {/* 하단 고정 가로 스크롤바 — 세로 스크롤 중에도 뷰포트 하단에 붙어 항상 조작 가능
            (넓은 테이블 전용 — 모바일 카드 뷰에선 숨김) */}
        {!isMobile && (
          <div ref={mirrorRef} onScroll={onMirrorScroll} className="sticky-hscroll" style={{
            position: 'sticky', bottom: 0, overflowX: 'auto', overflowY: 'hidden',
            zIndex: 6, background: 'var(--bg-nav)', borderTop: '1px solid var(--border)',
            boxShadow: '0 -4px 12px rgba(0,0,0,0.12)',
          }}>
            <div style={{
              minWidth: 1200, height: 1,
            }} />
          </div>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────── */}
      {!loading && totalPages > 1 && (
        <div className="pagination" style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 20px 32px', borderTop: '1px solid var(--bg-surface)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>
            {total.toLocaleString()}종목 · {page + 1}/{totalPages}페이지
          </span>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
            <PgBtn label="«" onClick={() => setPage(0)} disabled={page === 0} />
            <PgBtn label="‹" onClick={() => setPage(p => p - 1)} disabled={page === 0} />
            {pageNums.map(p => (
              <PgBtn key={p} label={String(p + 1)} onClick={() => setPage(p)} active={p === page} />
            ))}
            <PgBtn label="›" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} />
            <PgBtn label="»" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} />
          </div>
          <div className="pg-spacer" style={{ width: 120 }} />
        </div>
      )}
      </>}
      </>}

      {/* ══ 섹터맵 — keep accessible from screener sector click ══ */}

        </main>
      </div>

      {/* ══ 가챠 모달 (outside layout flow, fixed/portal) ══════════ */}
      {showGacha && (
        <GachaModal
          items={items}
          onSelect={(id) => { setShowGacha(false); setSelectedStockId(id); setMainTab('screener'); setViewTab('detail') }}
          onClose={() => setShowGacha(false)}
        />
      )}
    </div>
  )
}

function FilterCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div style={{
        background: 'var(--bg-nav)', padding: '8px 12px',
        display: 'flex', alignItems: 'center',
        borderRight: '1px solid var(--border)',
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: 'var(--text-4)',
          letterSpacing: '0.06em', whiteSpace: 'nowrap',
        }}>{label}</span>
      </div>
      <div style={{
        background: 'var(--bg-base)', padding: '8px 12px',
        display: 'flex', alignItems: 'center',
        borderRight: '1px solid var(--border)',
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
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 4, color: disabled ? 'var(--border)' : active ? '#58a6ff' : 'var(--text-3)',
      fontSize: 12, cursor: disabled ? 'default' : 'pointer', fontWeight: active ? 700 : 400,
    }}>
      {label}
    </button>
  )
}
