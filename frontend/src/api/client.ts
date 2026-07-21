import type { ScreenerItem, ScreenerPage, ScoreHistory, FinancialRecord, PriceBar, MacroQuote } from '../types'
import { MARKET, IS_US } from '../config/market'
import { usDisplayName } from '../config/usNames'

// US: 종목명을 한글 표기로 오버라이드(티커는 유지). KR은 그대로.
function koName<T extends { ticker?: string; name: string }>(x: T): T {
  if (!IS_US || !x) return x
  return { ...x, name: usDisplayName(x.ticker, x.name) }
}

const API_ORIGIN = import.meta.env.VITE_API_URL ?? ''
const BASE = `${API_ORIGIN}/api`

export async function fetchScreener(
  market = 'KR',
  page = 0,
  size = 30,
  q = '',
  sector = '',
  minCap?: number,
  maxCap?: number,
  sortBy = 'compositeScore',
  sortDir = 'desc',
  minScore?: number,
): Promise<ScreenerPage> {
  const params = new URLSearchParams({ market, page: String(page), size: String(size), sortBy, sortDir })
  if (q) params.set('q', q)
  if (sector) params.set('sector', sector)
  if (minCap != null) params.set('minCap', String(minCap))
  if (maxCap != null) params.set('maxCap', String(maxCap))
  if (minScore != null && minScore > 0) params.set('minScore', String(minScore))
  const res = await fetch(`${BASE}/screener?${params}`)
  if (!res.ok) throw new Error('screener fetch failed')
  const data: ScreenerPage = await res.json()
  if (IS_US && Array.isArray(data.items)) data.items = data.items.map(koName)
  return data
}

export interface ScreenerStats {
  total: number
  bullCount: number
  avgScore: number
  upCount: number
  sectorStats: Array<{ sector: string; cnt: number; avg_change: number; avg_score: number }>
}

export async function fetchScreenerStats(market = 'KR'): Promise<ScreenerStats> {
  const res = await fetch(`${BASE}/screener/stats?market=${market}`)
  if (!res.ok) throw new Error('stats fetch failed')
  return res.json()
}

export interface LimitUpStock {
  securityId: number
  ticker: string
  name: string
  sector: string | null
  changeRate: number
  closePrice: number
  compositeScore: number | null
}

/** 상한가·급등 후보 (배치 등락률 >= threshold%). 실시간 오버레이 전 후보군. */
export async function fetchLimitUp(market = 'KR', threshold = 29): Promise<LimitUpStock[]> {
  try {
    const res = await fetch(`${BASE}/screener/limit-up?market=${market}&threshold=${threshold}`)
    if (!res.ok) return []
    const list: LimitUpStock[] = await res.json()
    return IS_US ? list.map(koName) : list
  } catch { return [] }
}

export interface SectorIndex { name: string; changePct: number | null }

/** KRX 코스피 업종 지수 실시간 등락률 (섹터 히트맵용). */
export async function fetchSectorIndices(): Promise<SectorIndex[]> {
  try {
    const res = await fetch(`${BASE}/macro/sectors`)
    if (!res.ok) return []
    const list = await res.json()
    return (Array.isArray(list) ? list : []).map((q: { name: string; changePct: number | null }) => ({
      name: q.name, changePct: q.changePct,
    }))
  } catch { return [] }
}

export async function fetchSectors(): Promise<string[]> {
  const res = await fetch(`${BASE}/screener/sectors`)
  if (!res.ok) return []
  return res.json()
}


