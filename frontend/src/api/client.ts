import type { ScreenerItem, ScreenerPage, ScoreHistory, FinancialRecord, PriceBar, MacroQuote } from '../types'

const BASE = '/api'

export async function fetchScreener(
  market = 'KR',
  page = 0,
  size = 30,
  q = '',
): Promise<ScreenerPage> {
  const params = new URLSearchParams({ market, page: String(page), size: String(size) })
  if (q) params.set('q', q)
  const res = await fetch(`${BASE}/screener?${params}`)
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

export async function fetchStockFinancials(securityId: number): Promise<FinancialRecord[]> {
  const res = await fetch(`${BASE}/screener/${securityId}/financials`)
  if (!res.ok) return []
  return res.json()
}

export async function fetchStockPrices(securityId: number, days = 365): Promise<PriceBar[]> {
  const res = await fetch(`${BASE}/screener/${securityId}/prices?days=${days}`)
  if (!res.ok) return []
  return res.json()
}

export async function fetchMacroQuotes(): Promise<MacroQuote[]> {
  const res = await fetch(`${BASE}/macro/quotes`)
  if (!res.ok) return []
  return res.json()
}
