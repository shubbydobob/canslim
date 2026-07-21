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
  programNetBuy10d: number | null
  afterHoursPrice: number | null
  afterHoursChangeRate: number | null
  marketCap: number | null
  sector: string | null
  scoreDelta: number | null
  breakoutToday: boolean
  baseDays: number | null
  statuses?: string[] | null   // 거래정지·주의·경고·위험·과열·관리·정리매매 (EOD 배치 스냅샷)
  // KIS 밸류에이션 EOD 스냅샷(장외 폴백; 장중엔 LiveQuote가 실시간 오버레이)
  per?: number | null
  pbr?: number | null
  eps?: number | null
  bps?: number | null
  exchange?: string | null     // US 전용: KIS EXCD(NAS/NYS/AMS). KR은 null. TradingView 심볼 프리픽스용.
  // 장중 실시간 당일 순매수(원) — 프론트에서 라이브 오버레이 병합용 (백엔드 응답엔 없음)
  foreignNetBuyToday?: number | null
  instNetBuyToday?: number | null
  programNetBuyToday?: number | null
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
  roe: number | null
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