export async function fetchRealtimePrice(ticker: string): Promise<{ price: number; change: number; changeRate: number; volume?: number; turnover?: number } | null> {
  try {
    const res = await fetch(`${BASE}/realtime/price?ticker=${encodeURIComponent(ticker)}&market=${MARKET}`)
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

export interface LiveQuote {
  ticker: string
  price: number | null
  change: number | null
  changeRate: number | null
  volume: number | null
  turnover: number | null
  programNetVol?: number | null       // 프로그램 순매수(주) — 3단계
  statuses?: string[] | null          // 거래정지·주의·경고·과열 등 특이사항 뱃지 (장중 오버레이)
  programNetBuyToday?: number | null  // 당일 프로그램 순매수(원, 장중 잠정) — 시세와 함께 빠른 폴링
  per?: number | null                 // KIS 주가수익비율 (inquire-price 직접 제공)
  pbr?: number | null                 // KIS 주가순자산비율
  eps?: number | null                 // KIS 주당순이익(원)
  bps?: number | null                 // KIS 주당순자산(원)
}

/** 당일 외인·기관 순매수(원, 장중 잠정) — 시세와 분리해 느린 폴링(15초). */
export interface LiveInvestor {
  ticker: string
  foreignNetBuyToday: number | null
  instNetBuyToday: number | null
}

export async function fetchLiveInvestors(tickers: string[]): Promise<Record<string, LiveInvestor>> {
  if (!tickers.length) return {}
  try {
    const res = await fetch(`${BASE}/realtime/investors?tickers=${encodeURIComponent(tickers.join(','))}`)
    if (!res.ok) return {}
    const list: LiveInvestor[] = await res.json()
    const map: Record<string, LiveInvestor> = {}
    for (const q of list) map[q.ticker] = q
    return map
  } catch { return {} }
}

export interface InvestorFlow {
  ticker: string
  date?: string
  foreignNetBuy: number | null   // 외국인 순매수 거래대금(원) — 확정 EOD만; 추정(장중)은 null
  instNetBuy: number | null      // 기관 순매수 거래대금(원)
  individualNetBuy: number | null
  foreignNetVol: number | null   // 외국인 순매수(주) — 추정/확정 공통
  instNetVol: number | null
  source?: 'estimate' | 'confirmed'   // estimate=장중 추정(잠정), confirmed=확정 EOD
  estimateStage?: number | null       // 추정 차수(키움 1·2·3차). estimate일 때만
}

/** 종목 상세 전용 — 당일 기관/외국인 순매수 (KIS FHKST01010900). 장중 잠정치. */
export async function fetchInvestorFlow(ticker: string): Promise<InvestorFlow | null> {
  try {
    const res = await fetch(`${BASE}/realtime/investor?ticker=${encodeURIComponent(ticker)}`)
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

/** 장중 실시간 시세 배치 조회 (화면에 보이는 종목만). 장외 시간엔 빈 객체 반환. */
export async function fetchLiveQuotes(tickers: string[]): Promise<Record<string, LiveQuote>> {
  if (!tickers.length) return {}
  try {
    const res = await fetch(`${BASE}/realtime/quotes?tickers=${encodeURIComponent(tickers.join(','))}&market=${MARKET}`)
    if (!res.ok) return {}
    const list: LiveQuote[] = await res.json()
    const map: Record<string, LiveQuote> = {}
    for (const q of list) map[q.ticker] = q
    return map
  } catch { return {} }
}

export async function searchStocks(query: string): Promise<ScreenerItem[]> {
  if (!query.trim()) return []
  const params = new URLSearchParams({ market: MARKET, page: '0', size: '8', q: query.trim() })
  const res = await fetch(`${BASE}/screener?${params}`)
  if (!res.ok) return []
  const data = await res.json()
  const items: ScreenerItem[] = data.items ?? []
  return IS_US ? items.map(koName) : items
}

export async function fetchStockScore(securityId: number): Promise<ScreenerItem> {
  const res = await fetch(`${BASE}/screener/${securityId}`)
  if (!res.ok) throw new Error('score fetch failed')
  return koName(await res.json())
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

export interface NewsItem { title: string; source: string; date: string; url: string }
export async function fetchStockNews(ticker: string): Promise<NewsItem[]> {
  const res = await fetch(`${BASE}/news/${ticker}`)
  if (!res.ok) return []
  return res.json()
}

export async function fetchStockPrices(securityId: number, days = 365): Promise<PriceBar[]> {
  const res = await fetch(`${BASE}/screener/${securityId}/prices?days=${days}`)
  if (!res.ok) return []
  return res.json()
}

/** 분봉 1개 = epoch초(KST 벽시계) + OHLCV. KR 상세 차트 전용(장중 실시간 갱신은 live 시세). */
export interface MinuteBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** KR 국내 1분봉 (최근 days 거래일, 1~5). KIS on-demand — 분봉 인터벌 선택 시에만 호출. */
export async function fetchMinuteBars(ticker: string, days = 1): Promise<MinuteBar[]> {
  try {
    const res = await fetch(`${BASE}/realtime/minute?ticker=${encodeURIComponent(ticker)}&days=${days}`)
    if (!res.ok) return []
    return res.json()
  } catch { return [] }
}

export interface SectorPeer {
  securityId: number; ticker: string; name: string; compositeScore: number
  cScore: number | null; aScore: number | null; nScore: number | null
  sScore: number | null; iScore: number | null; closePrice: number | null
  isSelf: boolean
}
export async function fetchSectorPeers(securityId: number): Promise<SectorPeer[]> {
  const res = await fetch(`${BASE}/screener/${securityId}/sector-peers`)
  if (!res.ok) return []
  const list: SectorPeer[] = await res.json()
  return IS_US ? list.map(koName) : list
}

export async function fetchMacroQuotes(): Promise<MacroQuote[]> {
  const res = await fetch(`${BASE}/macro/quotes`)
  if (!res.ok) return []
  return res.json()
}

export interface CorrelationStock {
  ticker: string
  name: string
  compositeScore: number
  sector: string | null
}

export async function fetchCorrelations(securityId: number): Promise<CorrelationStock[]> {
  const res = await fetch(`${BASE}/screener/${securityId}/correlations`)
  if (!res.ok) return []
  const list: CorrelationStock[] = await res.json()
  return IS_US ? list.map(koName) : list
}
