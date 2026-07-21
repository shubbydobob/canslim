import { useEffect, useRef, useState, useMemo } from 'react'
import { fmtPrice, fmtRate, fmtMarketCap, fmtAmt, fmtFinAmt, fmtVol, fmtFlow } from '../utils/format'
import { scoreGrade } from '../utils/factors'
import { isPremium, isLoggedIn } from '../api/auth'
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ComposedChart, Line,
} from 'recharts'
import { fetchStockScore, fetchStockHistory, fetchStockFinancials, fetchStockNews, fetchSectorPeers, fetchCorrelations, fetchLiveQuotes, fetchInvestorFlow, fetchStockPrices } from '../api/client'
import type { NewsItem, SectorPeer, CorrelationStock, LiveQuote, InvestorFlow } from '../api/client'
import PriceChart from './PriceChart'
import TradingViewChart from './TradingViewChart'
import StatusBadges from './StatusBadges'
import type { ScreenerItem, ScoreHistory, FinancialRecord, PriceBar } from '../types'

type ScoreKey = 'cScore' | 'aScore' | 'nScore' | 'sScore' | 'lScore' | 'iScore' | 'mScore'

const FACTORS: { key: ScoreKey; label: string; desc: string; color: string }[] = [
  { key: 'cScore', label: '1', desc: '분기실적',  color: '#f6ad55' },
  { key: 'aScore', label: '2', desc: '연간성장',  color: '#68d391' },
  { key: 'nScore', label: '3', desc: '신고가',    color: '#76e4f7' },
  { key: 'sScore', label: '4', desc: '수급강도',  color: '#b794f4' },
  { key: 'lScore', label: '5', desc: '상대강도',  color: '#fc8181' },
  { key: 'iScore', label: '6', desc: '기관수급',  color: '#63b3ed' },
  { key: 'mScore', label: '7', desc: '시장방향',  color: '#d6bcfa' },
]

function FactorCard({ label, desc, value, color }: {
  label: string; desc: string; value: number | null; color: string
}) {
  const pct = value ?? 0
  const { label: grade, color: gc } = scoreGrade(value)
  return (
    <div className="factor-card" style={{
      ['--fc-color' as string]: color,
      ['--fc-tint' as string]: color + '22',
      ['--fc-bd' as string]: color + '44',
      ['--fc-val' as string]: value !== null ? color : '#484f58',
      ['--fc-grade' as string]: gc,
      ['--fc-pct' as string]: `${pct}%`,
      ['--fc-fill' as string]: value !== null ? color : 'transparent',
    }}>
      <div className="factor-card-head">
        <div>
          <span className="factor-badge">{label}</span>
          <div className="factor-desc">{desc}</div>
        </div>
        <div className="factor-val-wrap">
          <div className="factor-val">
            {value !== null ? value.toFixed(1) : '—'}
          </div>
          <div className="factor-grade">{grade}</div>
        </div>
      </div>
      <div className="factor-track">
        <div className="factor-fill" />
      </div>
    </div>
  )
}

const FinTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map((p: any) => (
        <div key={String(p.dataKey)} className="chart-tooltip-row" style={{ ['--tt-color' as string]: p.fill }}>
          <span>{p.name}</span>
          <span className="chart-tooltip-val">{p.value != null ? p.value.toLocaleString() + '억' : '—'}</span>
        </div>
      ))}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-title">
      {children}
    </div>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className ? `card ${className}` : 'card'}>
      {children}
    </div>
  )
}

interface Props {
  securityId: number
  onSelectStock?: (id: number) => void
  onBack?: () => void
}

