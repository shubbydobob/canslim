import React, { useEffect, useRef, useState, useMemo, useCallback, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchScreener, fetchSectors, fetchLiveQuotes } from '../api/client'
import type { LiveQuote } from '../api/client'
import { isPremium } from '../api/auth'
import MacroTicker from '../components/MacroTicker'
// 차트(recharts) 포함 상세 패널은 lazy — 스크리너 초기 로드에서 제외.
const StockDetailPanel = lazy(() => import('../components/StockDetailPanel'))
import GachaModal from '../components/GachaModal'
import AppSidebar from '../components/AppSidebar'
import DashboardView from './DashboardView'
import RankingView from './RankingView'
import StatusBadges from '../components/StatusBadges'
import { useIsMobile } from '../hooks/useIsMobile'
import type { ScreenerItem } from '../types'
import { fmtPrice, fmtRate, fmtMarketCap, fmtAmt, fmtVolume, isLiveOverlayHours } from '../utils/format'
import { MARKET, IS_US } from '../config/market'
import { scoreBg, scoreFg, scoreGrade, changeColor } from '../utils/factors'


// ── types ──────────────────────────────────────────────────────
type ViewTab = 'table' | 'detail'
type SortDir = 'desc' | 'asc'
type MainTab = 'dashboard' | 'ranking' | 'screener' | 'watchlist'
type SortKey = keyof Pick<ScreenerItem,
  'compositeScore' | 'cScore' | 'aScore' | 'nScore' | 'sScore' | 'lScore' | 'iScore' | 'mScore' |
  'closePrice' | 'changeRate' | 'weekHigh52' | 'turnover' | 'volume' |
  'marketPercentile' | 'marketCap'
>

// 평일 08:00~20:00 KST(실시간 오버레이 창, 넥스트레이드 프리~애프터마켓) 여부.
// 브라우저 로컬 타임존과 무관하게 UTC→KST 환산. 백엔드 isKrMarketOpen과 동일 창.
// ── sub-components ─────────────────────────────────────────────

function ScoreCell({ value }: { value: number | null }) {
  return (
    <td className={value !== null ? 'scr-score' : 'scr-score null'}
      style={{ ['--sc-bg' as string]: scoreBg(value), ['--sc-fg' as string]: scoreFg(value) }}>
      {value !== null ? Math.round(value) : <span className="scr-score-null">·</span>}
    </td>
  )
}

