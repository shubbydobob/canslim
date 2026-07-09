import { useState, useEffect } from 'react'
import type { ScreenerItem } from '../types'
import { fetchScreenerStats, fetchLimitUp, fetchLiveQuotes, fetchSectorIndices } from '../api/client'
import type { ScreenerStats, LimitUpStock, LiveQuote, SectorIndex } from '../api/client'
import { useIsMobile } from '../hooks/useIsMobile'
import { scoreFg, changeColor } from '../utils/factors'

// 장중(평일 08:00~20:00 KST) 여부 — ScreenerPage와 동일 창. 장중엔 배치 시세가
// '전일 종가 기준'이라 실시간이 붙기 전 전일 등락률·상한가를 노출하지 않기 위함.
function isKrMarketHours(): boolean {
  const now = new Date()
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000)
  const day = kst.getDay()
  if (day === 0 || day === 6) return false
  const mins = kst.getHours() * 60 + kst.getMinutes()
  return mins >= 480 && mins <= 1200
}

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

function computeMarketLabel(marketStates: Props['marketStates'], items: ScreenerItem[], loading: boolean): { label: string; color: string; bg: string } {
  const kospi = marketStates.find(m => m.market === 'KOSPI')

  // items가 아직 로딩 중이면 marketStates만으로 판단 (avgM=0 로 잘못 계산 방지)
  if (loading || items.length === 0) {
    if (kospi?.marketPhase === 'BULL') return { label: '위험선호 우위', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' }
    if (kospi?.marketPhase === 'BEAR') return { label: '하락 조심', color: '#f87171', bg: 'rgba(248,113,113,0.12)' }
    return { label: '선별적 접근', color: '#fabd44', bg: 'rgba(250,189,68,0.12)' }
  }

  const avgM = items.reduce((s, i) => s + (i.mScore ?? 0), 0) / items.length
  if (kospi?.marketPhase === 'BULL' && avgM >= 40) {
    return { label: '위험선호 우위', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' }
  }
  if (kospi?.marketPhase === 'BEAR' || avgM < 20) {
    return { label: '하락 조심', color: '#f87171', bg: 'rgba(248,113,113,0.12)' }
  }
  return { label: '선별적 접근', color: '#fabd44', bg: 'rgba(250,189,68,0.12)' }
}

export default function DashboardView({
  items,
  loading,
  marketStates,
  onViewRanking,
  onSectorClick,
  onStockClick,
}: Props) {
  const [stats, setStats] = useState<ScreenerStats | null>(null)
  const [limitUp, setLimitUp] = useState<LimitUpStock[]>([])
  const [liveMap, setLiveMap] = useState<Record<string, LiveQuote>>({})
  const [liveLoaded, setLiveLoaded] = useState(false)   // 첫 실시간 폴링 완료 여부(시세 보류 게이트)
  const [sectorIdx, setSectorIdx] = useState<SectorIndex[]>([])
  const isMobile = useIsMobile()

  useEffect(() => {
    fetchScreenerStats('KR').then(setStats).catch(() => {})

    // 상한가 후보(배치 ≥10%) + TOP 랭킹 종목의 KIS 실시간 등락률을 받아 오버레이.
    const loadLive = async () => {
      const cands = await fetchLimitUp('KR', 10).catch(() => [])
      setLimitUp(cands)
      const top15 = [...items].sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 15)
      // 상한가 후보 우선(≥29% 실상한가는 상위에 몰림) 45개 + TOP15 예약 15슬롯 = 60.
      // 후보만 60개 채워 top15가 잘리면 랭킹 등락률이 실시간을 못 받아 전일값으로 남으므로,
      // top15 는 항상 실시간 조회에 포함되도록 슬롯을 확보한다.
      const tickers = Array.from(new Set([...cands.slice(0, 45).map(c => c.ticker), ...top15.map(t => t.ticker)])).slice(0, 60)
      if (tickers.length) {
        const lq = await fetchLiveQuotes(tickers).catch(() => ({}))
        setLiveMap(lq)
      } else {
        setLiveMap({})
      }
      setLiveLoaded(true)   // 첫 응답 도착 → 보류 해제(미포함 종목은 배치값 폴백)
    }
    setLiveLoaded(false)    // 새 목록: 첫 실시간 폴링 완료 전까지 시세 보류
    loadLive()
    fetchSectorIndices().then(setSectorIdx).catch(() => {})
    const timer = setInterval(() => {
      loadLive()
      fetchSectorIndices().then(setSectorIdx).catch(() => {})
    }, 15000)   // 15초 실시간 갱신
    return () => clearInterval(timer)
  }, [items])

  // 실시간 등락률로 덮어쓰고, 진짜 상한가·급등(실시간 ≥29%)만 노출.
  // liveMap이 채워진 '실시간 활성' 구간(장중~마감 후 배치 전)에는 실시간을 받은
  // 종목만 신뢰한다. 실시간을 못 받은 종목의 배치 등락률은 어제 상한가일 수 있어
  // (예: 효성화학 어제 +29% → 오늘 +2%인데 배치값 29% 잔존) 상한가로 오노출되므로 배제.
  // liveMap이 완전히 빈 '실시간 비활성'(장외/주말) 구간에는 배치 종가가 곧 당일
  // 종가이므로 배치 등락률을 그대로 사용한다.
  const LIMIT_MIN = 29
  const marketOpen = isKrMarketHours()
  // 실시간을 신뢰해야 하는 구간: 장중 + '마감했지만 아직 liveMap이 남은'(20:00~20:05 배치 전) 구간.
  // 이 구간엔 실시간 확인된 종목만 노출(hasLive) → 첫 폴링 전·실시간 실패 시 전일 상한가 오노출 방지.
  // 완전 장외/주말(liveMap 빔)엔 배치 종가=당일 종가이므로 배치 등락률을 그대로 사용.
  const trustLiveOnly = marketOpen || Object.keys(liveMap).length > 0
  const limitUpLive = limitUp
    .map(s => {
      const live = liveMap[s.ticker]?.changeRate
      return { ...s, effChange: live != null ? live : s.changeRate, hasLive: live != null }
    })
    .filter(s => s.effChange >= LIMIT_MIN && (trustLiveOnly ? s.hasLive : true))
    .sort((a, b) => b.effChange - a.effChange)

  // ── Stats (전체 2558종목 기준) ──────────────────────────────────
  const bullCount = stats?.bullCount ?? 0
  const avgScore  = stats ? Math.round(stats.avgScore) : 0
  const upCount   = stats?.upCount ?? 0
  const total     = stats?.total ?? 0
  const marketLabel = computeMarketLabel(marketStates, items, loading)

  // TOP 15 for ranking panel
  const topItems = [...items]
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, 15)
  const maxScore = topItems[0]?.compositeScore ?? 100

  return (
    <div className={isMobile ? 'dash mobile' : 'dash'}>

      {/* ── Stat cards ──────────────────────────────────────────── */}
      <div className="dash-stats">
        <StatCard label="강세 종목 (70점+)" value={bullCount.toLocaleString()} unit="종목"
          subtext={total > 0 ? `전체 ${total.toLocaleString()}종목 중` : ''} accent="var(--accent)" />
        <StatCard label="평균 종합 스코어" value={String(avgScore)} unit="점"
          subtext="7팩터 가중 합산" accent="var(--accent)" valueColor="var(--accent)" />
        <StatCard label="상승 종목" value={upCount.toLocaleString()} unit={`/ ${total.toLocaleString()}`}
          subtext={total > 0 ? `${Math.round((upCount / total) * 100)}% 상승` : ''} accent="var(--up)" valueColor="var(--up)" />

        {/* 시장 상태 */}
        <div className="stat-card market" style={{ ['--mk-bg' as string]: marketLabel.bg, ['--mk-color' as string]: marketLabel.color }}>
          <div className="stat-market-label">시장 상태</div>
          <div className="stat-market-val">{marketLabel.label}</div>
          <div className="stat-market-date">{marketStates.find(m => m.market === 'KOSPI')?.stateDate ?? '—'}</div>
        </div>
      </div>

      {/* ── 상한가·급등 섹션 (당일 +29%↑) ──────────────────────── */}
      <div className="dash-panel">
        <div className="dash-panel-head">
          <span className="dash-panel-title">🚀 상한가·급등</span>
          <span className="dash-panel-sub">실시간 +29% 이상</span>
          {limitUpLive.length > 0 && <span className="dash-panel-count">{limitUpLive.length}종목</span>}
        </div>
        {limitUpLive.length === 0 ? (
          <div className="dash-empty">오늘 상한가·급등 종목 없음</div>
        ) : (
          <div className="hide-scrollbar limitup-row">
            {limitUpLive.map(s => (
              <button key={s.securityId} onClick={() => onStockClick(s.securityId)} className="limitup-card">
                <div className="limitup-name">{s.name}</div>
                <div className="limitup-ticker">{s.ticker}</div>
                <div className="limitup-chg">+{s.effChange.toFixed(2)}%</div>
                <div className="limitup-meta">
                  {Math.round(s.closePrice).toLocaleString()}원{s.compositeScore != null ? ` · ${Math.round(s.compositeScore)}점` : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Bottom: Ranking + Sector Heatmap ── */}
      <div className="dash-grid">

        {/* LEFT: TOP Ranking */}
        <div className="dash-panel">
          <div className="dash-panel-head">
            <span className="dash-panel-title">스코어 TOP 랭킹</span>
            <button onClick={onViewRanking} className="dash-link">전체보기 →</button>
          </div>

          <div className="dash-rank-list">
            {loading && Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="dash-skel-row">
                <div className="dash-skel w18" /><div className="dash-skel w90" /><div className="dash-skel bar" /><div className="dash-skel w28" />
              </div>
            ))}
            {!loading && topItems.map((item, idx) => {
              const sc = scoreFg(item.compositeScore)
              const liveCh = liveMap[item.ticker]?.changeRate
              const dispChange = liveCh != null ? liveCh : item.changeRate
              const chgPending = marketOpen && !liveLoaded   // 장중 첫 실시간 폴링 전 전일 등락률 노출 방지
              const barPct = maxScore > 0 ? Math.min(100, (item.compositeScore / maxScore) * 100) : 0
              return (
                <div key={item.securityId} className="dash-rank-row" onClick={() => onStockClick(item.securityId)}>
                  <span className={idx < 3 ? 'dash-rank-no top' : 'dash-rank-no'}>{idx + 1}</span>
                  <div className="dash-rank-id">
                    <div className="dash-rank-name">{item.name}</div>
                    <div className="dash-rank-ticker">{item.ticker}</div>
                  </div>
                  <div className="dash-hbar"><div className="dash-hbar-fill" style={{ ['--hb' as string]: `${barPct}%`, ['--hbc' as string]: sc }} /></div>
                  <span className="dash-rank-score" style={{ ['--rc' as string]: sc }}>{Math.round(item.compositeScore)}</span>
                  <span className="dash-rank-chg" style={chgPending ? undefined : { ['--sc-rate' as string]: changeColor(dispChange) }}>
                    {chgPending
                      ? <span className="cell-skel" />
                      : dispChange !== null ? (dispChange >= 0 ? '+' : '') + dispChange.toFixed(2) + '%' : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* RIGHT: Sector Heatmap */}
        <div className="dash-panel">
          <div className="dash-panel-head">
            <span className="dash-panel-title">업종 히트맵</span>
            <span className="dash-panel-sub">KRX 업종지수 · 실시간</span>
          </div>

          <div className="heatmap">
            {sectorIdx.length === 0 ? (
              <div className="dash-empty big">업종 데이터 없음 (장중에만 실시간)</div>
            ) : (
              [...sectorIdx]
                .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
                .map(sec => {
                  const ch = sec.changePct ?? 0
                  const hc = ch >= 0 ? 'var(--up)' : 'var(--down)'
                  const hi = Math.min(20, Math.abs(ch) * 10)
                  return (
                    <button key={sec.name} onClick={() => onSectorClick(sec.name)} className="heat-cell"
                      style={{ ['--hc' as string]: hc, ['--hi' as string]: hi }}>
                      <div className="heat-name">{sec.name}</div>
                      <div className="heat-chg">
                        {sec.changePct == null ? '—' : (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%'}
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
function StatCard({ label, value, unit, subtext, accent, valueColor }: {
  label: string; value: string; unit?: string; subtext?: string; accent: string; valueColor?: string
}) {
  return (
    <div className="stat-card" style={valueColor ? { ['--sa' as string]: accent, ['--sv' as string]: valueColor } : { ['--sa' as string]: accent }}>
      <div className="stat-accent" />
      <div className="stat-label">{label}</div>
      <div className="stat-value-row">
        <span className="stat-value">{value}</span>
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {subtext && <div className="stat-sub">{subtext}</div>}
    </div>
  )
}
