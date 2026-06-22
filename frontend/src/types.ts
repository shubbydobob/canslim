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
}