function SortTh({ label, sortKey: sk, current, dir, onSort, align = 'r', width, tip }: {
  label: string; sortKey?: SortKey; current: SortKey; dir: SortDir
  onSort: (k: SortKey) => void; align?: 'l' | 'c' | 'r'; width?: number
  tip?: string
}) {
  const active = sk && current === sk
  const cls = 'scr-th'
    + (align === 'l' ? ' ta-l' : align === 'c' ? ' ta-c' : '')
    + (sk ? ' sortable' : '') + (active ? ' active' : '')
  return (
    <th onClick={sk ? () => onSort(sk) : undefined} title={tip} className={cls}
      style={width != null ? { ['--scr-w' as string]: `${width}px` } : undefined}>
      {label}
      {sk && <span className={active ? 'scr-th-arrow active' : 'scr-th-arrow'}>
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
    <div className="modal-overlay" onClick={() => onClose(hide24h)}>
      <div className="modal-card guide-card" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="guide-head">
          <div>
            <div className="guide-title">
              <span className="brand-mono">NEXT<span className="brand-pick">PICK</span></span> · 7대 핵심 스코어
            </div>
            <div className="guide-sub">
              각 지표는 0~100점으로 환산되며 가중 합산하여 종합점수를 산출합니다
            </div>
          </div>
          <button onClick={() => onClose(hide24h)} className="guide-close">✕</button>
        </div>

        {/* 지표 목록 */}
        <div className="guide-list">
          {FACTORS.map(f => (
            <div key={f.num} className="guide-item">
              <div className="guide-num">{f.num}</div>
              <div>
                <div className="guide-item-name">{f.name}</div>
                <div className="guide-item-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 하단 */}
        <div className="guide-foot">
          <label className="guide-check">
            <input type="checkbox" checked={hide24h} onChange={e => setHide24h(e.target.checked)} />
            24시간 보지 않기
          </label>
          <button onClick={() => onClose(hide24h)} className="btn-fill guide-confirm">확인</button>
        </div>
      </div>
    </div>
  )
}

// ── main component ─────────────────────────────────────────────
export default function ScreenerPage() {
  const isMobile = useIsMobile()
  const [sbCollapsed, setSbCollapsed] = useState(() => {
    try { return localStorage.getItem('sb_collapsed') === '1' } catch { return false }
  })
  const toggleSidebar = () => setSbCollapsed(v => {
    const next = !v
    try { localStorage.setItem('sb_collapsed', next ? '1' : '0') } catch { /* noop */ }
    return next
  })
  const [items, setItems] = useState<ScreenerItem[]>([])
  const [liveMap, setLiveMap] = useState<Record<string, LiveQuote>>({})
  const [liveLoaded, setLiveLoaded] = useState(false)   // 첫 실시간 폴링 완료 여부(시세 보류 게이트)
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
    const saved = localStorage.getItem('nextpick_theme') as 'dark' | 'light' | null
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
  // 가로 스크롤 힌트: 실제 스크롤 폭 + 오버플로우/끝 도달 여부 (데스크톱 sticky 스크롤바·우측 페이드용)
  const [hScroll, setHScroll] = useState({ w: 900, over: false, end: true })
  const isPopRef = useRef(false)         // popstate로 인한 뷰 변경은 history push 생략
  const histMountedRef = useRef(false)   // 최초 마운트는 replaceState로 현재 엔트리에 심음

  // 시총 임계값: KR=원(1조/2천억), US=달러($10B/$2B). marketCap은 close_adj×total_shares라 통화가 시장별로 다름.
  const CAP_PARAMS: Record<string, { minCap?: number; maxCap?: number }> = IS_US
    ? {
        all:   {},
        large: { minCap: 10_000_000_000 },
        mid:   { minCap: 2_000_000_000, maxCap: 10_000_000_000 },
        small: { maxCap: 2_000_000_000 },
      }
    : {
        all:   {},
        large: { minCap: 1_000_000_000_000 },
        mid:   { minCap: 200_000_000_000, maxCap: 1_000_000_000_000 },
        small: { maxCap: 200_000_000_000 },
      }
  // 대형 프리셋 라벨(시장별 통화 표기)
  const capLargeLabel = IS_US ? '대형($10B↑)' : '대형(1조↑)'

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
    const seq = ++reqSeqRef.current   // 최신 요청만 반영 (응답 레이스 방지)
    // 대시보드·랭킹은 '전체 시장 종합점수 상위'를 보여줘야 하므로 스크리너의
    // 정렬/필터/페이지 상태와 분리한다. (탭 간 공유 상태로 인해 세 뷰의 상위 종목
    // 풀이 어긋나던 문제 방지 — 무필터·compositeScore desc·page0·상위 50 고정.)
    const rankMode = mainTab === 'dashboard' || mainTab === 'ranking'
    const { minCap, maxCap } = rankMode ? { minCap: undefined, maxCap: undefined } : CAP_PARAMS[capRange]
    const fetchSize  = rankMode ? 50 : size
    const effPage    = rankMode ? 0 : page
    const effQuery   = rankMode ? '' : debouncedQuery.trim()
    const effSector  = rankMode ? '' : sector
    const effSortBy  = rankMode ? 'compositeScore' : sortKey
    const effSortDir = rankMode ? 'desc' : sortDir
    const effMinScore = rankMode ? undefined : minScore
    fetchScreener(MARKET, effPage, fetchSize, effQuery, effSector, minCap, maxCap, effSortBy, effSortDir, effMinScore)
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
    if (!items.length || mainTab === 'dashboard') { setLiveMap({}); setLiveLoaded(false); return }
    const tickers = items.map(i => i.ticker)
    let cancelled = false
    setLiveLoaded(false)   // 새 목록: 첫 실시간 폴링 완료 전까지 시세 보류
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
      setLiveLoaded(true)   // 첫 응답 도착 → 보류 해제(이후 미포함 종목은 배치값으로 폴백)
      if (Object.keys(flashes).length) {
        setFlashMap(flashes)
        setTimeout(() => { if (!cancelled) setFlashMap({}) }, 900)
      }
    }).catch(() => { if (!cancelled) setLiveLoaded(true) })   // 실패해도 무한 스켈레톤 방지
    load()
    const id = setInterval(load, 4_000)   // 시세 4초 폴링 (등락률·가격·거래대금·프로그램)
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

  // 실제 스크롤 폭·끝 도달 여부 측정 → sticky 스크롤바 폭 동기화 + 우측 페이드 토글
  const measureHScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const over = el.scrollWidth > el.clientWidth + 1
    const end = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1
    setHScroll(prev =>
      prev.w === el.scrollWidth && prev.over === over && prev.end === end
        ? prev
        : { w: el.scrollWidth, over, end })
  }, [])

  const onTableScroll = () => {
    if (mirrorRef.current && scrollRef.current)
      mirrorRef.current.scrollLeft = scrollRef.current.scrollLeft
    measureHScroll()
  }
  const onMirrorScroll = () => {
    if (scrollRef.current && mirrorRef.current)
      scrollRef.current.scrollLeft = mirrorRef.current.scrollLeft
  }

  // ── styles ──────────────────────────────────────────────────
  // ── table header & row ──────────────────────────────────────
  const renderHead = () => {
    const Th = (props: Omit<React.ComponentProps<typeof SortTh>, 'current' | 'dir' | 'onSort'>) =>
      <SortTh {...props} current={sortKey} dir={sortDir} onSort={handleSort} />

    return (
      <tr>
        <th className="scr-corner" style={{ ['--scr-w' as string]: '28px' }}>★</th>
        <th className="scr-corner" style={{ ['--scr-w' as string]: '36px' }}>#</th>
        <Th label="종목명" align="l" width={150} />
        <Th label="섹터" align="l" width={46} />
        <Th label="SCORE" sortKey="compositeScore" width={70} tip="7대 팩터 가중합산 종합점수 (0~100)" />
        <Th label="Δ" align="c" width={44} tip="전일 대비 종합점수 변동" />
        <Th label="실적" sortKey="cScore" align="c" width={46} tip="분기실적: 당분기 EPS 전년대비 성장률" />
        <Th label="성장" sortKey="aScore" align="c" width={46} tip="연간성장: 3년 EPS 연평균 성장률 + ROE" />
        <Th label="고가" sortKey="nScore" align="c" width={46} tip="신고가: 52주 고점 근접도 + 돌파 여부" />
        <Th label="수급" sortKey="sScore" align="c" width={46} tip="수급: 시총 희소성 + 거래량 급증도" />
        <Th label="선도" sortKey="lScore" align="c" width={46} tip="선도성: 시장 내 상대강도 순위 (상위일수록 높음)" />
        <Th label="기관" sortKey="iScore" align="c" width={46} tip="기관투자: 외인+기관 10일 순매수 강도" />
        <Th label="종가" sortKey="closePrice" width={78} />
        <Th label="등락률" sortKey="changeRate" width={74} tip="전일 종가 대비 당일 등락률" />
        <Th label="거래량" sortKey="volume" width={64} tip="당일 누적 거래량 (만·천만주)" />
        <Th label="거래대금" sortKey="turnover" width={72} tip="당일 누적 거래대금 (억·천억원)" />
        <Th label="시총" sortKey="marketCap" width={68} />
      </tr>
    )
  }

  // 장중 라이브 시세(빠른 폴링=liveMap)를 배치 아이템 위에 머지. 수급은 상세에서만 실시간 표시.
  const mergeLive = (item: ScreenerItem): ScreenerItem => {
    const q = liveMap[item.ticker]
    if (!q) return item
    return {
      ...item,
      closePrice: q?.price ?? item.closePrice,
      changeRate: q?.changeRate ?? item.changeRate,
      volume: q?.volume ?? item.volume,
      turnover: q?.turnover ?? item.turnover,
    }
  }

  // 장중엔 배치 시세가 '전일 종가 기준'이라 실시간이 붙기 전 전일 등락률·가격이 잠깐 노출됨.
  // 실시간 시세가 아직 없는 종목은 값을 보류(스켈레톤)해 전일값 플래시를 방지. (장 마감 후엔 배치=정답이라 그대로 표시)
  const marketOpen = isLiveOverlayHours()
  const livePending = (_ticker: string) => marketOpen && !liveLoaded

  const renderRow = (item: ScreenerItem, _idx: number) => {
    const grade = scoreGrade(item.compositeScore)
    const isWatched = watchlist.has(item.securityId)
    const pending = livePending(item.ticker)

    const watchBtn = (
      <td className="scr-td scr-star" onClick={e => toggleWatch(item.securityId, e)}>
        <span className={isWatched ? 'scr-star-icon on' : 'scr-star-icon'}>
          {isWatched ? '★' : '☆'}
        </span>
      </td>
    )

    const base = (
      <>
        <td className="scr-td scr-rank">{item.marketRank}</td>
        <td className="scr-td scr-name">
          <div className="scr-name-inner">
            <span className="scr-name-text">{item.name}</span>
            {IS_US && <span className="scr-name-ticker">{item.ticker}</span>}
            {item.breakoutToday === true && <span className="scr-badge-new">NEW</span>}
            <StatusBadges statuses={pending ? null : (liveMap[item.ticker]?.statuses ?? item.statuses)} size="sm" />
          </div>
        </td>
      </>
    )

    const scoreChip = (
      <td className="scr-td scr-grade" style={{ ['--sc-grade' as string]: grade.color }}>
        {Math.round(item.compositeScore)}
        <span className="scr-grade-label">{grade.label}</span>
      </td>
    )

    const deltaCell = (() => {
      const d = item.scoreDelta
      if (d === null || d === undefined) return <td className="scr-td scr-delta">-</td>
      const bold = Math.abs(d) >= 2
      const color = d > 0 ? 'var(--up)' : d < 0 ? 'var(--down)' : 'var(--text-3)'
      const text = d > 0 ? `+${Math.round(d)}` : `${Math.round(d)}`
      return (
        <td className={bold ? 'scr-td scr-delta bold' : 'scr-td scr-delta'}
          style={{ ['--sc-delta' as string]: color }}>
          {text}
        </td>
      )
    })()

    const flash = flashMap[item.ticker]
    return (
      <>
        {watchBtn}
        {base}
        <td className="scr-td scr-sector">{item.sector ?? '·'}</td>
        {scoreChip}
        {deltaCell}
        <ScoreCell value={item.cScore} />
        <ScoreCell value={item.aScore} />
        <ScoreCell value={item.nScore} />
        <ScoreCell value={item.sScore} />
        <ScoreCell value={item.lScore} />
        <ScoreCell value={item.iScore} />
        <td className={'scr-td scr-num' + (flash ? ` flash-${flash}` : '')}>
          {pending ? <span className="cell-skel" /> : fmtPrice(item.closePrice)}
        </td>
        <td className={'scr-td scr-rate' + (flash ? ` flash-${flash}` : '')}
          style={pending ? undefined : { ['--sc-rate' as string]: changeColor(item.changeRate) }}>
          {pending ? <span className="cell-skel" /> : <span>{fmtRate(item.changeRate)}</span>}
        </td>
        <td className="scr-td scr-muted mono">{fmtVolume(item.volume)}</td>
        <td className="scr-td scr-muted">{fmtAmt(item.turnover)}</td>
        <td className="scr-td scr-muted">{fmtMarketCap(item.marketCap)}</td>
      </>
    )
  }

  // ── 모바일 카드 렌더 (좁은 화면 전용) ────────────────────────
  const renderCard = (item: ScreenerItem, _idx: number) => {
    const grade = scoreGrade(item.compositeScore)
    const isWatched = watchlist.has(item.securityId)
    const flash = flashMap[item.ticker]
    const pending = livePending(item.ticker)
    const factors: { k: string; v: number | null }[] = [
      { k: '실적', v: item.cScore }, { k: '성장', v: item.aScore }, { k: '고가', v: item.nScore },
      { k: '수급', v: item.sScore }, { k: '선도', v: item.lScore }, { k: '기관', v: item.iScore },
    ]
    return (
      <div key={item.securityId} className="scard"
        onClick={() => { setSelectedStockId(item.securityId); setViewTab('detail') }}>
        {/* 1행: 순위·종목명·섹터 | 관심·SCORE */}
        <div className="scard-row1">
          <div className="scard-id">
            <div className="scard-name-line">
              <span className="scard-rank">#{item.marketRank}</span>
              <span className="scard-name">{item.name}</span>
              {item.breakoutToday === true && <span className="scard-badge-new">NEW</span>}
              <StatusBadges statuses={pending ? null : (liveMap[item.ticker]?.statuses ?? item.statuses)} size="xs" />
            </div>
            <div className="scard-sub">
              <span className="scard-ticker">{item.ticker}</span>
              {item.sector && <span> · {item.sector}</span>}
            </div>
          </div>
          <div className="scard-right">
            <span className={isWatched ? 'scard-star on' : 'scard-star'}
              onClick={e => toggleWatch(item.securityId, e)}>
              {isWatched ? '★' : '☆'}
            </span>
            <div className="score-ring" style={{
              ['--v' as string]: item.compositeScore,
              ['--gc' as string]: grade.color,
              ['--sr' as string]: '56px',
            }}>
              <b>{Math.round(item.compositeScore)}<small>{grade.label}</small></b>
            </div>
          </div>
        </div>

        {/* 2행: 종가 · 등락률 · 시총 */}
        <div className={'scard-price' + (flash ? ` flash-${flash}` : '')}>
          <span className="scard-close">{pending ? <span className="cell-skel" /> : fmtPrice(item.closePrice)}</span>
          {pending
            ? <span className="scard-rate"><span className="cell-skel" /></span>
            : <span className="scard-rate" style={{ ['--sc-rate' as string]: changeColor(item.changeRate) }}>{fmtRate(item.changeRate)}</span>}
          <span className="scard-vol">거래량 {fmtVolume(item.volume)}</span>
          <span className="scard-cap">시총 {fmtMarketCap(item.marketCap)}</span>
        </div>

        {/* 3행: 팩터 스트립 */}
        <div className="scard-factors">
          {factors.map(f => (
            <div key={f.k} className="scard-factor" style={{ ['--sc-bg' as string]: scoreBg(f.v) }}>
              <div className="scard-factor-k">{f.k}</div>
              <div className="scard-factor-v" style={{ ['--sc-fg' as string]: scoreFg(f.v) }}>
                {f.v !== null ? Math.round(f.v) : '·'}
              </div>
            </div>
          ))}
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
    <div className="screener-error">{error}</div>
  )

  // 실시간 오버레이가 덮어쓰는 필드로 정렬할 땐, 백엔드 정렬(배치 채점일 기준)과
  // 화면 표시(실시간 등락률 등)가 어긋나 "정렬이 안 된 것처럼" 보인다.
  // 이 필드들은 라이브 병합값으로 현재 페이지를 다시 정렬해 표시와 순서를 일치시킨다.
  // (전체 정렬은 백엔드 페이징이 담당 — 장중 실시간 전체 정렬은 보이는 종목 한계상 페이지 단위.)
  const LIVE_SORT_KEYS = new Set<SortKey>([
    'changeRate', 'closePrice', 'turnover', 'volume',
  ])
  // 정렬 기준값 = 화면 표시(라이브 시세)와 동일.
  const liveSortVal = (item: ScreenerItem, key: SortKey): number | null => {
    return item[key] as number | null
  }
  const displayItems = useMemo(() => {
    const arr = items
      .filter(i => !showWatchOnly || watchlist.has(i.securityId))
      .filter(i => !showBreakoutOnly || i.breakoutToday)
    const liveActive = Object.keys(liveMap).length > 0
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, showWatchOnly, showBreakoutOnly, watchlist, sortKey, sortDir, liveMap])

  // 표 내용·뷰포트 변경 시 가로 스크롤 상태 재측정 (데스크톱 표에서만 의미)
  useEffect(() => {
    measureHScroll()
    window.addEventListener('resize', measureHScroll)
    return () => window.removeEventListener('resize', measureHScroll)
  }, [measureHScroll, displayItems, isMobile, loading, viewTab])

  const hasActiveFilter = sector !== '' || capRange !== 'all' || query !== '' || minScore > 0 || showWatchOnly || showBreakoutOnly
  const activeFilterCount = [sector !== '', capRange !== 'all', query !== '', minScore > 0, showWatchOnly, showBreakoutOnly].filter(Boolean).length

  // ── sector stats for dashboard ─────────────────────────────
  const sectorStats = useMemo(() => {
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
  }, [items])

  const topSector = useMemo(() => sectorStats.length > 0
    ? sectorStats.reduce((best, s) => s.avgChange > best.avgChange ? s : best, sectorStats[0])
    : null, [sectorStats])

  const toggleTheme = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('nextpick_theme', next)
    setTheme(next as 'dark' | 'light')
  }

  return (
    <div className="screener-page">
      {showGuide && <GuidePopup onClose={closeGuide} />}

      {/* 프리미엄 게이팅 모달 */}
      {showPremiumModal && (
        <div className="modal-overlay z-top" onClick={() => setShowPremiumModal(null)}>
          <div className="modal-card premium-card" onClick={e => e.stopPropagation()}>
            <div className="premium-icon">✦</div>
            <div className="premium-title">
              {showPremiumModal === 'watchlist'
                ? '관심종목은 프리미엄에서 무제한으로'
                : 'PDF 리포트는 프리미엄 전용'}
            </div>
            <div className="premium-desc">
              {showPremiumModal === 'watchlist'
                ? `무료 플랜은 관심종목을 최대 ${FREE_WATCHLIST_LIMIT}개까지 등록할 수 있습니다.\n프리미엄으로 업그레이드하면 무제한으로 이용하실 수 있습니다.`
                : '종목 상세 PDF 리포트는 프리미엄 전용 기능입니다.'}
            </div>
            <div className="premium-actions">
              <button onClick={() => setShowPremiumModal(null)} className="btn-ghost">
                닫기
              </button>
              <button onClick={() => { setShowPremiumModal(null); navigate('/premium') }} className="btn-fill">
                프리미엄 알아보기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MacroTicker (full-width top strip) ═════════════════ */}
      <MacroTicker />

      {/* ══ New Header ══════════════════════════════════════════ */}
      <header className="nav-bar">
        {/* Left: Logo + tagline */}
        <div className="nav-left">
          <span className="nav-brand" onClick={() => setShowGuide(true)}>
            <span className="nav-brand-dot" />
            NEXT<span className="brand-pick">PICK</span>
          </span>
        </div>

        {/* Center: Search */}
        <div className="nav-search">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="nav-search-icon">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            className="nav-search-input"
            placeholder="종목명 · 코드 · 섹터 검색"
            value={query}
            onChange={e => handleQuery(e.target.value)}
          />
        </div>

        {/* Right: theme toggle, gacha, visitor */}
        <div className="nav-right">
          {/* Gacha */}
          <button onClick={() => setShowGacha(true)} className="nav-gacha">PICK</button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
            className="theme-toggle"
          >
            <span className="theme-knob" />
          </button>

          {/* Visitor count */}
          {visitCount !== null && (
            <span className="nav-meta">👥 {visitCount.toLocaleString()}</span>
          )}

          {/* Planner link */}
          <button onClick={() => navigate('/calc')} className="nav-planner">플래너</button>
        </div>

        {/* Mobile right */}
        <div className="nav-right-mobile">
          <button onClick={toggleTheme} className="theme-toggle">
            <span className="theme-knob" />
          </button>
        </div>
      </header>

      {/* ══ Body: sidebar + main content ═══════════════════════ */}
      <div className="screener-body">

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
          collapsed={sbCollapsed}
          onToggleCollapse={toggleSidebar}
        />

        {/* Main content area */}
        <main className={isMobile ? 'screener-main mobile-pad' : 'screener-main'}>

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
          liveLoaded={liveLoaded}
          onStockClick={(id) => { setSelectedStockId(id); setMainTab('screener'); setViewTab('detail') }}
        />
      )}

      {mainTab === 'watchlist' && (
        <RankingView
          items={items.filter(i => watchlist.has(i.securityId))}
          loading={loading}
          liveMap={liveMap}
          liveLoaded={liveLoaded}
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
          <div className="m-banner" style={{ ['--mb-bg' as string]: bg, ['--mb-bd' as string]: border }}
            title={`시장 신호 = 현재 목록 종목들의 평균 시장방향(M) 점수 ${Math.round(avgM)}점 기준.\n· 60↑ 매수 구간(모멘텀 양호)  · 40~59 관망(추세 불확실)  · 40미만 약세(하락 압력).\nM점수는 지수 추세·시장 폭 등 전체 시장 방향을 나타내며, 개별 종목이 아니라 시장 전반의 신호입니다.`}>
            <span className="m-banner-title">
              {dot} 시장 신호 · {label}
              <span className="m-banner-info" aria-hidden="true">ⓘ</span>
            </span>
            <span className="m-banner-desc">{desc} · 평균 M {Math.round(avgM)}</span>
          </div>
        )
      })()}

      {mainTab === 'screener' && <>
      {/* ══ Section 2: 필터 패널 ════════════════════════════════ */}
      <div className="screener-filter-wrap">
        <div className="filter-panel">
          {/* 패널 헤더 */}
          <div className="filter-panel-head">
            <span className="filter-panel-title">
              스크리너 필터
              {activeFilterCount > 0 && (
                <span className="filter-count-badge">{activeFilterCount}개 적용중</span>
              )}
            </span>
            {hasActiveFilter && (
              <button onClick={() => { setSector(''); setCapRange('all'); setQuery(''); setMinScore(0); setShowWatchOnly(false); setShowBreakoutOnly(false); setPage(0) }}
                className="filter-reset">
                초기화
              </button>
            )}
          </div>

          {/* 필터 그리드 */}
          <div className="filter-grid">
            {/* 섹터 */}
            <FilterCell label="섹터">
              <select value={sector} onChange={e => { setSector(e.target.value); setPage(0) }}
                className="filter-select">
                <option value="">전체</option>
                {sectors.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </FilterCell>

            {/* 시가총액 */}
            <FilterCell label="시가총액">
              <div className="chip-row">
                {(['all', 'large', 'mid', 'small'] as const).map(k => (
                  <ChipBtn key={k} on={capRange === k} onClick={() => { setCapRange(k); setPage(0) }}
                    label={k === 'all' ? '전체' : k === 'large' ? capLargeLabel : k === 'mid' ? '중형' : '소형'} />
                ))}
              </div>
            </FilterCell>

            {/* 검색 */}
            <FilterCell label="종목검색">
              <input placeholder="종목명 / 티커" value={query}
                onChange={e => handleQuery(e.target.value)}
                className="filter-input" />
            </FilterCell>

            {/* SCORE 최소 */}
            <FilterCell label="SCORE 최소">
              <div className="chip-row">
                {([0, 60, 70, 80] as const).map(v => (
                  <ChipBtn key={v} on={minScore === v} onClick={() => { setMinScore(v); setPage(0) }}
                    label={v === 0 ? '전체' : String(v)} />
                ))}
              </div>
            </FilterCell>

            {/* 정렬 */}
            <FilterCell label="정렬">
              <div className="chip-row wrap">
                {([
                  ['compositeScore', '종합점수'],
                  ['turnover', '거래대금'],
                  ['marketCap', '시총'],
                  ['changeRate', '등락률'],
                ] as const).map(([k, lbl]) => (
                  <ChipBtn key={k} on={sortKey === k} onClick={() => { setSortKey(k as SortKey); setSortDir('desc'); setPage(0) }} label={lbl} />
                ))}
              </div>
            </FilterCell>

            {/* 관심종목 */}
            <FilterCell label="관심종목">
              <ChipBtn wide tone="purple" on={showWatchOnly} onClick={() => setShowWatchOnly(v => !v)}
                label={showWatchOnly ? '★ 관심종목만' : '☆ 전체보기'} />
              {showWatchOnly && <span className="filter-note">현재 페이지 내 필터</span>}
              <ChipBtn wide tone="green" on={showBreakoutOnly} onClick={() => { setShowBreakoutOnly(v => !v); setPage(0) }}
                label={showBreakoutOnly ? '🚀 돌파 종목만' : '⬆ 오늘 돌파'} />
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
          <div className="rising-wrap">
            <div className="rising-inner"
              title="이번주 종합 SCORE가 가장 많이 오른 종목(1주 전 대비 점수 변화). 주가 등락률이 아니라 팩터 점수 상승폭입니다. 칩의 +N = 종합점수 +N점.">
              <span className="rising-label">이번주 점수↑ <span className="rising-info" aria-hidden="true">ⓘ</span></span>
              <div className="rising-chips">
                {risers.map(item => (
                  <div key={item.securityId} className="rising-chip"
                    title={`${item.name} · 종합점수 1주간 +${Math.round(item.scoreDelta ?? 0)}점`}
                    onClick={() => { setSelectedStockId(item.securityId); setViewTab('detail') }}>
                    <span className="rising-chip-name">{item.name}</span>
                    <span className="rising-chip-delta">+{Math.round(item.scoreDelta ?? 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ══ Section 3: 결과바 + 뷰탭 (sticky) ══════════════════ */}
      <div className="result-bar">
        {/* 뷰 탭 */}
        <div className="view-tabs">
          <button onClick={() => setViewTab('table')} className={viewTab === 'table' ? 'view-tab on' : 'view-tab'}>
            스크리너
          </button>
          <div className="view-tab-tip-wrap">
            <button
              onClick={() => { if (selectedStockId) setViewTab('detail') }}
              className={'view-tab detail'
                + (viewTab === 'detail' ? ' on' : '')
                + (selectedStockId ? '' : ' disabled')}>
              종목 상세
            </button>
            {!selectedStockId && (
              <div className="view-tab-tip">종목을 선택해주세요</div>
            )}
          </div>
        </div>

        {/* 결과 카운트 + 행수 */}
        <div className="result-meta">
          {/* 라이브 상태 배지 — 실시간 / 지연(장중 오류) / 종가(장외) 3-상태 */}
          {(() => {
            const live = Object.keys(liveMap).length > 0
            const state = live ? 'live' : (isLiveOverlayHours() ? 'delayed' : 'batch')
            const c = state === 'live'
              ? { text: '● 실시간', tip: '장중 실시간 시세 반영 중' }
              : state === 'delayed'
              ? { text: '● 지연', tip: '장중이나 실시간 시세 지연/오류 — 종가 기준 표시 중 (KIS 쿼터·네트워크 확인)' }
              : { text: '종가', tip: '장 마감/장외 — 종가(EOD) 기준' }
            return (
              <span className={`live-badge ${state}`} title={c.tip}>{c.text}</span>
            )
          })()}
          {!loading && (
            <span className="result-count">
              <span className="result-count-num">{total.toLocaleString()}</span>
              {' '}종목
              {hasActiveFilter && <span className="result-count-filter"> (필터 적용)</span>}
            </span>
          )}
          <select value={size} onChange={e => handleSize(Number(e.target.value))}
            className="filter-select sm">
            {[30, 50, 100].map(n => <option key={n} value={n}>{n}행</option>)}
          </select>
        </div>
      </div>

      {/* ── 활성 필터 칩 ─────────────────────────────────────── */}
      {hasActiveFilter && (() => {
        const capLabel: Record<string, string> = { large: capLargeLabel, mid: '중형', small: '소형' }
        const chips: { label: string; clear: () => void }[] = []
        if (query) chips.push({ label: `검색 "${query}"`, clear: () => handleQuery('') })
        if (sector) chips.push({ label: `섹터 · ${sector}`, clear: () => { setSector(''); setPage(0) } })
        if (capRange !== 'all') chips.push({ label: `시총 · ${capLabel[capRange]}`, clear: () => { setCapRange('all'); setPage(0) } })
        if (minScore > 0) chips.push({ label: `SCORE ≥ ${minScore}`, clear: () => { setMinScore(0); setPage(0) } })
        if (showWatchOnly) chips.push({ label: '★ 관심종목', clear: () => setShowWatchOnly(false) })
        if (showBreakoutOnly) chips.push({ label: '⤊ 오늘 돌파', clear: () => setShowBreakoutOnly(false) })
        const clearAll = () => { setSector(''); setCapRange('all'); setQuery(''); setMinScore(0); setShowWatchOnly(false); setShowBreakoutOnly(false); setPage(0) }
        return (
          <div className="filter-chips">
            <span className="filter-chips-label">필터</span>
            {chips.map((c, i) => (
              <button key={i} onClick={c.clear} title="제거" className="filter-chip">
                {c.label}
                <span className="filter-chip-x">×</span>
              </button>
            ))}
            <button onClick={clearAll} className="filter-chip-clear">전체 해제</button>
          </div>
        )
      })()}

      {/* ── Detail panel (inline) ───────────────────────────── */}
      {viewTab === 'detail' && selectedStockId && (
        <Suspense fallback={<div className="detail-fallback"><span className="spinner" /> 상세 로딩 중...</div>}>
          <StockDetailPanel
            securityId={selectedStockId}
            onSelectStock={(id) => setSelectedStockId(id)}
            onBack={() => window.history.back()}
          />
        </Suspense>
      )}

      {/* ── Table area ───────────────────────────────────────── */}
      {viewTab !== 'detail' && <><div className={`table-wrap${hScroll.over && !hScroll.end ? ' has-more' : ''}`}>
        <div ref={scrollRef} onScroll={onTableScroll} className="hide-scrollbar scr-scroll">
          {loading ? (
            <div className="loading-box">
              <span className="spinner" />
              종목 데이터 불러오는 중…
            </div>
          ) : isMobile ? (
            /* 모바일/앱: 카드 리스트 (가로 스크롤 없는 세로 레이아웃) */
            <div className="scr-cards">
              {displayItems.map((item, idx) => renderCard(mergeLive(item), idx))}
            </div>
          ) : (
            <table className="scr-table">
              <thead>{renderHead()}</thead>
              <tbody>
                {displayItems.map((item, idx) => (
                  <tr key={item.securityId}
                    onClick={() => { setSelectedStockId(item.securityId); setViewTab('detail') }}>
                    {renderRow(mergeLive(item), idx)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!loading && items.length === 0 && (
            <div className="scr-empty">검색 결과 없음</div>
          )}
        </div>

        {/* 하단 고정 가로 스크롤바 — 세로 스크롤 중에도 뷰포트 하단에 붙어 항상 조작 가능
            (넓은 테이블 전용 — 모바일 카드 뷰에선 숨김) */}
        {!isMobile && hScroll.over && (
          <div ref={mirrorRef} onScroll={onMirrorScroll} className="sticky-hscroll hscroll-mirror">
            <div className="hscroll-mirror-inner" style={{ ['--mirror-w' as string]: `${hScroll.w}px` }} />
          </div>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────── */}
      {!loading && totalPages > 1 && (
        <div className="pagination">
          <span className="pagination-info">
            {total.toLocaleString()}종목 · {page + 1}/{totalPages}페이지
          </span>
          <div className="pagination-nums">
            <PgBtn label="«" onClick={() => setPage(0)} disabled={page === 0} />
            <PgBtn label="‹" onClick={() => setPage(p => p - 1)} disabled={page === 0} />
            {pageNums.map(p => (
              <PgBtn key={p} label={String(p + 1)} onClick={() => setPage(p)} active={p === page} />
            ))}
            <PgBtn label="›" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} />
            <PgBtn label="»" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} />
          </div>
          <div className="pg-spacer" />
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
      <div className="filter-cell-label"><span>{label}</span></div>
      <div className="filter-cell-body">{children}</div>
    </>
  )
}

function PgBtn({ label, onClick, disabled, active }: {
  label: string; onClick: () => void; disabled?: boolean; active?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled} className={active ? 'pg-btn on' : 'pg-btn'}>
      {label}
    </button>
  )
}

// 필터/정렬 공통 칩 버튼. tone: on 상태 색 변형(blue 기본/purple/green).
function ChipBtn({ label, on, onClick, wide, tone }: {
  label: React.ReactNode; on: boolean; onClick: () => void; wide?: boolean; tone?: 'purple' | 'green'
}) {
  const cls = 'chip-btn' + (wide ? ' wide' : '') + (on ? ' on' : '') + (on && tone ? ` ${tone}` : '')
  return <button onClick={onClick} className={cls}>{label}</button>
}
