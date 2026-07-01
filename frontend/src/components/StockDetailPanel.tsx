import { useEffect, useState } from 'react'
import { fmtPrice, fmtRate, fmtMarketCap, fmtAmt, fmtFinAmt } from '../utils/format'
import { isPremium, isLoggedIn } from '../api/auth'
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ComposedChart, Line,
} from 'recharts'
import { fetchStockScore, fetchStockHistory, fetchStockFinancials, fetchStockNews, fetchSectorPeers, fetchCorrelations } from '../api/client'
import type { NewsItem, SectorPeer, CorrelationStock } from '../api/client'
import PriceChart from './PriceChart'
import type { ScreenerItem, ScoreHistory, FinancialRecord } from '../types'

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

function scoreGrade(v: number | null): { grade: string; color: string } {
  if (v === null) return { grade: 'N/A', color: '#484f58' }
  if (v >= 85) return { grade: 'A+', color: '#68d391' }
  if (v >= 70) return { grade: 'A',  color: '#9ae6b4' }
  if (v >= 55) return { grade: 'B+', color: '#f6ad55' }
  if (v >= 40) return { grade: 'B',  color: '#ed8936' }
  if (v >= 25) return { grade: 'C',  color: '#fc8181' }
  return { grade: 'D', color: '#f56565' }
}

function fmtVol(v: number | null) {
  if (v === null) return '—'
  if (v >= 10_000_000) return (v / 10_000_000).toFixed(1) + '천만주'
  return (v / 10_000).toFixed(0) + '만주'
}
function fmtFlow(v: number | null) {
  if (v === null) return '—'
  const b = v / 1e8
  return (b > 0 ? '+' : '') + b.toFixed(1) + '억'
}

function FactorCard({ label, desc, value, color }: {
  label: string; desc: string; value: number | null; color: string
}) {
  const pct = value ?? 0
  const { grade, color: gc } = scoreGrade(value)
  return (
    <div style={{
      background: 'var(--bg-nav)', borderRadius: 10, padding: '14px 16px',
      border: '1px solid var(--border)', flex: 1, minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <span style={{
            display: 'inline-block', width: 24, height: 24, borderRadius: 6,
            background: color + '22', border: `1px solid ${color}44`,
            textAlign: 'center', lineHeight: '24px', fontSize: 11, fontWeight: 800, color,
          }}>{label}</span>
          <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 3 }}>{desc}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: value !== null ? color : '#484f58', lineHeight: 1 }}>
            {value !== null ? value.toFixed(1) : '—'}
          </div>
          <div style={{ fontSize: 10, color: gc, fontWeight: 600, marginTop: 2 }}>{grade}</div>
        </div>
      </div>
      <div style={{ height: 3, background: 'var(--border)', borderRadius: 2 }}>
        <div style={{ height: 3, borderRadius: 2, width: `${pct}%`, background: value !== null ? color : 'transparent', transition: 'width 0.5s' }} />
      </div>
    </div>
  )
}

const ScoreTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-nav)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: 'var(--text-3)', marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={String(p.dataKey)} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.stroke || p.fill }}>
          <span>{p.name}</span>
          <span style={{ fontWeight: 600 }}>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}

const FinTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-nav)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: 'var(--text-3)', marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={String(p.dataKey)} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.fill }}>
          <span>{p.name}</span>
          <span style={{ fontWeight: 600 }}>{p.value != null ? p.value.toLocaleString() + '억' : '—'}</span>
        </div>
      ))}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.08em', marginBottom: 14 }}>
      {children}
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--bg-nav)', borderRadius: 10, padding: '18px 20px', border: '1px solid var(--border)', ...style }}>
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

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400, color: 'var(--text-4)' }}>
      로딩 중...
    </div>
  )
  if (error || !stock) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400, flexDirection: 'column', gap: 12 }}>
      <div style={{ color: '#fc8181' }}>{error ?? '데이터 없음'}</div>
      {onBack && <button onClick={onBack} style={{ color: '#58a6ff', cursor: 'pointer', background: 'none', border: 'none', fontSize: 13 }}>← 목록으로</button>}
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
    <div style={{ padding: '20px', maxWidth: 1100, margin: '0 auto' }}>
      {/* ── Top info bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        padding: '8px 14px', background: 'var(--bg-nav)', borderRadius: 8,
        border: '1px solid var(--border)',
      }}>
        {onBack && (
          <button onClick={onBack} style={{
            color: 'var(--text-3)', fontSize: 12, cursor: 'pointer',
            background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 4,
          }}>← 목록</button>
        )}
        {onBack && <span style={{ color: 'var(--border)' }}>|</span>}
        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#58a6ff', fontSize: 13 }}>{stock.ticker}</span>
        <span style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 600 }}>{stock.name}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => {
              if (!userIsLoggedIn || !userIsPremium) { setShowPremiumModal(true) }
              else { window.print() }
            }}
            style={{
              background: userIsPremium ? 'rgba(31,111,235,0.1)' : 'none',
              border: `1px solid ${userIsPremium ? 'rgba(31,111,235,0.3)' : 'var(--border)'}`,
              borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
              color: userIsPremium ? '#58a6ff' : 'var(--text-4)', fontSize: 11, fontWeight: 600,
            }}
          >{userIsPremium ? 'PDF' : 'PDF'}</button>
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
            style={{
              background: 'none', border: `1px solid ${watched ? '#f6ad55' : 'var(--border)'}`,
              borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
              color: watched ? '#f6ad55' : 'var(--text-4)', fontSize: 12, fontWeight: 600,
            }}
          >{watched ? '★' : '☆'}</button>
        </div>
      </div>

      {/* Premium modal */}
      {showPremiumModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowPremiumModal(false)}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
            padding: '28px 32px', maxWidth: 380, width: '90%',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>PDF 리포트는 프리미엄 전용</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.7, marginBottom: 20 }}>
              프리미엄으로 업그레이드하면 모든 종목의 상세 분석 리포트를 다운로드할 수 있습니다.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowPremiumModal(false)}
                style={{ flex: 1, padding: '8px 0', fontSize: 12, background: 'none',
                  border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-3)', cursor: 'pointer' }}>닫기</button>
              <button onClick={() => { setShowPremiumModal(false); window.location.href = '/premium' }}
                style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700,
                  background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>프리미엄 알아보기</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Hero ── */}
      <div className="detail-hero" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)',
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4, fontWeight: 600, letterSpacing: '0.08em' }}>
            {stock.market} · {stock.scoreDate}
            {stock.sector && <span style={{ color: 'var(--text-4)', marginLeft: 8 }}>{stock.sector}</span>}
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-1px', color: 'var(--text-1)' }}>{stock.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 13, fontFamily: 'monospace', color: '#58a6ff' }}>{stock.ticker}</span>
            {stock.breakoutToday && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.4)', color: '#4ade80' }}>N 돌파</span>
            )}
            {stock.baseDays != null && stock.baseDays > 0 && (
              <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.3)', color: '#58a6ff' }}>
                베이스 {stock.baseDays}일
              </span>
            )}
            {stock.scoreDelta != null && Math.abs(stock.scoreDelta) >= 1 && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                background: stock.scoreDelta > 0 ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                border: `1px solid ${stock.scoreDelta > 0 ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
                color: stock.scoreDelta > 0 ? '#4ade80' : '#f87171',
              }}>{stock.scoreDelta > 0 ? '+' : ''}{stock.scoreDelta.toFixed(1)}</span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9, color: 'var(--text-3)', marginBottom: 2, fontWeight: 600 }}>COMPOSITE SCORE</div>
          <div style={{ fontSize: 42, fontWeight: 900, color: cColor, lineHeight: 1, letterSpacing: '-2px' }}>
            {composite.toFixed(2)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
            Rank <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{stock.marketRank}</span>
            {' · '}Top <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{(100 - stock.marketPercentile * 100).toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* ── 가격 정보 바 ── */}
      <div className="detail-price-bar" style={{
        display: 'flex', gap: 0, marginBottom: 16,
        background: 'var(--bg-nav)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden',
      }}>
        {[
          { label: '현재가', value: fmtPrice(stock.closePrice), mono: true },
          { label: '등락률', value: fmtRate(stock.changeRate), color: stock.changeRate !== null ? (stock.changeRate > 0 ? '#68d391' : stock.changeRate < 0 ? '#fc8181' : 'var(--text-3)') : 'var(--text-3)' },
          { label: '52주 신고가', value: fmtPrice(stock.weekHigh52) },
          { label: '시가총액', value: fmtMarketCap(stock.marketCap) },
          { label: '거래대금', value: fmtAmt(stock.turnover) },
          { label: '거래량', value: fmtVol(stock.volume) },
        ].map(({ label, value, color, mono }, i) => (
          <div key={label} style={{
            flex: 1, padding: '12px 14px',
            borderRight: i < 5 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{ fontSize: 9, color: 'var(--text-4)', fontWeight: 600, marginBottom: 3 }}>{label}</div>
            <div style={{
              fontSize: 13, fontWeight: 700,
              color: color ?? 'var(--text-1)',
              fontFamily: mono ? 'monospace' : 'inherit',
            }}>{value}</div>
          </div>
        ))}
      </div>

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
          <div style={{ marginBottom: 16, background: verdict.bg, border: `1px solid ${verdict.border}`, borderRadius: 10, padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: signals.length > 0 ? 10 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-3)' }}>매매 시그널</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: verdict.color }}>{verdict.label}</div>
              <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-4)' }}>종합 {composite.toFixed(1)}점</div>
            </div>
            {signals.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {signals.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11 }}>
                    <span style={{ color: s.color, marginTop: 1, flexShrink: 0 }}>›</span>
                    <span style={{ color: 'var(--text-3)', lineHeight: 1.5 }}>{s.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── 팩터 카드 ── */}
      <div className="detail-factors hide-scrollbar" style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {FACTORS.map(f => (
          <FactorCard key={f.key} label={f.label} desc={f.desc} value={stock[f.key]} color={f.color} />
        ))}
      </div>

      {/* ── 레이더 + 수급 ── */}
      <div className="detail-radar-flow" style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
        <Card style={{ flex: 1 }}>
          <SectionTitle>지표 레이더</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={FACTORS.map(f => ({ factor: f.desc, score: stock[f.key] ?? 0 }))}>
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="factor" tick={{ fontSize: 10, fill: 'var(--text-3)' }} />
              <Radar name="점수" dataKey="score" stroke="#58a6ff" fill="#58a6ff" fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>
        <Card style={{ width: 200, flexShrink: 0 }}>
          <SectionTitle>10일 순매수</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 6 }}>
            {[
              { label: '기관', value: stock.instNetBuy10d, color: '#f6ad55' },
              { label: '외국인', value: stock.foreignNetBuy10d, color: '#76e4f7' },
            ].map(({ label, value, color }) => {
              const amt = fmtFlow(value)
              const isPos = value !== null && value > 0
              const isNeg = value !== null && value < 0
              return (
                <div key={label}>
                  <div style={{ fontSize: 9, color: 'var(--text-4)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: isPos ? '#4ade80' : isNeg ? '#f87171' : color }}>{amt}</div>
                  <div style={{ marginTop: 4, height: 3, background: 'var(--border)', borderRadius: 2 }}>
                    {value !== null && (
                      <div style={{ height: 3, borderRadius: 2, width: `${Math.min(100, Math.abs(value) / 5e9 * 100)}%`, background: isPos ? '#4ade80' : '#f87171' }} />
                    )}
                  </div>
                </div>
              )
            })}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 2 }}>
              <div style={{ fontSize: 9, color: 'var(--text-4)', fontWeight: 600, marginBottom: 3 }}>RS 백분위</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)' }}>{(stock.marketPercentile * 100).toFixed(1)}%</div>
              <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 2 }}>상위 {(100 - stock.marketPercentile * 100).toFixed(1)}%</div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── 주가 차트 ── */}
      <div style={{ marginBottom: 20 }}>
        <SectionTitle>주가 차트</SectionTitle>
        <PriceChart securityId={id} height={400} />
      </div>

      {/* ── 실적 ── */}
      {hasFinancials && (
        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionTitle>실적</SectionTitle>
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {([['annual', '연간'], ['quarter', '분기']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setFinTab(key)} style={{
                  padding: '3px 12px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: finTab === key ? '#1f6feb' : 'var(--bg-nav)',
                  color: finTab === key ? '#fff' : 'var(--text-3)',
                }}>{label}</button>
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
            <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 12 }}>분기 데이터 없음</div>
          )}
        </Card>
      )}

      {/* ── 섹터 내 비교 ── */}
      {peers.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <SectionTitle>섹터 내 비교 ({stock?.sector})</SectionTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['종목명', 'SCORE', 'C', 'A', 'N', 'S', 'I', '현재가'].map(h => (
                    <th key={h} style={{ padding: '5px 8px', color: 'var(--text-4)', fontWeight: 600,
                      textAlign: h === '종목명' ? 'left' : 'right', whiteSpace: 'nowrap', fontSize: 10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {peers.map(p => {
                  const isSelf = p.isSelf
                  const f = (v: number | null) => v != null ? Math.round(v) : '-'
                  return (
                    <tr key={p.ticker}
                      onClick={() => !isSelf && handleSelectPeer(p.securityId)}
                      style={{ borderBottom: '1px solid var(--bg-nav)', cursor: isSelf ? 'default' : 'pointer',
                        background: isSelf ? 'rgba(31,111,235,0.08)' : 'transparent' }}>
                      <td style={{ padding: '6px 8px', color: isSelf ? '#58a6ff' : 'var(--text-1)', fontWeight: isSelf ? 700 : 400, fontSize: 11 }}>
                        {p.name}{isSelf && ' ◀'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-1)', fontWeight: 600, fontSize: 11 }}>
                        {p.compositeScore.toFixed(1)}
                      </td>
                      {[p.cScore, p.aScore, p.nScore, p.sScore, p.iScore].map((v, i) => (
                        <td key={i} style={{ padding: '6px 8px', textAlign: 'right', fontSize: 11,
                          color: v != null && v >= 80 ? '#3fb950' : v != null && v >= 60 ? '#f6ad55' : 'var(--text-3)' }}>
                          {f(v)}
                        </td>
                      ))}
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-3)', fontSize: 11 }}>
                        {p.closePrice != null ? Number(p.closePrice).toLocaleString('ko-KR') : '-'}
                      </td>
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
        <Card style={{ marginBottom: 20 }}>
          <SectionTitle>유사 종목</SectionTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['종목명', '티커', 'SCORE', '섹터'].map(h => (
                    <th key={h} style={{ padding: '5px 8px', color: 'var(--text-4)', fontWeight: 600,
                      textAlign: h === '종목명' || h === '섹터' ? 'left' : 'right', whiteSpace: 'nowrap', fontSize: 10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {correlations.map(c => {
                  const scoreClr = c.compositeScore >= 70 ? '#4ade80' : c.compositeScore >= 55 ? '#fabd44' : '#f87171'
                  return (
                    <tr key={c.ticker} style={{ borderBottom: '1px solid var(--bg-nav)', cursor: 'pointer' }}
                      onClick={() => {
                        // correlation uses ticker, not securityId — TODO: needs backend change
                      }}>
                      <td style={{ padding: '6px 8px', color: 'var(--text-1)', fontSize: 11 }}>{c.name}</td>
                      <td style={{ padding: '6px 8px', color: '#58a6ff', fontFamily: 'monospace', fontSize: 11 }}>{c.ticker}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: scoreClr, fontWeight: 600, fontSize: 11 }}>{c.compositeScore.toFixed(1)}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--text-4)', fontSize: 10 }}>{c.sector ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── 기술적 분석 ── */}
      {(() => {
        const pctFrom52w = stock.weekHigh52 && stock.closePrice && stock.weekHigh52 > 0
          ? ((stock.closePrice - stock.weekHigh52) / stock.weekHigh52 * 100)
          : null
        const bullets: { text: string; color: string }[] = []
        if (pctFrom52w !== null) {
          const pctStr = (pctFrom52w >= 0 ? '+' : '') + pctFrom52w.toFixed(1) + '%'
          const clr = pctFrom52w >= -5 ? '#4ade80' : pctFrom52w >= -15 ? '#fabd44' : '#f87171'
          bullets.push({ text: `52주 고점 대비: ${pctStr} (고점 ${fmtPrice(stock.weekHigh52)}원 / 현재 ${fmtPrice(stock.closePrice)}원)`, color: clr })
        }
        if (stock.baseDays != null) {
          const bdClr = stock.baseDays >= 15 ? '#4ade80' : stock.baseDays >= 7 ? '#fabd44' : 'var(--text-3)'
          const bdDesc = stock.baseDays >= 25 ? '장기 베이스 — 강한 에너지 축적' :
                         stock.baseDays >= 15 ? '베이스 구축 중 — 돌파 대기' :
                         stock.baseDays >= 7 ? '단기 베이스 — 관찰 필요' : '베이스 초기'
          bullets.push({ text: `베이스 기간: ${stock.baseDays}일 — ${bdDesc}`, color: bdClr })
        }
        if (stock.volume != null && stock.turnover != null) {
          bullets.push({ text: `거래량: ${fmtVol(stock.volume)} / 거래대금: ${fmtAmt(stock.turnover)}`, color: 'var(--text-3)' })
        }
        if (stock.breakoutToday) {
          bullets.push({ text: '오늘 52주 신고가 돌파 — 매수 진입 신호', color: '#4ade80' })
        } else if (pctFrom52w !== null && pctFrom52w >= -3) {
          bullets.push({ text: '52주 고점 근접 — 돌파 임박', color: '#fabd44' })
        }
        if (bullets.length === 0) return null
        return (
          <Card style={{ marginBottom: 20 }}>
            <SectionTitle>기술적 분석</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {bullets.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11 }}>
                  <span style={{ color: b.color, flexShrink: 0, marginTop: 1 }}>›</span>
                  <span style={{ color: 'var(--text-1)', lineHeight: 1.6 }}>{b.text}</span>
                </div>
              ))}
            </div>
          </Card>
        )
      })()}

      {/* ── 관련 뉴스 ── */}
      {news.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <SectionTitle>관련 뉴스</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {news.map((item, i) => (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
                  padding: '8px 0', borderBottom: i < news.length - 1 ? '1px solid var(--border)' : 'none',
                  textDecoration: 'none', color: 'inherit' }}>
                <span style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.5, flex: 1 }}>{item.title}</span>
                <span style={{ fontSize: 10, color: 'var(--text-4)', whiteSpace: 'nowrap', marginTop: 2 }}>
                  {item.source && <span style={{ color: 'var(--text-3)', marginRight: 6 }}>{item.source}</span>}
                  {item.date}
                </span>
              </a>
            ))}
          </div>
        </Card>
      )}

      {/* ── 스코어 히스토리 ── */}
      {history.length > 1 && (
        <Card>
          <SectionTitle>스코어 히스토리</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={history} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                {FACTORS.map(f => (
                  <linearGradient key={f.key} id={`grad-panel-${f.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={f.color} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={f.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="scoreDate" tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickLine={false} axisLine={false} />
              <Tooltip content={<ScoreTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                formatter={v => <span style={{ color: 'var(--text-3)' }}>{v}</span>} />
              {FACTORS.map(f => (
                <Area key={f.key} type="monotone" dataKey={f.key} name={f.desc}
                  stroke={f.color} fill={`url(#grad-panel-${f.key})`}
                  strokeWidth={1.5} dot={false} connectNulls />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  )
}
