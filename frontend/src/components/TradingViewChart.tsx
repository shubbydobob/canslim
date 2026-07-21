import { useEffect, useRef, useState } from 'react'

interface Props {
  ticker: string
  market?: string          // 'KOSPI' | 'KOSDAQ' | 'US' 등 — 심볼 프리픽스 결정
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

// 마켓별 트레이딩뷰 심볼. KR(KOSPI/KOSDAQ)=KRX 통합 프리픽스, US=거래소 자동 해석(프리픽스 생략).
function tvSymbol(ticker: string, market?: string): string {
  const m = (market || '').toUpperCase()
  if (m === 'US') return ticker.replace('/', '.')   // BRK/B → BRK.B
  return `KRX:${ticker}`
}

export default function TradingViewChart({ ticker, market, height = 460 }: Props) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => currentTheme())
  const [interval, setInterval] = useState<Interval>('D')
  const [loaded, setLoaded] = useState(false)

  // 테마 토글(data-theme 속성 변화) 반응 → iframe 재로드
  useEffect(() => {
    const sync = () => setTheme(currentTheme())
    const mo = new MutationObserver(sync)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    mq?.addEventListener?.('change', sync)
    return () => { mo.disconnect(); mq?.removeEventListener?.('change', sync) }
  }, [])

  // 심볼/인터벌/테마 바뀔 때마다 로딩 스피너 리셋
  const prevKey = useRef('')
  const key = `${ticker}|${market}|${interval}|${theme}`
  if (prevKey.current !== key) { prevKey.current = key; if (loaded) setLoaded(false) }

  const isLight = theme === 'light'
  const params = new URLSearchParams({
    symbol:            tvSymbol(ticker, market),
    interval,
    theme,
    style:             '1',                          // 캔들
    locale:            'ko',
    timezone:          'Asia/Seoul',
    hide_side_toolbar: '1',
    hide_top_toolbar:  '0',
    hide_legend:       '0',
    allow_symbol_change: '0',
    studies:           'Volume@tv-basicstudies',
    backgroundColor:   isLight ? '#ffffff' : '#1b212c',
    gridColor:         isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)',
  })

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
        {!loaded && <div className="tv-chart-loading"><span className="spinner" />차트 불러오는 중…</div>}
        <iframe
          key={key}
          title={`${ticker} TradingView chart`}
          src={`https://s.tradingview.com/widgetembed/?${params}`}
          className="tv-chart-iframe"
          onLoad={() => setLoaded(true)}
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  )
}
