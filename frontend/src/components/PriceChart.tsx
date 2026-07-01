import { useEffect, useRef, useState } from 'react'
import { createChart, ColorType, CandlestickSeries, HistogramSeries } from 'lightweight-charts'
import { fetchStockPrices } from '../api/client'
import type { PriceBar } from '../types'

interface Props {
  securityId: number
  height?: number
}

type Range = '3m' | '6m' | '1y' | '3y' | 'all'

const RANGES: [Range, string, number][] = [
  ['3m',  '3개월',  90],
  ['6m',  '6개월',  180],
  ['1y',  '1년',    365],
  ['3y',  '3년',    1095],
  ['all', '전체',   9999],
]

export default function PriceChart({ securityId, height = 480 }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const [allData, setAllData] = useState<PriceBar[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('1y')

  // Fetch all data once
  useEffect(() => {
    setLoading(true)
    fetchStockPrices(securityId, 9999).then(d => {
      setAllData(d)
    }).finally(() => setLoading(false))
  }, [securityId])

  // Rebuild chart when data or range changes
  useEffect(() => {
    if (!chartContainerRef.current || !allData.length) return

    const days = RANGES.find(r => r[0] === range)?.[2] ?? 365
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const filtered = range === 'all' ? allData : allData.filter(d => d.date >= cutoffStr)

    // 현재 테마(CSS 변수)에 맞춰 차트 색 결정 — lightweight-charts는 concrete color 필요
    const css = getComputedStyle(document.documentElement)
    const cssVar = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback
    const isLight = document.documentElement.getAttribute('data-theme') === 'light'
    const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)'
    const crosshairColor = isLight ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.2)'
    const bgColor = cssVar('--bg-surface', '#1b212c')
    const textColor = cssVar('--text-2', '#adb6c2')
    const borderColor = cssVar('--border', '#2d3440')
    const accentColor = cssVar('--accent', '#2563eb')

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: bgColor },
        textColor,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      rightPriceScale: {
        borderColor,
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor,
        timeVisible: false,
      },
      crosshair: {
        vertLine: { color: crosshairColor, labelBackgroundColor: accentColor },
        horzLine: { color: crosshairColor, labelBackgroundColor: accentColor },
      },
      width: chartContainerRef.current.clientWidth,
      height,
    })

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#3fb950',
      downColor: '#f85149',
      borderUpColor: '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
    })

    const candleData = filtered
      .filter(d => d.open != null && d.high != null && d.low != null && d.close != null)
      .map(d => ({
        time: d.date,
        open: Number(d.open),
        high: Number(d.high),
        low: Number(d.low),
        close: Number(d.close),
      }))
    candleSeries.setData(candleData)

    // Volume histogram
    const volSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(118,228,247,0.3)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    const volData = filtered
      .filter(d => d.volume != null && d.close != null && d.open != null)
      .map(d => ({
        time: d.date,
        value: Number(d.volume),
        color: Number(d.close) >= Number(d.open)
          ? 'rgba(63,185,80,0.3)'
          : 'rgba(248,81,73,0.3)',
      }))
    volSeries.setData(volData)

    // Responsive resize
    const observer = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    })
    observer.observe(chartContainerRef.current)

    return () => {
      observer.disconnect()
      chart.remove()
    }
  }, [allData, range, height])

  if (loading) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: 14 }}>
      차트 로딩 중...
    </div>
  )

  if (!allData.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: 14 }}>
      가격 데이터 없음
    </div>
  )

  return (
    <div style={{ background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
      {/* Range selector */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        {RANGES.map(([key, label]) => (
          <button key={key} onClick={() => setRange(key)} style={{
            padding: '2px 10px', fontSize: 12, fontWeight: 600, borderRadius: 4,
            background: range === key ? 'var(--accent)' : 'transparent',
            color: range === key ? 'var(--accent-contrast)' : 'var(--text-2)',
            border: `1px solid ${range === key ? 'var(--accent)' : 'var(--border-sub)'}`,
            cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>
      <div ref={chartContainerRef} />
    </div>
  )
}
