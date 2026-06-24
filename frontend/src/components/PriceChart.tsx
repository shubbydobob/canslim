import { useEffect, useState } from 'react'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { fetchStockPrices } from '../api/client'
import type { PriceBar } from '../types'

interface Props {
  securityId: number
  height?: number
}

const PriceTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as PriceBar
  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '10px 14px', fontSize: 11 }}>
      <div style={{ color: '#8b949e', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px' }}>
        {[['시가', d?.open], ['고가', d?.high], ['저가', d?.low], ['종가', d?.close]].map(([k, v]) => (
          <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ color: '#484f58' }}>{k}</span>
            <span style={{ color: '#c9d1d9', fontWeight: 600 }}>{v != null ? (v as number).toLocaleString('ko-KR') : '—'}</span>
          </div>
        ))}
      </div>
      {d?.volume != null && (
        <div style={{ marginTop: 6, color: '#8b949e' }}>
          거래량 <span style={{ color: '#76e4f7' }}>{(d.volume / 10000).toFixed(0)}만</span>
        </div>
      )}
    </div>
  )
}

export default function PriceChart({ securityId, height = 480 }: Props) {
  const [data, setData] = useState<PriceBar[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchStockPrices(securityId).then(d => setData(d)).finally(() => setLoading(false))
  }, [securityId])

  if (loading) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#161b22', borderRadius: 10, border: '1px solid #21262d', color: '#484f58', fontSize: 13 }}>
      차트 로딩 중...
    </div>
  )

  if (!data.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#161b22', borderRadius: 10, border: '1px solid #21262d', color: '#484f58', fontSize: 13 }}>
      가격 데이터 없음
    </div>
  )

  // thin out x-axis ticks — show ~8 labels
  const step = Math.ceil(data.length / 8)
  const tickFormatter = (v: string, i: number) => i % step === 0 ? v.slice(2, 7).replace('-', '/') : ''

  const prices = data.map(d => d.close).filter((v): v is number => v !== null)
  const minPrice = Math.min(...prices) * 0.98
  const maxPrice = Math.max(...prices) * 1.02

  const maxVol = Math.max(...data.map(d => d.volume ?? 0))

  return (
    <div style={{ background: '#0d1117', borderRadius: 10, border: '1px solid #21262d', overflow: 'hidden' }}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: '#484f58' }}
            tickLine={false}
            tickFormatter={tickFormatter}
            interval={0}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            domain={[minPrice, maxPrice]}
            tick={{ fontSize: 10, fill: '#8b949e' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => v >= 1000 ? v.toLocaleString('ko-KR') : String(v)}
            width={72}
          />
          <YAxis
            yAxisId="vol"
            orientation="left"
            domain={[0, maxVol * 4]}
            hide
          />
          <Tooltip content={<PriceTooltip />} />
          <Bar yAxisId="vol" dataKey="volume" fill="rgba(118,228,247,0.12)" radius={[1,1,0,0]} maxBarSize={6} />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="close"
            stroke="#58a6ff"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: '#58a6ff' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
