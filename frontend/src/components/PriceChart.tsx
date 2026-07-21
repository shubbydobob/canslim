import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'
import { fetchStockPrices, fetchMinuteBars } from '../api/client'
import type { LiveQuote, MinuteBar } from '../api/client'
import type { PriceBar } from '../types'

interface Props {
  securityId: number
  height?: number
  bars?: PriceBar[]        // 부모가 이미 받은 일별 가격 (있으면 재사용해 중복 fetch 방지)
  live?: LiveQuote | null  // 실시간 시세 (마지막/오늘·이번주·이번달 캔들 갱신)
  ticker?: string          // 분봉 조회용(KR). 없으면 분봉 미노출
  market?: string          // 'KOSPI'|'KOSDAQ'|'US' — US는 분봉 미노출(해외분봉 별도)
}

type Range = '3m' | '6m' | '1y' | '3y' | 'all'
type Interval = '1' | '5' | 'D' | 'W' | 'M'
type Time = string | number
type Bar = { time: Time; open: number; high: number; low: number; close: number; volume: number }

const RANGES: [Range, string, number][] = [
  ['3m',  '3개월',  90],
  ['6m',  '6개월',  180],
  ['1y',  '1년',    365],
  ['3y',  '3년',    1095],
  ['all', '전체',   9999],
]

// 분봉 조회 범위(거래일 수) — 백엔드 days 파라미터
const MIN_DAYS: [number, string][] = [[1, '당일'], [5, '5일']]

// 이동평균선 색 (기술적 분석 이동평균 배열과 동일 개념)
const MAS: [number, string][] = [[20, '#9aa4b2'], [60, '#f6ad55'], [120, '#c084fc']]

const isMinuteIv = (iv: Interval) => iv === '1' || iv === '5'

// 단순이동평균 (close 기준). Bar[] 오름차순 가정.
function sma(bars: Bar[], period: number): { time: Time; value: number }[] {
  const out: { time: Time; value: number }[] = []
  const q: number[] = []
  let sum = 0
  for (const b of bars) {
    if (b.close == null) continue
    q.push(b.close); sum += b.close
    if (q.length > period) sum -= q.shift() as number
    if (q.length === period) out.push({ time: b.time, value: sum / period })
  }
  return out
}

// 해당 날짜가 속한 주의 월요일(YYYY-MM-DD) — 주봉 그룹 키.
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.getUTCDay()               // 0=일 … 6=토
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day))
  return d.toISOString().slice(0, 10)
}

// 일봉 → 주봉/월봉 집계. 각 캔들 time = 해당 기간의 마지막 거래일(고유·오름차순).
function aggregateDaily(bars: PriceBar[], interval: 'D' | 'W' | 'M'): Bar[] {
  const src = interval === 'D'
    ? bars
    : (() => {
        const keyOf = (d: string) => (interval === 'W' ? mondayOf(d) : d.slice(0, 7))
        const groups = new Map<string, PriceBar[]>()
        for (const b of bars) {
          if (b.close == null || b.open == null) continue
          const k = keyOf(b.date)
          const g = groups.get(k)
          if (g) g.push(b); else groups.set(k, [b])
        }
        return [...groups.keys()].sort().map(k => {
          const g = groups.get(k)!
          const first = g[0], last = g[g.length - 1]
          return {
            date: last.date,
            open: Number(first.open), high: Math.max(...g.map(x => Number(x.high))),
            low: Math.min(...g.map(x => Number(x.low))), close: Number(last.close),
            volume: g.reduce((s, x) => s + (Number(x.volume) || 0), 0),
          } as PriceBar
        })
      })()
  return src
    .filter(d => d.open != null && d.high != null && d.low != null && d.close != null)
    .map(d => ({ time: d.date, open: Number(d.open), high: Number(d.high), low: Number(d.low), close: Number(d.close), volume: Number(d.volume) || 0 }))
}

