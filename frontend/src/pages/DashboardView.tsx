import { useState, useEffect } from 'react'
import type { ScreenerItem } from '../types'
import { fetchScreenerStats, fetchLimitUp, fetchLiveQuotes, fetchSectorIndices } from '../api/client'
import type { ScreenerStats, LimitUpStock, LiveQuote, SectorIndex } from '../api/client'
import { useIsMobile } from '../hooks/useIsMobile'

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

function HorizontalBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{
      height: 6,
      background: 'var(--track)',
      borderRadius: 3,
      overflow: 'hidden',
      flex: 1,
    }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: color,
        borderRadius: 3,
        transition: 'width 0.4s ease',
      }} />
    </div>
  )
}

export default function DashboardView({
  items,
  loading,
  marketStates,
  onViewRanking,
  onSectorClick,
  onStockClick,
}: Props) {
  const [hoveredRankId, setHoveredRankId] = useState<number | null>(null)
  const [stats, setStats] = useState<ScreenerStats | null>(null)
  const [limitUp, setLimitUp] = useState<LimitUpStock[]>([])
  const [liveMap, setLiveMap] = useState<Record<string, LiveQuote>>({})
  const [sectorIdx, setSectorIdx] = useState<SectorIndex[]>([])
  const isMobile = useIsMobile()

  useEffect(() => {
    fetchScreenerStats('KR').then(setStats).catch(() => {})

    // 상한가 후보(배치 ≥10%) + TOP 랭킹 종목의 KIS 실시간 등락률을 받아 오버레이.
    const loadLive = async () => {
      const cands = await fetchLimitUp('KR', 10).catch(() => [])
      setLimitUp(cands)
      const top15 = [...items].sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 15)
      // 상한가 후보 우선 + TOP 종목, 중복 제거, 배치 상한 60개.
      // (후보를 앞에 둬야 급등주가 많은 날에도 slice(60)에서 잘려 실시간 조회가
      //  누락되는 일이 없음 — 누락되면 stale 배치 상한가가 그대로 노출됨.)
      const tickers = Array.from(new Set([...cands.map(c => c.ticker), ...top15.map(t => t.ticker)])).slice(0, 60)
      if (tickers.length) {
        const lq = await fetchLiveQuotes(tickers).catch(() => ({}))
        setLiveMap(lq)
      } else {
        setLiveMap({})
      }
    }
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
  const liveActive = Object.keys(liveMap).length > 0
  const limitUpLive = limitUp
    .map(s => {
      const live = liveMap[s.ticker]?.changeRate
      return { ...s, effChange: live != null ? live : s.changeRate, hasLive: live != null }
    })
    .filter(s => (liveActive ? s.hasLive : true) && s.effChange >= LIMIT_MIN)
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

  // Score color
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

  return (
    <div style={{ padding: isMobile ? '16px 16px 24px' : '24px 28px', maxWidth: 1200 }}>

      {/* ── Stat cards ──────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr) 1fr',
        gap: isMobile ? 10 : 12,
        marginBottom: isMobile ? 14 : 24,
      }}>

        {/* Card 1: 강세 종목 */}
        <StatCard
          label="강세 종목 (70점+)"
          value={bullCount.toLocaleString()}
          unit="종목"
          subtext={total > 0 ? `전체 ${total.toLocaleString()}종목 중` : ''}
          accent="var(--accent)"
        />

        {/* Card 2: 평균 종합 스코어 */}
        <StatCard
          label="평균 종합 스코어"
          value={String(avgScore)}
          unit="점"
          subtext="7팩터 가중 합산"
          accent="var(--accent)"
          valueColor="var(--accent)"
        />

        {/* Card 3: 상승 종목 */}
        <StatCard
          label="상승 종목"
          value={upCount.toLocaleString()}
          unit={`/ ${total.toLocaleString()}`}
          subtext={total > 0 ? `${Math.round((upCount / total) * 100)}% 상승` : ''}
          accent="var(--up)"
          valueColor="var(--up)"
        />

        {/* Card 4: 시장 상태 (accent bg) */}
        <div style={{
          background: marketLabel.bg,
          border: `1px solid ${marketLabel.color}44`,
          borderRadius: 12,
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', color: marketLabel.color, textTransform: 'uppercase' }}>
            시장 상태
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: marketLabel.color, lineHeight: 1.2 }}>
            {marketLabel.label}
          </div>
          <div style={{ fontSize: 11, color: marketLabel.color, opacity: 0.75 }}>
            {marketStates.find(m => m.market === 'KOSPI')?.stateDate ?? '—'}
          </div>
        </div>
      </div>

      {/* ── 상한가·급등 섹션 (당일 +29%↑) ──────────────────────── */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        marginBottom: isMobile ? 14 : 24, overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 18px 12px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>🚀 상한가·급등</span>
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>실시간 +29% 이상</span>
          {limitUpLive.length > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--up)', fontFamily: 'var(--font-mono)' }}>
              {limitUpLive.length}종목
            </span>
          )}
        </div>
        {limitUpLive.length === 0 ? (
          <div style={{ padding: '22px', textAlign: 'center', color: 'var(--text-4)', fontSize: 12 }}>
            오늘 상한가·급등 종목 없음
          </div>
        ) : (
          <div className="hide-scrollbar" style={{ display: 'flex', gap: 8, padding: 12, overflowX: 'auto' }}>
            {limitUpLive.map(s => (
              <button
                key={s.securityId}
                onClick={() => onStockClick(s.securityId)}
                style={{
                  flexShrink: 0, minWidth: 124, textAlign: 'left', cursor: 'pointer',
                  background: 'rgba(232,51,63,0.08)', border: '1px solid rgba(232,51,63,0.28)',
                  borderRadius: 12, padding: '10px 12px',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 2 }}>{s.ticker}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--up)', fontFamily: 'var(--font-mono)', marginTop: 5 }}>
                  +{s.effChange.toFixed(2)}%
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                  {Math.round(s.closePrice).toLocaleString()}원{s.compositeScore != null ? ` · ${Math.round(s.compositeScore)}점` : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Bottom: Ranking + Sector Heatmap (모바일은 세로 스택) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: isMobile ? 12 : 16,
        alignItems: 'start',
      }}>

        {/* LEFT: TOP Ranking */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}>
          {/* Panel header */}
          <div style={{
            padding: '14px 18px 12px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
              스코어 TOP 랭킹
            </span>
            <button
              onClick={onViewRanking}
              style={{
                fontSize: 11,
                color: 'var(--accent)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              전체보기 →
            </button>
          </div>

          {/* Ranking list */}
          <div style={{ padding: '8px 0' }}>
            {loading && Array.from({ length: 10 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px' }}>
                <div style={{ width: 18, height: 10, borderRadius: 3, background: 'var(--bg-elevated)' }} />
                <div style={{ flex: '0 0 90px', height: 10, borderRadius: 3, background: 'var(--bg-elevated)' }} />
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-elevated)' }} />
                <div style={{ width: 28, height: 10, borderRadius: 3, background: 'var(--bg-elevated)' }} />
              </div>
            ))}
            {!loading && topItems.map((item, idx) => {
              const hovered = hoveredRankId === item.securityId
              const sc = scoreColor(item.compositeScore)
              const liveCh = liveMap[item.ticker]?.changeRate
              const dispChange = liveCh != null ? liveCh : item.changeRate
              return (
                <div
                  key={item.securityId}
                  onClick={() => onStockClick(item.securityId)}
                  onMouseEnter={() => setHoveredRankId(item.securityId)}
                  onMouseLeave={() => setHoveredRankId(null)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 18px',
                    cursor: 'pointer',
                    background: hovered ? 'var(--bg-elevated)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: idx < 3 ? 'var(--accent)' : 'var(--text-4)',
                    width: 18,
                    textAlign: 'right',
                    fontFamily: 'var(--font-mono)',
                    flexShrink: 0,
                  }}>
                    {idx + 1}
                  </span>

                  <div style={{ flex: '0 0 90px', overflow: 'hidden' }}>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-1)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.name}
                    </div>
                    <div style={{
                      fontSize: 10,
                      color: 'var(--accent)',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                    }}>
                      {item.ticker}
                    </div>
                  </div>

                  <HorizontalBar value={item.compositeScore} max={maxScore} color={sc} />

                  <span style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: sc,
                    fontFamily: 'var(--font-mono)',
                    width: 28,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}>
                    {Math.round(item.compositeScore)}
                  </span>

                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: changeColor(dispChange),
                    fontFamily: 'var(--font-mono)',
                    width: 44,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}>
                    {dispChange !== null
                      ? (dispChange >= 0 ? '+' : '') + dispChange.toFixed(2) + '%'
                      : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* RIGHT: Sector Heatmap */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}>
          {/* Panel header */}
          <div style={{
            padding: '14px 18px 12px',
            borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
              업종 히트맵
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 8 }}>KRX 업종지수 · 실시간</span>
          </div>

          {/* 업종 지수 grid (KIS 실시간 등락률) */}
          <div style={{
            padding: '12px',
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gap: isMobile ? 8 : 6,
          }}>
            {sectorIdx.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '32px 0', color: 'var(--text-4)', fontSize: 12 }}>
                업종 데이터 없음 (장중에만 실시간)
              </div>
            ) : (
              [...sectorIdx]
                .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
                .map(sec => {
                  const ch = sec.changePct ?? 0
                  const isUp = ch >= 0
                  const bgColor = isUp
                    ? `rgba(232, 51, 63, ${Math.min(0.20, Math.abs(ch) * 0.10)})`
                    : `rgba(47, 115, 224, ${Math.min(0.20, Math.abs(ch) * 0.10)})`
                  const borderColor = isUp
                    ? `rgba(232, 51, 63, ${Math.min(0.38, Math.abs(ch) * 0.18)})`
                    : `rgba(47, 115, 224, ${Math.min(0.38, Math.abs(ch) * 0.18)})`
                  const textClr = isUp ? 'var(--up)' : 'var(--down)'

                  return (
                    <button
                      key={sec.name}
                      onClick={() => onSectorClick(sec.name)}
                      style={{
                        background: bgColor,
                        border: `1px solid ${borderColor}`,
                        borderRadius: 8,
                        padding: '10px 10px 8px',
                        textAlign: 'left', cursor: 'pointer',
                      }}
                    >
                      <div style={{
                        fontSize: 11, fontWeight: 700, color: 'var(--text-1)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4,
                      }}>
                        {sec.name}
                      </div>
                      <div style={{
                        fontSize: 14, fontWeight: 800, color: textClr, fontFamily: 'var(--font-mono)',
                      }}>
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
function StatCard({
  label,
  value,
  unit,
  subtext,
  accent,
  valueColor,
}: {
  label: string
  value: string
  unit?: string
  subtext?: string
  accent: string
  valueColor?: string
}) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Top accent line */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        background: accent,
        opacity: 0.6,
      }} />
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        color: 'var(--text-3)',
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{
          fontSize: 26,
          fontWeight: 800,
          color: valueColor ?? 'var(--text-1)',
          fontFamily: 'var(--font-mono)',
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>
            {unit}
          </span>
        )}
      </div>
      {subtext && (
        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
          {subtext}
        </div>
      )}
    </div>
  )
}
