import type { ScreenerItem, ScoreHistory } from '../types'

const BASE = '/api'

export async function fetchScreener(market = 'KR', limit = 100): Promise<ScreenerItem[]> {
  const res = await fetch(`${BASE}/screener?market=${market}&limit=${limit}`)
  if (!res.ok) throw new Error('screener fetch failed')
  return res.json()
}

export async function fetchStockScore(securityId: number): Promise<ScreenerItem> {
  const res = await fetch(`${BASE}/screener/${securityId}`)
  if (!res.ok) throw new Error('score fetch failed')
  return res.json()
}

export async function fetchStockHistory(securityId: number): Promise<ScoreHistory[]> {
  const res = await fetch(`${BASE}/screener/${securityId}/history`)
  if (!res.ok) throw new Error('history fetch failed')
  return res.json()
}