export default function StockDetailPanel({ securityId, onSelectStock, onBack }: Props) {
  const id = securityId

  const [stock, setStock] = useState<ScreenerItem | null>(null)
  const [history, setHistory] = useState<ScoreHistory[]>([])
  const [financials, setFinancials] = useState<FinancialRecord[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [finTab, setFinTab] = useState<'annual' | 'quarter'>('annual')
  const [peers, setPeers] = useState<SectorPeer[]>([])
  const [correlations, setCorrelations] = useState<CorrelationStock[]>([])
  const [showPremiumModal, setShowPremiumModal] = useState(false)
  const [watched, setWatched] = useState(false)
  const [live, setLive] = useState<LiveQuote | null>(null)
  const [investor, setInvestor] = useState<InvestorFlow | null>(null)
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null)
  const [prices, setPrices] = useState<PriceBar[]>([])
  const [chartMode, setChartMode] = useState<'tv' | 'native'>('tv')
  const prevPxRef = useRef<number | null>(null)
  const userIsPremium = isPremium()
  const userIsLoggedIn = isLoggedIn()

  useEffect(() => {
    try {
      const raw = localStorage.getItem('screener_watchlist')
      const ids: number[] = raw ? JSON.parse(raw) : []
      setWatched(ids.includes(id))
    } catch { setWatched(false) }
  }, [id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchStockScore(id), fetchStockHistory(id), fetchStockFinancials(id)])
      .then(([s, h, f]) => {
        if (cancelled) return
        setStock(s)
        setHistory([...h].reverse())
        setFinancials(f)
        fetchStockNews(s.ticker).then(r => { if (!cancelled) setNews(r) })
        fetchSectorPeers(id).then(r => { if (!cancelled) setPeers(r) })
        fetchCorrelations(id).then(r => { if (!cancelled) setCorrelations(r) })
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  // 기술적 분석용 일별 가격 (이동평균·52주 레인지·거래량 계산). 오름차순.
  useEffect(() => {
    let cancelled = false
    setPrices([])
    fetchStockPrices(id, 9999).then(d => { if (!cancelled) setPrices(d) })
    return () => { cancelled = true }
  }, [id])

  // 장중 실시간 시세 오버레이 (해당 종목 1건, 1분 폴링). 장외엔 백엔드가 빈 결과.
  useEffect(() => {
    const ticker = stock?.ticker
    if (!ticker) return
    let cancelled = false
    const load = () => {
      fetchLiveQuotes([ticker]).then(m => {
        if (cancelled) return
        const q = m[ticker] ?? null
        const np = q?.price
        const pp = prevPxRef.current
        if (np != null && pp != null && np !== pp) {
          setPriceFlash(np > pp ? 'up' : 'down')
          setTimeout(() => { if (!cancelled) setPriceFlash(null) }, 900)
        }
        if (np != null) prevPxRef.current = np
        setLive(q)
      })
      fetchInvestorFlow(ticker).then(inv => { if (!cancelled) setInvestor(inv) })
    }
    load()
    const pid = setInterval(load, 15_000)   // 15초 폴링
    return () => { cancelled = true; clearInterval(pid) }
  }, [stock?.ticker])

  // ── 기술적 지표 (일별 가격에서 파생: 이동평균·52주 레인지·거래량) ──
  const tech = useMemo(() => {
    if (prices.length < 20 || !stock) return null
    const bars = prices
    const closes = bars.map(b => b.close).filter((v): v is number => v != null)
    if (closes.length < 20) return null
    const px = stock.closePrice ?? closes[closes.length - 1]
    const ma = (n: number) => closes.length < n ? null
      : closes.slice(-n).reduce((a, b) => a + b, 0) / n
    const ma20 = ma(20), ma60 = ma(60), ma120 = ma(120)
    const win = bars.slice(-252)
    const highs = win.map(b => b.high).filter((v): v is number => v != null)
    const lows = win.map(b => b.low).filter((v): v is number => v != null)
    const hi52 = highs.length ? Math.max(...highs) : (stock.weekHigh52 ?? null)
    const lo52 = lows.length ? Math.min(...lows) : null
    const pos52 = hi52 != null && lo52 != null && hi52 > lo52
      ? ((px - lo52) / (hi52 - lo52)) * 100 : null
    const vols = bars.map(b => b.volume).filter((v): v is number => v != null)
    const volAvg20 = vols.length >= 20 ? vols.slice(-20).reduce((a, b) => a + b, 0) / 20 : null
    const volLast = stock.volume ?? (vols.length ? vols[vols.length - 1] : null)
    const volRatio = volAvg20 && volLast != null && volAvg20 > 0 ? volLast / volAvg20 : null
    let align: 'up' | 'down' | 'mixed' | null = null
    if (ma20 != null && ma60 != null && ma120 != null) {
      if (px > ma20 && ma20 > ma60 && ma60 > ma120) align = 'up'
      else if (px < ma20 && ma20 < ma60 && ma60 < ma120) align = 'down'
      else align = 'mixed'
    }
    return { px, ma20, ma60, ma120, hi52, lo52, pos52, volAvg20, volLast, volRatio, align }
  }, [prices, stock])

  // ── 스코어 히스토리 히트맵 (팩터 × 시간, 균등 샘플 최대 16열) ──
  const heat = useMemo(() => {
    if (history.length < 2) return null
    const N = Math.min(history.length, 16)
    const step = (history.length - 1) / (N - 1)
    return Array.from({ length: N }, (_, i) => history[Math.round(i * step)])
  }, [history])

  if (loading) return (
    <div className="detail-loading">
      로딩 중...
    </div>
  )
  if (error || !stock) return (
    <div className="detail-error">
      <div className="detail-error-msg">{error ?? '데이터 없음'}</div>
      {onBack && <button onClick={onBack} className="detail-error-back">← 목록으로</button>}
    </div>
  )

  const composite = stock.compositeScore
  const cColor = composite >= 85 ? '#68d391' : composite >= 70 ? '#9ae6b4' : composite >= 55 ? '#f6ad55' : '#fc8181'

  const annualFin = financials
    .filter(f => f.periodType === 'ANNUAL')
    .slice(0, 6)
    .reverse()
    .map(f => ({
      label: `${f.fiscalYear}`,
      매출액: fmtFinAmt(f.revenue),
      영업이익: fmtFinAmt(f.operatingIncome),
      순이익: fmtFinAmt(f.netIncome),
      ROE: f.roe != null ? Math.round(f.roe * 1000) / 10 : null,
    }))

  const quarterRaw = financials
    .filter(f => f.periodType === 'QUARTER')
    .slice(0, 8)
    .reverse()

  const quarterFin = quarterRaw.map((f) => {
    const prev = quarterRaw.find(p => p.fiscalYear === f.fiscalYear - 1 && p.fiscalQuarter === f.fiscalQuarter)
    const yoyGrowth = prev?.eps != null && prev.eps !== 0 && f.eps != null
      ? Math.round(((f.eps - prev.eps) / Math.abs(prev.eps)) * 1000) / 10
      : null
    return {
      label: `${f.fiscalYear}Q${f.fiscalQuarter}`,
      EPS: f.eps != null ? Math.round(f.eps) : null,
      전년동기성장: yoyGrowth,
    }
  })

  const hasFinancials = annualFin.length > 0 || quarterFin.length > 0

  const handleSelectPeer = (peerId: number) => {
    if (onSelectStock) onSelectStock(peerId)
  }

  return (
    <div className="detail-panel">
      {/* ── Top info bar ── */}
      <div className="detail-topbar">
        {onBack && (
          <button onClick={onBack} className="detail-topbar-back">← 목록</button>
        )}
        {onBack && <span className="detail-topbar-sep">|</span>}
        <span className="detail-topbar-ticker">{stock.ticker}</span>
        <span className="detail-topbar-name">{stock.name}</span>
        <div className="detail-topbar-actions">
          <button
            onClick={() => {
              if (!userIsLoggedIn || !userIsPremium) { setShowPremiumModal(true) }
              else { window.print() }
            }}
            className={userIsPremium ? 'detail-pdf-btn on' : 'detail-pdf-btn'}
          >PDF</button>
          <button
            onClick={() => {
              const next = !watched
              setWatched(next)
              try {
                const raw = localStorage.getItem('screener_watchlist')
                const ids: number[] = raw ? JSON.parse(raw) : []
                const updated = next ? [...new Set([...ids, id])] : ids.filter(x => x !== id)
                localStorage.setItem('screener_watchlist', JSON.stringify(updated))
              } catch {}
            }}
            className={watched ? 'detail-watch-btn on' : 'detail-watch-btn'}
          >{watched ? '★' : '☆'}</button>
        </div>
      </div>

      {/* Premium modal */}
      {showPremiumModal && (
        <div className="modal-overlay z-top" onClick={() => setShowPremiumModal(false)}>
          <div className="modal-card premium-card" onClick={e => e.stopPropagation()}>
            <div className="premium-title">PDF 리포트는 프리미엄 전용</div>
            <div className="premium-desc">
              프리미엄으로 업그레이드하면 모든 종목의 상세 분석 리포트를 다운로드할 수 있습니다.
            </div>
            <div className="premium-actions">
              <button onClick={() => setShowPremiumModal(false)} className="btn-ghost">닫기</button>
              <button onClick={() => { setShowPremiumModal(false); window.location.href = '/premium' }} className="btn-fill">프리미엄 알아보기</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Hero ── */}
      <div className="detail-hero">
        <div>
          <div className="det-hero-meta">
            {stock.market} · {stock.scoreDate}
            {stock.sector && <span className="sector">{stock.sector}</span>}
          </div>
          <div className="det-hero-name">{stock.name}</div>
          <div className="det-hero-tags">
            <span className="det-ticker">{stock.ticker}</span>
            {stock.breakoutToday && <span className="det-tag breakout">N 돌파</span>}
            {stock.baseDays != null && stock.baseDays > 0 && (
              <span className="det-tag base">베이스 {stock.baseDays}일</span>
            )}
            {stock.scoreDelta != null && Math.abs(stock.scoreDelta) >= 1 && (
              <span className="det-tag delta" style={{
                ['--tag-bg' as string]: stock.scoreDelta > 0 ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                ['--tag-bd' as string]: stock.scoreDelta > 0 ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)',
                ['--tag-fg' as string]: stock.scoreDelta > 0 ? '#4ade80' : '#f87171',
              }}>{stock.scoreDelta > 0 ? '+' : ''}{stock.scoreDelta.toFixed(1)}</span>
            )}
            <StatusBadges statuses={live?.statuses ?? stock.statuses} size="sm" />
          </div>
        </div>
        <div className="det-hero-right">
          <div className="det-hero-score-label">COMPOSITE SCORE</div>
          <div className="score-ring" style={{
            ['--v' as string]: composite,
            ['--gc' as string]: cColor,
            ['--ring-bg' as string]: 'var(--bg-base)',
          }}>
            <b>{Math.round(composite)}<small>{scoreGrade(composite).label}</small></b>
          </div>
          <div className="det-hero-rank">
            Rank <b>{stock.marketRank}</b>{' · '}Top <b>{(100 - stock.marketPercentile * 100).toFixed(1)}%</b>
          </div>
        </div>
      </div>

      {/* ── 가격 정보 바 ── */}
      <div className="detail-price-bar">
        {(() => {
          // 장중 라이브 시세 오버레이 (배치값 위에 머지)
          const liveClose = live?.price ?? stock.closePrice
          const liveRate  = live?.changeRate ?? stock.changeRate
          const liveVol   = live?.volume ?? stock.volume
          const liveTurn  = live?.turnover ?? stock.turnover
          return [
          { label: '현재가', value: fmtPrice(liveClose), mono: true },
          { label: '등락률', value: fmtRate(liveRate), color: liveRate !== null ? (liveRate > 0 ? 'var(--up)' : liveRate < 0 ? 'var(--down)' : 'var(--text-3)') : 'var(--text-3)' },
          { label: '52주 신고가', value: fmtPrice(stock.weekHigh52) },
          { label: '시가총액', value: fmtMarketCap(stock.marketCap) },
          { label: '거래대금', value: fmtAmt(liveTurn) },
          { label: '거래량', value: fmtVol(liveVol) },
          ]
        })().map(({ label, value, color, mono }) => {
          const doFlash = priceFlash && (label === '현재가' || label === '등락률')
          return (
          <div key={label} className={'det-pcell' + (doFlash ? ` flash-${priceFlash}` : '')}>
            <div className="det-cell-label">{label}</div>
            <div className={'det-cell-value' + (mono ? ' mono' : '')}
              style={color ? { ['--dc' as string]: color } : undefined}>{value}</div>
          </div>
          )
        })}
      </div>


      {/* ── 투자지표 (PER·PBR·ROE·EPS, 최근 연간 기준) ── */}
      {(() => {
        const latestAnnual = financials.find(f => f.periodType === 'ANNUAL')
        const roeFrac = latestAnnual?.roe ?? null                 // 분수 (0.15 = 15%)
        const px = live?.price ?? stock.closePrice
        const posv = (v?: number | null) => (v != null && v > 0) ? v : null
        // 우선순위: KIS 실시간(장중) → KIS EOD 배치(장외, stock.per/pbr) → 재무 기반 근사
        const eps = posv(live?.eps) ?? posv(stock.eps) ?? latestAnnual?.eps ?? null
        const per = posv(live?.per) ?? posv(stock.per) ?? ((eps != null && eps > 0 && px != null) ? px / eps : null)
        const pbr = posv(live?.pbr) ?? posv(stock.pbr) ?? ((per != null && roeFrac != null) ? per * roeFrac : null)
        const kisLive = posv(live?.per) != null || posv(live?.pbr) != null
        const kisBatch = !kisLive && (posv(stock.per) != null || posv(stock.pbr) != null)
        const cells: { label: string; value: string; pos?: boolean; mono?: boolean }[] = [
          { label: 'PER', value: per != null ? `${per.toFixed(1)}배` : '—' },
          { label: 'PBR', value: pbr != null ? `${pbr.toFixed(2)}배` : '—' },
          { label: 'ROE', value: roeFrac != null ? `${(roeFrac * 100).toFixed(1)}%` : '—', pos: roeFrac != null && roeFrac >= 0.15 },
          { label: 'EPS', value: eps != null ? fmtPrice(Math.round(eps)) : '—', mono: true },
        ]
        if (cells.every(c => c.value === '—')) return null
        return (
          <div className="metric-block">
            <div className="metric-section-head">
              <span className="metric-section-title">투자지표</span>
              <span className="metric-section-sub">{kisLive ? 'KIS 실시간' : kisBatch ? 'KIS 종가' : '최근 연간 · 근사'}</span>
            </div>
            <div className="metric-strip">
              {cells.map(({ label, value, pos, mono }) => (
                <div key={label} className="metric-cell">
                  <div className="metric-cell-label">{label}</div>
                  <div className={'metric-cell-value' + (mono ? ' mono' : '') + (pos ? ' pos' : '')}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── 매매 시그널 ── */}
      {(() => {
        const signals: { text: string; color: string }[] = []
        let verdict: { label: string; color: string; bg: string; border: string }
        if (composite >= 80) {
          verdict = { label: '강력 매수 후보', color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.3)' }
        } else if (composite >= 65) {
          verdict = { label: '매수 관심 구간', color: '#86efac', bg: 'rgba(134,239,172,0.07)', border: 'rgba(134,239,172,0.25)' }
        } else if (composite >= 50) {
          verdict = { label: '관찰 중', color: '#fabd44', bg: 'rgba(250,189,68,0.07)', border: 'rgba(250,189,68,0.25)' }
        } else {
          verdict = { label: '진입 보류', color: '#f87171', bg: 'rgba(248,113,113,0.07)', border: 'rgba(248,113,113,0.25)' }
        }
        if (stock.breakoutToday) signals.push({ text: '오늘 52주 신고가 돌파 — 브레이크아웃 시그널', color: '#4ade80' })
        if (stock.baseDays != null && stock.baseDays >= 15) signals.push({ text: `${stock.baseDays}일 베이스 구축 — 에너지 축적 후 상승 준비`, color: '#86efac' })
        if ((stock.cScore ?? 0) >= 70) signals.push({ text: `분기 실적 강세 (C=${stock.cScore?.toFixed(0)}) — EPS 뚜렷한 성장`, color: '#f6ad55' })
        if ((stock.aScore ?? 0) >= 60) signals.push({ text: `연간 성장 견고 (A=${stock.aScore?.toFixed(0)}) — 3개년 복리 성장`, color: '#68d391' })
        if ((stock.iScore ?? 0) >= 60) signals.push({ text: `기관·외인 순매수 강세 (I=${stock.iScore?.toFixed(0)}) — 스마트머니 유입`, color: '#63b3ed' })
        if ((stock.sScore ?? 0) >= 70) signals.push({ text: `수급 강도 우수 (S=${stock.sScore?.toFixed(0)}) — 상승 시 거래량 증가`, color: '#b794f4' })
        if ((stock.lScore ?? 0) >= 70) signals.push({ text: `업종 내 선도주 (L=${stock.lScore?.toFixed(0)}) — 상대강도 상위권`, color: '#fc8181' })
        if ((stock.mScore ?? 0) < 4) signals.push({ text: `시장 약세 국면 (M=${stock.mScore?.toFixed(0)}) — 신규 진입 주의`, color: '#f87171' })
        if (stock.cScore === null) signals.push({ text: '분기 실적 데이터 미확보 — C 점수 산출 불가', color: '#484f58' })
        if (stock.aScore === null) signals.push({ text: '연간 성장 데이터 미확보 — A 점수 산출 불가', color: '#484f58' })
        return (
          <div className="det-signal" style={{
            ['--sig-bg' as string]: verdict.bg, ['--sig-bd' as string]: verdict.border, ['--sig-fg' as string]: verdict.color,
          }}>
            <div className={'det-signal-head' + (signals.length > 0 ? ' gap' : '')}>
              <div className="det-signal-label">매매 시그널</div>
              <div className="det-signal-verdict">{verdict.label}</div>
              <div className="det-signal-score">종합 {composite.toFixed(1)}점</div>
            </div>
            {signals.length > 0 && (
              <div className="det-signal-list">
                {signals.map((s, i) => (
                  <div key={i} className="det-signal-item">
                    <span className="mark" style={{ ['--sg' as string]: s.color }}>›</span>
                    <span className="txt">{s.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── 팩터 카드 ── */}
      <div className="detail-factors hide-scrollbar">
        {FACTORS.map(f => (
          <FactorCard key={f.key} label={f.label} desc={f.desc} value={stock[f.key]} color={f.color} />
        ))}
      </div>

      {/* ── 레이더 + 수급 ── */}
      <div className="detail-radar-flow">
        <Card className="grow">
          <SectionTitle>지표 레이더</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={FACTORS.map(f => ({ factor: f.desc, score: stock[f.key] ?? 0 }))}>
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="factor" tick={{ fontSize: 10, fill: 'var(--text-3)' }} />
              <Radar name="점수" dataKey="score" stroke="#58a6ff" fill="#58a6ff" fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="side">
          {(() => {
          // 외인/기관 당일 순매수(원): 확정이면 원값, 장중 추정이면 수량(주)×현재가 환산.
          // (KIS 추정가집계 TR은 수량만 주므로 프론트에서 금액 환산 — 키움 '잠정 N차'와 동일 소스.)
          const flowPx = live?.price ?? stock.closePrice ?? null
          const estStage = investor?.source === 'estimate' ? (investor?.estimateStage ?? null) : null
          const invWon = (won?: number | null, vol?: number | null) =>
            (won != null && won !== 0) ? won
              : (vol != null && vol !== 0 && flowPx != null) ? vol * flowPx : null
          const foreignToday = invWon(investor?.foreignNetBuy, investor?.foreignNetVol)
          const instToday = invWon(investor?.instNetBuy, investor?.instNetVol)
          const hasLiveFlow = foreignToday != null || instToday != null || live?.programNetBuyToday != null
          return <>
          <SectionTitle>
            수급
            {hasLiveFlow
              ? <span className="det-live-tag">● {estStage ? `잠정 ${estStage}차` : '실시간'}</span>
              : <span className="det-live-tag batch">10일 누적</span>}
          </SectionTitle>
          <div className="det-flow-list">
            {[
              { label: '외국인', today: foreignToday, batch: stock.foreignNetBuy10d, color: '#76e4f7', est: estStage },
              { label: '기관',   today: instToday,    batch: stock.instNetBuy10d,    color: '#f6ad55', est: estStage },
              { label: '프로그램', today: live?.programNetBuyToday, batch: null as number | null, color: '#34d399', est: null as number | null },
            ].map(({ label, today, batch, color, est }) => {
              const isLive = today != null
              const value = (isLive ? today : batch) ?? null
              const amt = fmtFlow(value)
              const isPos = value != null && value > 0
              const isNeg = value != null && value < 0
              const scale = isLive ? 3e10 : 5e9   // 당일(원) vs 10일 누적(원) 바 스케일
              return (
                <div key={label}>
                  <div className="det-flow-head">
                    <span className="det-flow-label">{label}</span>
                    <span className="det-flow-tag">{isLive ? (est ? `잠정${est}차` : '당일') : batch != null ? '10일' : ''}</span>
                  </div>
                  <div className="det-flow-val" style={{ ['--fv' as string]: isPos ? '#4ade80' : isNeg ? '#f87171' : color }}>{amt}</div>
                  <div className="det-flow-track">
                    {value != null && (
                      <div className="det-flow-fill" style={{
                        ['--fw' as string]: `${Math.min(100, Math.abs(value) / scale * 100)}%`,
                        ['--ff' as string]: isPos ? '#4ade80' : '#f87171',
                      }} />
                    )}
                  </div>
                </div>
              )
            })}
            <div className="det-flow-rs">
              <div className="det-flow-label">RS 백분위</div>
              <div className="det-flow-rs-val">{(stock.marketPercentile * 100).toFixed(1)}%</div>
              <div className="det-flow-tag">상위 {(100 - stock.marketPercentile * 100).toFixed(1)}%</div>
            </div>
          </div>
          </>
          })()}
        </Card>
      </div>

      {/* ── 주가 · 기술적 분석 (통합) ── */}
      {(() => {
        const px = tech?.px ?? stock.closePrice ?? null
        const maRows: [string, number | null][] = tech
          ? [['20', tech.ma20], ['60', tech.ma60], ['120', tech.ma120]] : []
        const alignMeta = tech?.align === 'up'
          ? { label: '정배열 ↑', cls: 'up', desc: '현재가 > 20 > 60 > 120일선 — 강세 추세 지속' }
          : tech?.align === 'down'
          ? { label: '역배열 ↓', cls: 'down', desc: '현재가 < 20 < 60 < 120일선 — 약세 추세' }
          : tech?.align === 'mixed'
          ? { label: '혼조', cls: 'mixed', desc: '이동평균선 정렬 혼조 — 방향성 모호' } : null

        const signals: { text: string; cls: 'good' | 'warn' | 'muted' }[] = []
        if (stock.breakoutToday) signals.push({ text: '오늘 52주 신고가 돌파 — 매수 진입 신호', cls: 'good' })
        if (tech?.volRatio != null && tech.volRatio >= 2)
          signals.push({ text: `거래량 급증 — 20일 평균의 ${tech.volRatio.toFixed(1)}배`, cls: 'good' })
        if (stock.baseDays != null && stock.baseDays >= 15)
          signals.push({ text: `베이스 ${stock.baseDays}일 구축 — 돌파 대기`, cls: 'warn' })
        if (tech?.pos52 != null && tech.pos52 >= 90 && !stock.breakoutToday)
          signals.push({ text: '52주 고점 근접 — 돌파 임박', cls: 'warn' })
        if (stock.lScore != null && stock.lScore >= 80)
          signals.push({ text: `상대강도 상위권 (RS ${stock.lScore.toFixed(0)}) — 시장 주도주`, cls: 'good' })

        return (
          <Card className="mb">
            <div className="tech-chart-head">
              <SectionTitle>주가 · 기술적 분석</SectionTitle>
              <div className="tech-chart-head-right">
                {alignMeta && <span className={`tech-align ${alignMeta.cls}`}>{alignMeta.label}</span>}
                <div className="chart-mode-toggle">
                  <button onClick={() => setChartMode('tv')}
                    className={chartMode === 'tv' ? 'chart-mode-btn on' : 'chart-mode-btn'}>트레이딩뷰</button>
                  <button onClick={() => setChartMode('native')}
                    className={chartMode === 'native' ? 'chart-mode-btn on' : 'chart-mode-btn'}>기본</button>
                </div>
              </div>
            </div>
            {chartMode === 'tv'
              ? <TradingViewChart ticker={stock.ticker} market={stock.market} exchange={stock.exchange} height={360} />
              : <PriceChart securityId={id} height={360} bars={prices} live={live} />}

            {tech && (
              <div className="tech-block">
                <div className="tech-head">
                  <span className="tech-head-label">이동평균선</span>
                  <span className="tech-sub">현재가 {px != null ? fmtPrice(Math.round(px)) + '원' : '—'} 기준</span>
                </div>
                <div className="tech-ma-grid">
                  {maRows.map(([lab, val]) => {
                    const diff = val != null && px != null ? (px - val) / val * 100 : null
                    const up = diff != null && diff >= 0
                    return (
                      <div key={lab} className="tech-ma-cell">
                        <span className="tech-ma-lab">{lab}일 평균가</span>
                        <span className="tech-ma-val num">{val != null ? fmtPrice(Math.round(val)) + '원' : '—'}</span>
                        <span className={`tech-ma-diff num${diff == null ? '' : up ? ' up' : ' down'}`}>
                          {diff == null ? '—' : `현재가 ${up ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}%`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {tech?.pos52 != null && tech.lo52 != null && tech.hi52 != null && (
              <div className="tech-block">
                <div className="tech-head">
                  <span className="tech-head-label">52주 레인지 위치</span>
                  <span className="tech-head-val num">{tech.pos52.toFixed(0)}%</span>
                </div>
                <div className="tech-range" style={{ ['--pos' as string]: `${Math.max(0, Math.min(100, tech.pos52))}%` }}>
                  <div className="tech-range-fill" />
                  <div className="tech-range-marker" />
                </div>
                <div className="tech-range-ends num">
                  <span>저 {fmtPrice(Math.round(tech.lo52))}</span>
                  <span>고 {fmtPrice(Math.round(tech.hi52))}</span>
                </div>
              </div>
            )}

            {tech?.volRatio != null && (
              <div className="tech-block">
                <div className="tech-head">
                  <span className="tech-head-label">거래량 (20일 평균 대비)</span>
                  <span className={`tech-head-val num${tech.volRatio >= 1.5 ? ' up' : ''}`}>{tech.volRatio.toFixed(2)}×</span>
                </div>
                <div className="tech-volbar">
                  <div className="tech-volbar-fill" style={{ ['--w' as string]: `${Math.min(100, tech.volRatio / 3 * 100)}%` }} />
                  <span className="tech-volbar-ref" />
                </div>
                <div className="tech-sub num">
                  오늘 {tech.volLast != null ? fmtVol(tech.volLast) : '—'} · 평균 {tech.volAvg20 != null ? fmtVol(Math.round(tech.volAvg20)) : '—'}
                </div>
              </div>
            )}

            {signals.length > 0 && (
              <div className="tech-signals">
                {signals.map((s, i) => (
                  <div key={i} className={`tech-signal ${s.cls}`}>
                    <span className="dot" />
                    <span className="txt">{s.text}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )
      })()}

      {/* ── 실적 ── */}
      {hasFinancials && (
        <Card className="mb">
          <div className="det-fin-head">
            <SectionTitle>실적</SectionTitle>
            <div className="det-fin-tabs">
              {([['annual', '연간'], ['quarter', '분기']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setFinTab(key)}
                  className={finTab === key ? 'det-fin-tab on' : 'det-fin-tab'}>{label}</button>
              ))}
            </div>
          </div>
          {finTab === 'annual' && annualFin.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={annualFin} margin={{ top: 4, right: 48, left: 8, bottom: 0 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickLine={false} />
                <YAxis yAxisId="amt" tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickLine={false} axisLine={false}
                  tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v)} />
                <YAxis yAxisId="roe" orientation="right" tick={{ fontSize: 10, fill: '#c084fc' }} tickLine={false} axisLine={false}
                  tickFormatter={v => v + '%'} width={40} />
                <Tooltip content={<FinTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
                  formatter={v => <span style={{ color: 'var(--text-3)' }}>{v}</span>} />
                <Bar yAxisId="amt" dataKey="매출액" fill="#58a6ff" radius={[3, 3, 0, 0]} maxBarSize={32} />
                <Bar yAxisId="amt" dataKey="영업이익" fill="#68d391" radius={[3, 3, 0, 0]} maxBarSize={32} />
                <Bar yAxisId="amt" dataKey="순이익" fill="#f6ad55" radius={[3, 3, 0, 0]} maxBarSize={32} />
                <Line yAxisId="roe" type="monotone" dataKey="ROE" stroke="#c084fc" strokeWidth={2}
                  dot={{ r: 3, fill: '#c084fc' }} activeDot={{ r: 4 }} name="ROE(%)" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          {finTab === 'quarter' && quarterFin.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={quarterFin} margin={{ top: 4, right: 48, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickLine={false} />
                <YAxis yAxisId="eps" tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickLine={false} axisLine={false}
                  tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v)} />
                <YAxis yAxisId="growth" orientation="right" tick={{ fontSize: 10, fill: '#76e4f7' }} tickLine={false} axisLine={false}
                  tickFormatter={v => v + '%'} width={44} />
                <Tooltip formatter={(v: any, name: any) =>
                  name === '전년동기성장' ? [`${v}%`, name] : [Number(v).toLocaleString('ko-KR') + '원', name]
                } contentStyle={{ background: 'var(--bg-nav)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: 'var(--text-3)' }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
                  formatter={v => <span style={{ color: 'var(--text-3)' }}>{v}</span>} />
                <Bar yAxisId="eps" dataKey="EPS" fill="#f6ad55" radius={[3, 3, 0, 0]} maxBarSize={32} name="EPS(원)" />
                <Line yAxisId="growth" type="monotone" dataKey="전년동기성장" stroke="#76e4f7" strokeWidth={2}
                  dot={{ r: 3, fill: '#76e4f7' }} activeDot={{ r: 4 }} name="전년동기성장" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          {finTab === 'quarter' && quarterFin.length === 0 && (
            <div className="det-empty">분기 데이터 없음</div>
          )}
        </Card>
      )}

      {/* ── 섹터 내 비교 ── */}
      {peers.length > 0 && (
        <Card className="mb">
          <SectionTitle>섹터 내 비교 ({stock?.sector})</SectionTitle>
          <div className="det-table-wrap">
            <table className="det-table">
              <thead>
                <tr>
                  {['종목명', 'SCORE', '실적', '성장', '고가', '수급', '기관', '현재가'].map(h => (
                    <th key={h} className={h === '종목명' ? 'l' : undefined}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {peers.map(p => {
                  const isSelf = p.isSelf
                  const f = (v: number | null) => v != null ? Math.round(v) : '-'
                  const fc = (v: number | null) => v != null && v >= 80 ? '#3fb950' : v != null && v >= 60 ? '#f6ad55' : 'var(--text-3)'
                  return (
                    <tr key={p.ticker} className={isSelf ? 'self' : undefined}
                      onClick={() => !isSelf && handleSelectPeer(p.securityId)}>
                      <td className={isSelf ? 'name self' : 'name'}>{p.name}{isSelf && ' ◀'}</td>
                      <td className="score">{p.compositeScore.toFixed(1)}</td>
                      {[p.cScore, p.aScore, p.nScore, p.sScore, p.iScore].map((v, i) => (
                        <td key={i} className="f" style={{ ['--fc' as string]: fc(v) }}>{f(v)}</td>
                      ))}
                      <td>{p.closePrice != null ? Number(p.closePrice).toLocaleString('ko-KR') : '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── 유사 종목 ── */}
      {correlations.length > 0 && (
        <Card className="mb">
          <SectionTitle>유사 종목</SectionTitle>
          <div className="det-table-wrap">
            <table className="det-table">
              <thead>
                <tr>
                  {['종목명', '티커', 'SCORE', '섹터'].map(h => (
                    <th key={h} className={h === '종목명' || h === '섹터' ? 'l' : undefined}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {correlations.map(c => {
                  const scoreClr = c.compositeScore >= 70 ? '#4ade80' : c.compositeScore >= 55 ? '#fabd44' : '#f87171'
                  return (
                    <tr key={c.ticker}>
                      <td className="name">{c.name}</td>
                      <td className="name ticker">{c.ticker}</td>
                      <td className="score f" style={{ ['--fc' as string]: scoreClr }}>{c.compositeScore.toFixed(1)}</td>
                      <td className="name">{c.sector ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── 관련 뉴스 ── */}
      {news.length > 0 && (
        <Card className="mb">
          <SectionTitle>관련 뉴스</SectionTitle>
          <div className="det-news-list">
            {news.map((item, i) => (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="det-news-item">
                <span className="det-news-title">{item.title}</span>
                <span className="det-news-meta">
                  {item.source && <span className="det-news-src">{item.source}</span>}
                  {item.date}
                </span>
              </a>
            ))}
          </div>
        </Card>
      )}

      {/* ── 스코어 히스토리 (팩터 × 시간 히트맵) ── */}
      {heat && (
        <Card>
          <div className="sh-title-row">
            <SectionTitle>스코어 히스토리</SectionTitle>
            <span className="sh-legend">낮음<i className="sh-legend-bar" />높음</span>
          </div>
          <div className="sh-map">
            {FACTORS.map(f => (
              <div key={f.key} className="sh-row" style={{ ['--c' as string]: f.color }}>
                <span className="sh-label">{f.desc}</span>
                <div className="sh-cells">
                  {heat.map((h, i) => {
                    const v = h[f.key]
                    return (
                      <span key={i}
                        className={`sh-cell${v == null ? ' na' : ''}`}
                        style={v == null ? undefined : { ['--a' as string]: `${v}%` }}
                        title={`${h.scoreDate} · ${f.desc} ${v == null ? '—' : v.toFixed(0)}`} />
                    )
                  })}
                </div>
              </div>
            ))}
            <div className="sh-row sh-axis">
              <span className="sh-label" />
              <div className="sh-dates num">
                <span>{heat[0].scoreDate.slice(2, 7).replace('-', '.')}</span>
                <span>{heat[Math.floor((heat.length - 1) / 2)].scoreDate.slice(2, 7).replace('-', '.')}</span>
                <span>{heat[heat.length - 1].scoreDate.slice(2, 7).replace('-', '.')}</span>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
