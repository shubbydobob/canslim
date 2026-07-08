import { useEffect, useRef, useState } from 'react'
import { fetchMacroQuotes } from '../api/client'
import type { MacroQuote } from '../types'

function QuoteItem({ q }: { q: MacroQuote }) {
  const up = (q.changePct ?? 0) >= 0
  const color = up ? 'var(--up)' : 'var(--down)'   // 상승=빨강, 하락=파랑 (한국식)
  const arrow = up ? '▲' : '▼'

  const fmt = (v: number | null, digits = 2) =>
    v == null ? '—' : v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

  return (
    <div className="macro-quote">
      <span className="mq-name">{q.name}</span>
      <span className="mq-price">{fmt(q.price, q.symbol === '^TNX' ? 3 : 2)}</span>
      <span className="mq-chg" style={{ ['--mq-color' as string]: color }}>
        {arrow} {fmt(Math.abs(q.changePct ?? 0), 2)}%
      </span>
    </div>
  )
}

export default function MacroTicker() {
  const [quotes, setQuotes] = useState<MacroQuote[]>([])
  const tickerRef = useRef<HTMLDivElement>(null)

  const load = () => fetchMacroQuotes().then(q => { if (q.length) setQuotes(q) })

  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)  // 1분마다 갱신
    return () => clearInterval(id)
  }, [])

  // 복제해서 끊김없는 무한 스크롤
  const items = [...quotes, ...quotes]

  if (!quotes.length) return null

  return (
    <div className="macro-ticker">
      <div className="ticker-inner" ref={tickerRef} style={{ ['--ticker-dur' as string]: `${quotes.length * 4}s` }}>
        {items.map((q, i) => <QuoteItem key={`${q.symbol}-${i}`} q={q} />)}
      </div>
    </div>
  )
}
