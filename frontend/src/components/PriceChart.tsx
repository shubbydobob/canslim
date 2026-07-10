import { useEffect, useRef, useState } from 'react'
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'
import { fetchStockPrices } from '../api/client'
import type { LiveQuote } from '../api/client'
import type { PriceBar } from '../types'

interface Props {
  securityId: number
  height?: number
  bars?: PriceBar[]        // 부모가 이미 받은 일별 가격 (있으면 재사용해 중복 fetch 방지)
  live?: LiveQuote | null  // 실시간 시세 (마지막/오늘 캔들 갱신)
}

type Range = '3m' | '6m' | '1y' | '3y' | 'all'

const RANGES: [Range, string, number][] = [
  ['3m',  '3개월',  90],
  ['6m',  '6개월',  180],
  ['1y',  '1년',    365],
  ['3y',  '3년',    1095],
  ['all', '전체',   9999],
]

// 이동평균선 색 (기술적 분석 이동평균 배열과 동일 개념)
const MAS: [number, string][] = [[20, '#9aa4b2'], [60, '#f6ad55'], [120, '#c084fc']]

type Candle = { time: string; open: number; high: number; low: number; close: number }

// 단순이동평균 (close 기준). 종가 null 구간은 직전 값 유지.
function sma(bars: PriceBar[], period: number): { time: string; value: number }[] {
  const out: { time: string; value: number }[] = []
  const q: number[] = []
  let sum = 0
  for (const b of bars) {
    if (b.close == null) continue
    q.push(b.close); sum += b.close
    if (q.length > period) sum -= q.shift() as number
    if (q.length === period) out.push({ time: b.date, value: sum / period })
  }
  return out
}

const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

export default function PriceChart({ securityId, height = 480, bars, live }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const candleRef = useRef<ReturnType<ReturnType<typeof createChart>['addSeries']> | null>(null)
  const lastBarRef = useRef<Candle | null>(null)
  const [allData, setAllData] = useState<PriceBar[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('1y')

  // 데이터: 부모가 bars를 주면 그대로, 아니면 자체 fetch
  useEffect(() => {
    if (bars && bars.length) { setAllData(bars); setLoading(false); return }
    setLoading(true)
    fetchStockPrices(securityId, 9999).then(d => setAllData(d)).finally(() => setLoading(false))
  }, [securityId, bars])

  // 차트 (데이터/레인지 변경 시 재생성)
  useEffect(() => {
    if (!chartContainerRef.current || !allData.length) return

    const days = RANGES.find(r => r[0] === range)?.[2] ?? 365
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const filtered = range === 'all' ? allData : allData.filter(d => d.date >= cutoffStr)

    const css = getComputedStyle(document.documentElement)
    const cssVar = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback
    const isLight = document.documentElement.getAttribute('data-theme') === 'light'
    const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)'
    const crosshairColor = isLight ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.2)'
    const bgColor = cssVar('--bg-surface', '#1b212c')
    const textColor = cssVar('--text-2', '#adb6c2')
    const borderColor = cssVar('--border', '#2d3440')
    const accentColor = cssVar('--accent', '#2563eb')
    const upColor = cssVar('--up', '#f04452')
    const downColor = cssVar('--down', '#3182f6')

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor, scaleMargins: { top: 0.1, bottom: 0.25 } },
      timeScale: { borderColor, timeVisible: false },
      crosshair: {
        vertLine: { color: crosshairColor, labelBackgroundColor: accentColor },
        horzLine: { color: crosshairColor, labelBackgroundColor: accentColor },
      },
      width: chartContainerRef.current.clientWidth,
      height,
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor, downColor, borderUpColor: upColor, borderDownColor: downColor,
      wickUpColor: upColor, wickDownColor: downColor,
    })
    const candleData: Candle[] = filtered
      .filter(d => d.open != null && d.high != null && d.low != null && d.close != null)
      .map(d => ({ time: d.date, open: Number(d.open), high: Number(d.high), low: Number(d.low), close: Number(d.close) }))
    candleSeries.setData(candleData as never)
    candleRef.current = candleSeries
    lastBarRef.current = candleData.length ? candleData[candleData.length - 1] : null

    // 이동평균선 오버레이 (전체 구간에서 계산 후 표시 구간만 필터)
    for (const [period, color] of MAS) {
      const line = chart.addSeries(LineSeries, {
        color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      })
      const maData = sma(allData, period).filter(p => range === 'all' || p.time >= cutoffStr)
      line.setData(maData as never)
    }

    // 거래량 히스토그램
    const volSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(118,228,247,0.3)', priceFormat: { type: 'volume' }, priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
    const volData = filtered
      .filter(d => d.volume != null && d.close != null && d.open != null)
      .map(d => ({
        time: d.date, value: Number(d.volume),
        color: Number(d.close) >= Number(d.open) ? 'rgba(240,68,82,0.28)' : 'rgba(49,130,246,0.28)',
      }))
    volSeries.setData(volData as never)

    // 생성 직후 현재 실시간값이 있으면 즉시 반영
    applyLive(live?.price ?? null)

    const observer = new ResizeObserver(() => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth })
    })
    observer.observe(chartContainerRef.current)

    return () => {
      observer.disconnect()
      chart.remove()
      candleRef.current = null
      lastBarRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allData, range, height])

  // 실시간 시세 → 마지막(오늘) 캔들 갱신
  function applyLive(price: number | null) {
    const s = candleRef.current, lb = lastBarRef.current
    if (!s || price == null || !isFinite(price)) return
    const today = kstToday()
    let next: Candle
    if (lb && lb.time === today) {
      // 오늘 캔들 존재 → 종가/고저 갱신
      next = { time: lb.time, open: lb.open, high: Math.max(lb.high, price), low: Math.min(lb.low, price), close: price }
    } else if (lb && today > lb.time) {
      // 오늘 캔들 미생성(EOD 배치 전) → 전일 종가를 시가로 새 캔들 추가
      next = { time: today, open: lb.close, high: Math.max(lb.close, price), low: Math.min(lb.close, price), close: price }
    } else if (lb) {
      next = { ...lb, high: Math.max(lb.high, price), low: Math.min(lb.low, price), close: price }
    } else return
    ;(s as { update: (b: Candle) => void }).update(next)
    lastBarRef.current = next
  }

  useEffect(() => { applyLive(live?.price ?? null) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.price])

  if (loading) return (
    <div className="pchart-state" style={{ ['--ph' as string]: `${height}px` }}>
      <span className="spinner" />
      차트 불러오는 중…
    </div>
  )
  if (!allData.length) return (
    <div className="pchart-state" style={{ ['--ph' as string]: `${height}px` }}>
      가격 데이터 없음
    </div>
  )

  return (
    <div className="pchart">
      <div className="pchart-bar">
        <div className="pchart-ranges">
          {RANGES.map(([key, label]) => (
            <button key={key} onClick={() => setRange(key)}
              className={range === key ? 'pchart-range on' : 'pchart-range'}>{label}</button>
          ))}
        </div>
        <div className="pchart-ma-legend">
          {MAS.map(([p, c]) => (
            <span key={p} className="pchart-ma-item" style={{ ['--ma' as string]: c }}>MA{p}</span>
          ))}
          {live?.price != null && <span className="pchart-live-tag">● 실시간</span>}
        </div>
      </div>
      <div ref={chartContainerRef} />
    </div>
  )
}
