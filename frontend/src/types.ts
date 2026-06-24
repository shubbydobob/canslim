export interface ScreenerItem {
  securityId: number
  ticker: string
  name: string
  market: string
  scoreDate: string
  marketRank: number
  marketPercentile: number
  compositeScore: number
  cScore: number | null
  aScore: number | null
  nScore: number | null
  sScore: number | null
  lScore: number | null
  iScore: number | null
  mScore: number | null
  closePrice: number | null
  changeRate: number | null
  weekHigh52: number | null
  volume: number | null
  turnover: number | null
  instNetBuy10d: number | null
  foreignNetBuy10d: number | null
  marketCap: number | null
  sector: string | null
}

export interface ScreenerPage {
  items: ScreenerItem[]
  total: number
  page: number
  size: number
}

export interface ScoreHistory {
  scoreDate: string
  compositeScore: number
  marketRank: number
  marketPercentile: number
  cScore: number | null
  aScore: number | null
  nScore: number | null
  sScore: number | null
  lScore: number | null
  iScore: number | null
  mScore: number | null
}

export interface FinancialRecord {
  fiscalYear: number
  fiscalQuarter: number
  periodType: string
  periodEndDate: string
  revenue: number | null
  operatingIncome: number | null
  netIncome: number | null
  eps: number | null
}

export interface PriceBar {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

export interface MacroQuote {
  symbol: string
  name: string
  price: number | null
  change: number | null
  changePct: number | null
  currency: string | null
  marketState: string | null
}
