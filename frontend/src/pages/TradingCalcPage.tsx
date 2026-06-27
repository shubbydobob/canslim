import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchStocks, fetchRealtimePrice } from '../api/client'
import type { ScreenerItem } from '../types'

interface BuyRow {
  price: string
  qty: string
}

const S = {
  page: {
    minHeight: '100vh',
    background: '#0b0f17',
    color: '#e6edf3',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  nav: {
    background: '#0d1117',
    borderBottom: '1px solid #21262d',
    padding: '0 20px',
    display: 'flex',
    alignItems: 'center',
    height: 40,
    gap: 24,
  } as React.CSSProperties,
  brand: {
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: '-0.5px',
  } as React.CSSProperties,
  navLink: (active: boolean): React.CSSProperties => ({
    padding: '0 12px',
    fontSize: 12,
    color: active ? '#e6edf3' : '#4b5563',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    lineHeight: '40px',
    borderBottom: active ? '2px solid #1f6feb' : '2px solid transparent',
  }),
  body: {
    padding: '24px 20px',
    display: 'grid',
    gridTemplateColumns: '1fr 300px',
    gap: 20,
    maxWidth: 900,
  } as React.CSSProperties,
  card: {
    background: '#161b22',
    border: '1px solid #21262d',
    borderRadius: 8,
    padding: 20,
  } as React.CSSProperties,
  label: {
    fontSize: 10,
    fontWeight: 700,
    color: '#4b5563',
    letterSpacing: '0.06em',
    marginBottom: 4,
    display: 'block',
  } as React.CSSProperties,
  input: {
    background: '#0d1117',
    border: '1px solid #21262d',
    borderRadius: 4,
    color: '#e6edf3',
    padding: '5px 10px',
    fontSize: 12,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#4b5563',
    letterSpacing: '0.08em',
    marginBottom: 12,
  } as React.CSSProperties,
}

function numOrNull(s: string): number | null {
  const v = parseFloat(s.replace(/,/g, ''))
  return isNaN(v) || v <= 0 ? null : v
}

export default function TradingCalcPage() {
  const navigate = useNavigate()

  // ── 자동완성 ────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<ScreenerItem[]>([])
  const [selectedStock, setSelectedStock] = useState<ScreenerItem | null>(null)
  const [showDrop, setShowDrop] = useState(false)
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [currentPrice, setCurrentPrice] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setShowDrop(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const handleQueryChange = useCallback((val: string) => {
    setQuery(val)
    setSelectedStock(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!val.trim()) { setSuggestions([]); setShowDrop(false); return }
    debounceRef.current = setTimeout(async () => {
      const results = await searchStocks(val)
      setSuggestions(results)
      setShowDrop(results.length > 0)
    }, 250)
  }, [])

  const handleSelect = useCallback(async (item: ScreenerItem) => {
    setSelectedStock(item)
    setQuery(`${item.name} (${item.ticker})`)
    setShowDrop(false)
    setSuggestions([])
    // KIS 실시간 현재가 조회
    setLoadingPrice(true)
    try {
      const rt = await fetchRealtimePrice(item.ticker)
      if (rt && rt.price > 0)
        setCurrentPrice(String(rt.price))
      else if (item.closePrice != null)
        setCurrentPrice(String(item.closePrice)) // 장 마감 후 폴백
    } finally {
      setLoadingPrice(false)
    }
  }, [])

  const [rows, setRows] = useState<BuyRow[]>([
    { price: '', qty: '' },
    { price: '', qty: '' },
    { price: '', qty: '' },
  ])
  // 물타기 섹션
  const [addPrice, setAddPrice] = useState('')
  const [addQty, setAddQty] = useState('')

  const updateRow = (i: number, field: keyof BuyRow, val: string) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  // ── 계산 ─────────────────────────────────────────────────────
  const buyData = rows
    .map(r => ({ p: numOrNull(r.price), q: numOrNull(r.qty) }))
    .filter(r => r.p !== null && r.q !== null) as { p: number; q: number }[]

  const totalQty = buyData.reduce((s, r) => s + r.q, 0)
  const totalAmt = buyData.reduce((s, r) => s + r.p * r.q, 0)
  const avgPrice = totalQty > 0 ? totalAmt / totalQty : null

  const stopLoss    = avgPrice != null ? avgPrice * 0.92 : null
  const target1     = avgPrice != null ? avgPrice * 1.20 : null
  const target2     = avgPrice != null ? avgPrice * 1.25 : null

  const cp = numOrNull(currentPrice)
  const currentPnl = avgPrice != null && cp != null
    ? ((cp - avgPrice) / avgPrice) * 100
    : null

  // 물타기
  const addP = numOrNull(addPrice)
  const addQ = numOrNull(addQty)
  const avgAfterAdd = (avgPrice != null && addP != null && addQ != null && (totalQty + addQ) > 0)
    ? (totalAmt + addP * addQ) / (totalQty + addQ)
    : null

  const fmt = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 0 })
  const fmtM = (v: number) => {
    const b = v / 1e8
    if (b >= 10000) return (b / 10000).toFixed(2) + '조'
    if (b >= 1000) return (b / 1000).toFixed(1) + '천억'
    if (b >= 100) return b.toFixed(1) + '억'
    return b.toFixed(2) + '억'
  }

  return (
    <div style={S.page}>
      {/* nav */}
      <div style={S.nav}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={S.brand}>
            CAN<span style={{ color: '#1f6feb' }}>SLIM</span>
          </span>
        </div>
        <nav style={{ display: 'flex', gap: 0 }}>
          <span style={S.navLink(false)} onClick={() => navigate('/')}>스크리너</span>
          <span style={S.navLink(false)}>시장</span>
          <span style={S.navLink(true)}>포지션 플래너</span>
        </nav>
      </div>

      <div style={S.body}>
        {/* ── 입력 패널 ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 종목 + 현재가 */}
          <div style={S.card}>
            <div style={S.sectionTitle}>종목 정보</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {/* 자동완성 */}
              <div ref={wrapRef} style={{ position: 'relative' }}>
                <span style={S.label}>종목명 / 티커</span>
                <input
                  style={S.input}
                  placeholder="종목명 또는 티커 검색"
                  value={query}
                  onChange={e => handleQueryChange(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowDrop(true)}
                  autoComplete="off"
                />
                {showDrop && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                    background: '#161b22', border: '1px solid #21262d', borderRadius: 4,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.5)', marginTop: 2,
                  }}>
                    {suggestions.map(s => (
                      <div key={s.securityId}
                        onMouseDown={() => handleSelect(s)}
                        style={{
                          padding: '7px 12px', cursor: 'pointer', display: 'flex',
                          alignItems: 'center', justifyContent: 'space-between',
                          borderBottom: '1px solid #0d1117',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#1f2937')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div>
                          <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 600 }}>{s.name}</span>
                          <span style={{ fontSize: 10, color: '#4b5563', marginLeft: 6 }}>{s.sector ?? ''}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 11, color: '#3b82f6', fontFamily: 'monospace', fontWeight: 700 }}>{s.ticker}</span>
                          {s.closePrice != null && (
                            <div style={{ fontSize: 10, color: '#6b7280' }}>
                              {s.closePrice.toLocaleString('ko-KR')}원
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {selectedStock && (
                  <div style={{ fontSize: 10, color: '#4b5563', marginTop: 3 }}>
                    SCORE {selectedStock.compositeScore.toFixed(1)} · RS {(selectedStock.marketPercentile * 100).toFixed(0)}%
                  </div>
                )}
              </div>

              {/* 현재가 */}
              <div>
                <span style={S.label}>
                  현재가 (원)
                  {loadingPrice && <span style={{ color: '#4b5563', fontWeight: 400 }}> 조회중...</span>}
                </span>
                <input
                  style={S.input}
                  placeholder="종목 선택 시 자동 입력"
                  value={currentPrice}
                  onChange={e => setCurrentPrice(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* 매수 행 */}
          <div style={S.card}>
            <div style={S.sectionTitle}>매수 계획</div>
            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 80px', gap: '6px 10px', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ ...S.label, marginBottom: 0 }}></span>
              <span style={{ ...S.label, marginBottom: 0, textAlign: 'right' }}>매수가 (원)</span>
              <span style={{ ...S.label, marginBottom: 0, textAlign: 'right' }}>수량 (주)</span>
              <span style={{ ...S.label, marginBottom: 0, textAlign: 'right' }}>소계</span>
            </div>
            {rows.map((r, i) => {
              const p = numOrNull(r.price)
              const q = numOrNull(r.qty)
              const sub = p != null && q != null ? p * q : null
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 80px', gap: '6px 10px', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: '#4b5563', fontWeight: 700 }}>
                    {i === 0 ? '1차' : i === 1 ? '2차' : '3차'}
                  </span>
                  <input
                    style={{ ...S.input, textAlign: 'right' }}
                    placeholder="0"
                    value={r.price}
                    onChange={e => updateRow(i, 'price', e.target.value)}
                  />
                  <input
                    style={{ ...S.input, textAlign: 'right' }}
                    placeholder="0"
                    value={r.qty}
                    onChange={e => updateRow(i, 'qty', e.target.value)}
                  />
                  <span style={{ fontSize: 11, color: '#6b7280', textAlign: 'right', fontFamily: 'monospace' }}>
                    {sub != null ? fmtM(sub) : '-'}
                  </span>
                </div>
              )
            })}
          </div>

          {/* 물타기 섹션 */}
          <div style={S.card}>
            <div style={S.sectionTitle}>물타기 시나리오</div>
            <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 10 }}>
              현재 보유 포지션에 추가 매수 시 새 평단가 계산
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <span style={S.label}>추가 매수가 (원)</span>
                <input
                  style={{ ...S.input, textAlign: 'right' }}
                  placeholder="0"
                  value={addPrice}
                  onChange={e => setAddPrice(e.target.value)}
                />
              </div>
              <div>
                <span style={S.label}>추가 수량 (주)</span>
                <input
                  style={{ ...S.input, textAlign: 'right' }}
                  placeholder="0"
                  value={addQty}
                  onChange={e => setAddQty(e.target.value)}
                />
              </div>
            </div>
            {avgAfterAdd != null && (
              <div style={{ background: '#0d1117', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>추가 후 평단가</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#fabd44', fontFamily: 'monospace' }}>
                    {fmt(avgAfterAdd)}원
                  </span>
                </div>
                {addP != null && (
                  <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
                    기존 평단 {avgPrice != null ? fmt(avgPrice) : '-'}원 →
                    {avgAfterAdd < (avgPrice ?? Infinity) ? ' ▼ 평단 낮아짐' : ' ▲ 평단 높아짐'}
                  </div>
                )}
              </div>
            )}
            {avgAfterAdd == null && avgPrice == null && (
              <div style={{ fontSize: 11, color: '#374151', textAlign: 'center', padding: '8px 0' }}>
                위 매수 계획을 먼저 입력하세요
              </div>
            )}
          </div>
        </div>

        {/* ── 결과 패널 ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={S.card}>
            <div style={S.sectionTitle}>포지션 요약</div>

            <ResultRow label="총 매수금액" value={totalAmt > 0 ? fmtM(totalAmt) : '-'} />
            <ResultRow label="총 수량" value={totalQty > 0 ? `${totalQty.toLocaleString()}주` : '-'} />

            <div style={{ height: 1, background: '#21262d', margin: '10px 0' }} />

            <div style={{ marginBottom: 8 }}>
              <span style={{ ...S.label, marginBottom: 2 }}>평균 매수가</span>
              <div style={{
                fontSize: 22,
                fontWeight: 800,
                color: avgPrice != null ? '#e6edf3' : '#374151',
                fontFamily: 'monospace',
                letterSpacing: '-0.5px',
              }}>
                {avgPrice != null ? fmt(avgPrice) + '원' : '-'}
              </div>
            </div>

            <div style={{ height: 1, background: '#21262d', margin: '10px 0' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <PriceTarget label="손절가 (−8%)" value={stopLoss} fmt={fmt} color="#f87171" />
              <PriceTarget label="1차 익절 (+20%)" value={target1} fmt={fmt} color="#4ade80" />
              <PriceTarget label="2차 익절 (+25%)" value={target2} fmt={fmt} color="#16a34a" />
            </div>

            {currentPnl != null && (
              <>
                <div style={{ height: 1, background: '#21262d', margin: '10px 0' }} />
                <div>
                  <span style={S.label}>현재 손익률</span>
                  <div style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: currentPnl > 0 ? '#4ade80' : currentPnl < 0 ? '#f87171' : '#6b7280',
                    fontFamily: 'monospace',
                  }}>
                    {currentPnl > 0 ? '+' : ''}{currentPnl.toFixed(2)}%
                  </div>
                  {cp != null && avgPrice != null && (
                    <div style={{ fontSize: 10, color: '#4b5563', marginTop: 2 }}>
                      현재가 {fmt(cp)}원 / 평단 {fmt(avgPrice)}원
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div style={{ ...S.card, fontSize: 10, color: '#374151', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, color: '#4b5563', marginBottom: 6 }}>성장주 매수 원칙</div>
            <div>• 1차: 계획 물량의 50%</div>
            <div>• 2차: 상승 확인 후 30%</div>
            <div>• 3차: 추세 강화 시 20%</div>
            <div style={{ marginTop: 6 }}>• 손절 기준: −8% (원칙 준수)</div>
            <div>• 1차 익절: +20%</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: '#6b7280' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', fontFamily: 'monospace' }}>{value}</span>
    </div>
  )
}

function PriceTarget({ label, value, fmt, color }: { label: string; value: number | null; fmt: (v: number) => string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 10, color: '#4b5563' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: value != null ? color : '#21262d', fontFamily: 'monospace' }}>
        {value != null ? fmt(value) + '원' : '-'}
      </span>
    </div>
  )
}