// 1분봉 → 1/5분 집계. time = epoch초(KST 벽시계). 5분은 정각 버킷으로 그룹.
function aggregateMinute(bars: MinuteBar[], step: number): Bar[] {
  if (step <= 1) return bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }))
  const win = step * 60
  const groups = new Map<number, MinuteBar[]>()
  for (const b of bars) {
    const k = Math.floor(b.time / win) * win
    const g = groups.get(k)
    if (g) g.push(b); else groups.set(k, [b])
  }
  return [...groups.keys()].sort((a, b) => a - b).map(k => {
    const g = groups.get(k)!
    return {
      time: k, open: g[0].open, high: Math.max(...g.map(x => x.high)),
      low: Math.min(...g.map(x => x.low)), close: g[g.length - 1].close,
      volume: g.reduce((s, x) => s + x.volume, 0),
    }
  })
}

const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
// KST 벽시계 epoch초 (분봉 time 인코딩과 일치 — 실시간 현재봉 버킷 계산용)
const kstNowSec = () => Math.floor((Date.now() + 9 * 3600 * 1000) / 1000)

export default function PriceChart({ securityId, height = 480, bars, live, ticker, market }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const candleRef = useRef<ReturnType<ReturnType<typeof createChart>['addSeries']> | null>(null)
  const lastBarRef = useRef<Bar | null>(null)
  const intervalRef = useRef<Interval>('D')
  const [allData, setAllData] = useState<PriceBar[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('1y')
  const [interval, setIntervalKind] = useState<Interval>('D')
  const [minuteBars, setMinuteBars] = useState<MinuteBar[]>([])
  const [minDays, setMinDays] = useState(1)
  const [minLoading, setMinLoading] = useState(false)
  intervalRef.current = interval

  const showMinute = !!ticker && (market || '').toUpperCase() !== 'US'
  const isMinute = isMinuteIv(interval)
  const ivList: [Interval, string][] = showMinute
    ? [['1', '1분'], ['5', '5분'], ['D', '일'], ['W', '주'], ['M', '월']]
    : [['D', '일'], ['W', '주'], ['M', '월']]

  // 일별 데이터: 부모가 bars를 주면 그대로, 아니면 자체 fetch
  useEffect(() => {
    if (bars && bars.length) { setAllData(bars); setLoading(false); return }
    setLoading(true)
    fetchStockPrices(securityId, 9999).then(d => setAllData(d)).finally(() => setLoading(false))
  }, [securityId, bars])

  // 분봉: 인터벌이 분봉일 때만 on-demand 조회(KR). minDays/티커 변경 시 재조회.
  useEffect(() => {
    if (!isMinute || !showMinute || !ticker) return
    let cancelled = false
    setMinLoading(true)
    fetchMinuteBars(ticker, minDays)
      .then(d => { if (!cancelled) setMinuteBars(d) })
      .finally(() => { if (!cancelled) setMinLoading(false) })
    return () => { cancelled = true }
  }, [isMinute, showMinute, ticker, minDays])

  // 표시 시리즈(인터벌별). 분봉이면 분봉 집계, 아니면 일/주/월 집계.
  const series = useMemo<Bar[]>(() => {
    if (isMinute) return aggregateMinute(minuteBars, interval === '5' ? 5 : 1)
    return aggregateDaily(allData, interval as 'D' | 'W' | 'M')
  }, [isMinute, minuteBars, allData, interval])

  // 차트 (시리즈/레인지 변경 시 재생성)
  useEffect(() => {
    if (!chartContainerRef.current || !series.length) return

    // 표시 구간 컷오프: 일/주/월만 레인지로 자름. 분봉은 fetch가 이미 범위 한정.
    let filtered = series
    let cutoffStr = ''
    if (!isMinute) {
      const days = RANGES.find(r => r[0] === range)?.[2] ?? 365
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - days)
      cutoffStr = cutoff.toISOString().slice(0, 10)
      filtered = range === 'all' ? series : series.filter(d => (d.time as string) >= cutoffStr)
    }

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
      timeScale: { borderColor, timeVisible: isMinute, secondsVisible: false },
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
    candleSeries.setData(filtered.map(d => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close })) as never)
    candleRef.current = candleSeries
    lastBarRef.current = filtered.length ? filtered[filtered.length - 1] : null

    // 이동평균선 오버레이 (전체 구간에서 계산 후 표시 구간만 필터)
    for (const [period, color] of MAS) {
      const line = chart.addSeries(LineSeries, {
        color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      })
      const maFull = sma(series, period)
      const maData = isMinute ? maFull : maFull.filter(p => range === 'all' || (p.time as string) >= cutoffStr)
      line.setData(maData as never)
    }

    // 거래량 히스토그램
    const volSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(118,228,247,0.3)', priceFormat: { type: 'volume' }, priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
    volSeries.setData(filtered.map(d => ({
      time: d.time, value: d.volume,
      color: d.close >= d.open ? 'rgba(240,68,82,0.28)' : 'rgba(49,130,246,0.28)',
    })) as never)

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
  }, [series, range, height, isMinute])

  // 실시간 시세 → 현재 캔들 갱신 (분봉=현재 분 버킷 / 일·주·월=오늘·이번주·이번달)
  function applyLive(price: number | null) {
    const s = candleRef.current, lb = lastBarRef.current
    if (!s || price == null || !isFinite(price)) return
    const iv = intervalRef.current
    let next: Bar

    if (isMinuteIv(iv)) {
      if (!lb || typeof lb.time !== 'number') return
      const stepSec = iv === '5' ? 300 : 60
      const bucket = Math.floor(kstNowSec() / stepSec) * stepSec
      const lbt = lb.time
      if (bucket === lbt) {
        next = { time: lbt, open: lb.open, high: Math.max(lb.high, price), low: Math.min(lb.low, price), close: price, volume: lb.volume }
      } else if (bucket > lbt) {
        next = { time: bucket, open: lb.close, high: Math.max(lb.close, price), low: Math.min(lb.close, price), close: price, volume: 0 }
      } else return
    } else if (iv === 'D') {
      const today = kstToday()
      if (lb && lb.time === today) {
        next = { ...lb, high: Math.max(lb.high, price), low: Math.min(lb.low, price), close: price }
      } else if (lb && typeof lb.time === 'string' && today > lb.time) {
        // 오늘 캔들 미생성(EOD 배치 전) → 전일 종가를 시가로 새 캔들 추가
        next = { time: today, open: lb.close, high: Math.max(lb.close, price), low: Math.min(lb.close, price), close: price, volume: 0 }
      } else if (lb) {
        next = { ...lb, high: Math.max(lb.high, price), low: Math.min(lb.low, price), close: price }
      } else return
    } else {
      // 주봉·월봉: 마지막(현재 기간) 캔들의 종가/고저를 실시간으로 갱신
      if (!lb) return
      next = { ...lb, high: Math.max(lb.high, price), low: Math.min(lb.low, price), close: price }
    }
    ;(s as { update: (b: unknown) => void }).update({ time: next.time, open: next.open, high: next.high, low: next.low, close: next.close })
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
  if (!allData.length && !isMinute) return (
    <div className="pchart-state" style={{ ['--ph' as string]: `${height}px` }}>
      가격 데이터 없음
    </div>
  )

  return (
    <div className="pchart">
      <div className="pchart-bar">
        <div className="pchart-ranges">
          <span className="pchart-ivgroup">
            {ivList.map(([key, label]) => (
              <button key={key} onClick={() => setIntervalKind(key)}
                className={interval === key ? 'pchart-range on' : 'pchart-range'}>{label}</button>
            ))}
          </span>
          <span className="pchart-bar-sep" />
          {isMinute
            ? MIN_DAYS.map(([d, label]) => (
                <button key={d} onClick={() => setMinDays(d)}
                  className={minDays === d ? 'pchart-range on' : 'pchart-range'}>{label}</button>
              ))
            : RANGES.map(([key, label]) => (
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
      {isMinute && !series.length
        ? <div className="pchart-state" style={{ ['--ph' as string]: `${height}px` }}>
            {minLoading ? <><span className="spinner" />분봉 불러오는 중…</> : '분봉 데이터 없음'}
          </div>
        : <div ref={chartContainerRef} />}
    </div>
  )
}
