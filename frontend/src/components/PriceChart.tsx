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

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1b212c' },
        textColor: '#adb6c2',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: {
        borderColor: '#2d3440',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#2d3440',
        timeVisible: false,
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.2)', labelBackgroundColor: '#1f6feb' },
        horzLine: { color: 'rgba(255,255,255,0.2)', labelBackgroundColor: '#1f6feb' },
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
        time: d.date as any,
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
        time: d.date as any,
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
      background: '#1b212c', borderRadius: 10, border: '1px solid #2d3440', color: '#6e7681', fontSize: 14 }}>
      차트 로딩 중...
    </div>
  )

  if (!allData.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#1b212c', borderRadius: 10, border: '1px solid #2d3440', color: '#6e7681', fontSize: 14 }}>
      가격 데이터 없음
    </div>
  )

  return (
    <div style={{ background: '#1b212c', borderRadius: 10, border: '1px solid #2d3440', overflow: 'hidden' }}>
      {/* Range selector */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid #2d3440' }}>
        {RANGES.map(([key, label]) => (
          <button key={key} onClick={() => setRange(key)} style={{
            padding: '2px 10px', fontSize: 12, fontWeight: 600, borderRadius: 4,
            background: range === key ? '#1f6feb' : 'transparent',
            color: range === key ? '#fff' : '#adb6c2',
            border: `1px solid ${range === key ? '#1f6feb' : '#3a414e'}`,
            cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>
      <div ref={chartContainerRef} />
    </div>
  )
}
