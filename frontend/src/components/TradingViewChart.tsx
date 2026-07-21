import { useEffect, useRef, useState } from 'react'

interface Props {
  ticker: string
  market?: string           // 'KOSPI' | 'KOSDAQ' | 'US' 등 — 심볼 프리픽스 결정
  exchange?: string | null  // US 전용: KIS EXCD(NAS/NYS/AMS) → 트레이딩뷰 거래소 프리픽스
  height?: number
}

type Interval = 'D' | 'W' | 'M' | '60'

const INTERVALS: [Interval, string][] = [
  ['D',  '일'],
  ['W',  '주'],
  ['M',  '월'],
  ['60', '60분'],
]

// 현재 문서 테마(라이트/다크) — data-theme 우선, 없으면 prefers-color-scheme.
function currentTheme(): 'light' | 'dark' {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'light' || attr === 'dark') return attr
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

// KIS EXCD → 트레이딩뷰 미국 거래소 프리픽스
const US_EXCH: Record<string, string> = { NAS: 'NASDAQ', NYS: 'NYSE', AMS: 'AMEX' }

// 마켓별 트레이딩뷰 심볼.
//  · KR(KOSPI/KOSDAQ) = KRX 통합 프리픽스
//  · US = 거래소 프리픽스(exchange 있으면) 아니면 맨 티커(트레이딩뷰 자동해석). BRK/B→BRK.B.
function tvSymbol(ticker: string, market?: string, exchange?: string | null): string {
  const m = (market || '').toUpperCase()
  if (m === 'US') {
    const sym = ticker.replace('/', '.')
    const ex = US_EXCH[(exchange || '').toUpperCase()]
    return ex ? `${ex}:${sym}` : sym
  }
  return `KRX:${ticker}`
}

export default function TradingViewChart({ ticker, market, exchange, height = 460 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => currentTheme())
  const [interval, setInterval] = useState<Interval>('D')

  // 테마 토글(data-theme) / 시스템 테마 변화 반응 → 위젯 재생성
  useEffect(() => {
    const sync = () => setTheme(currentTheme())
    const mo = new MutationObserver(sync)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    mq?.addEventListener?.('change', sync)
    return () => { mo.disconnect(); mq?.removeEventListener?.('change', sync) }
  }, [])

  // 공식 Advanced Chart 임베드 스크립트 주입 (레거시 widgetembed는 KRX 등에서 심볼 제한 팝업 발생).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.innerHTML = ''
    const widget = document.createElement('div')
    widget.className = 'tradingview-widget-container__widget'
    el.appendChild(widget)

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.async = true
    script.type = 'text/javascript'
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol(ticker, market, exchange),
      interval,
      timezone: 'Asia/Seoul',
      theme,
      style: '1',                         // 캔들
      locale: 'kr',
      hide_side_toolbar: true,
      allow_symbol_change: false,
      calendar: false,
      studies: ['Volume@tv-basicstudies'],
      support_host: 'https://www.tradingview.com',
    })
    el.appendChild(script)

    return () => { el.innerHTML = '' }
  }, [ticker, market, exchange, interval, theme])

  return (
    <div className="tv-chart" style={{ ['--tv-h' as string]: `${height}px` }}>
      <div className="tv-chart-bar">
        <div className="tv-chart-ivgroup">
          {INTERVALS.map(([iv, label]) => (
            <button key={iv} onClick={() => setInterval(iv)}
              className={interval === iv ? 'tv-chart-iv on' : 'tv-chart-iv'}>{label}</button>
          ))}
        </div>
        <span className="tv-chart-live">● 실시간 · TradingView</span>
      </div>
      <div className="tv-chart-frame">
        <div ref={containerRef} className="tradingview-widget-container tv-chart-embed" />
      </div>
    </div>
  )
}
