import { useEffect, useRef } from 'react'

declare global {
  interface Window { TradingView: any }
}

interface Props {
  ticker: string
  height?: number
}

export default function TradingViewChart({ ticker, height = 460 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!wrapRef.current) return
    wrapRef.current.innerHTML = ''

    // 고유 컨테이너 생성 (티커 변경 시 충돌 방지)
    const containerId = `tv_${ticker}_${Date.now()}`
    const container = document.createElement('div')
    container.id = containerId
    container.style.height = `${height}px`
    wrapRef.current.appendChild(container)

    const init = () => {
      new window.TradingView.widget({
        autosize: true,
        symbol: `KRX:${ticker}`,
        interval: 'D',
        timezone: 'Asia/Seoul',
        theme: 'dark',
        style: '1',
        locale: 'ko',
        toolbar_bg: '#161b22',
        backgroundColor: '#0d1117',
        gridColor: 'rgba(255,255,255,0.04)',
        enable_publishing: false,
        allow_symbol_change: false,
        save_image: false,
        hide_top_toolbar: false,
        hide_legend: false,
        container_id: containerId,
        studies: ['RSI@tv-basicstudies', 'Volume@tv-basicstudies'],
      })
    }

    if (window.TradingView) {
      init()
    } else {
      const script = document.createElement('script')
      script.src = 'https://s3.tradingview.com/tv.js'
      script.async = true
      script.onload = init
      document.head.appendChild(script)
    }

    return () => {
      if (wrapRef.current) wrapRef.current.innerHTML = ''
    }
  }, [ticker, height])

  return (
    <div style={{
      background: '#0d1117', borderRadius: 10,
      border: '1px solid #21262d', overflow: 'hidden',
    }}>
      <div ref={wrapRef} style={{ height }} />
    </div>
  )
}
