import { useEffect, useRef, useState } from 'react'
import { fetchMacroQuotes } from '../api/client'
import type { MacroQuote } from '../types'

function QuoteItem({ q }: { q: MacroQuote }) {
  const up = (q.changePct ?? 0) >= 0
  const color = up ? '#68d391' : '#fc8181'
  const arrow = up ? '▲' : '▼'

  const fmt = (v: number | null, digits = 2) =>
    v == null ? '—' : v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '0 20px', borderRight: '1px solid var(--border)',
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600, letterSpacing: '0.05em' }}>
        {q.name}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
        {fmt(q.price, q.symbol === '^TNX' ? 3 : 2)}
      </span>
      <span style={{ fontSize: 12, color, fontWeight: 600 }}>
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
    <div style={{
      background: 'var(--bg-nav)',
      borderBottom: '1px solid var(--border)',
      height: 36,
      overflow: 'hidden',
      position: 'relative',
    }}>
      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-inner {
          display: flex;
          align-items: center;
          height: 36px;
          animation: ticker-scroll ${quotes.length * 4}s linear infinite;
          width: max-content;
        }
        .ticker-inner:hover {
          animation-play-state: paused;
        }
      `}</style>
      <div className="ticker-inner" ref={tickerRef}>
        {items.map((q, i) => <QuoteItem key={`${q.symbol}-${i}`} q={q} />)}
      </div>
    </div>
  )
}
