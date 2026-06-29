import { useEffect, useState } from 'react'
import { getToken } from '../api/auth'

interface MarketStateRow {
  market: string
  stateDate?: string
  marketPhase?: string
  trendDirection?: string
  indexClose?: number
  ma50d?: number
  ma200d?: number
  distributionDayCount?: number
}

interface HistoryRow {
  stateDate: string
  marketPhase: string
  trendDirection: string
  indexClose: number
  ma50d: number
  ma200d: number
}

const PHASE_STYLE: Record<string, string> = {
  BULL:       'bg-green-900 text-green-200',
  CORRECTION: 'bg-yellow-900 text-yellow-200',
  BEAR:       'bg-red-900 text-red-200',
  UNKNOWN:    'bg-gray-700 text-gray-300',
}

const TREND_SYMBOL: Record<string, string> = {
  UP:       '↑',
  DOWN:     '↓',
  SIDEWAYS: '→',
}

function adminHeaders(): HeadersInit {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function AdminPage() {
  const [states, setStates] = useState<MarketStateRow[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [historyMarket, setHistoryMarket] = useState('KOSPI')
  const [scoring, setScoring] = useState<{ status: string; elapsedMs?: number } | null>(null)
  const [scoringLoading, setScoringLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchState = () =>
    fetch('/api/admin/market-state', { headers: adminHeaders() })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then(setStates)
      .catch(e => setError(`시장 국면 조회 실패: ${e.message}`))

  const fetchHistory = (market: string) =>
    fetch(`/api/admin/market-state/history?market=${market}&days=30`, { headers: adminHeaders() })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then((data: HistoryRow[]) => setHistory([...data].reverse()))
      .catch(e => setError(`이력 조회 실패: ${e.message}`))

  useEffect(() => { fetchState() }, [])
  useEffect(() => { fetchHistory(historyMarket) }, [historyMarket])

  const runScoring = async () => {
    setScoringLoading(true)
    setScoring(null)
    setError(null)
    try {
      const r = await fetch('/api/admin/scoring/run', { method: 'POST', headers: adminHeaders() })
      if (!r.ok) throw new Error(`${r.status}`)
      const d = await r.json()
      setScoring(d)
      fetchState()
    } catch (e) {
      setError(`스코어링 실행 실패: ${e instanceof Error ? e.message : e}`)
    } finally {
      setScoringLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-8">

        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Admin</h1>
          <a href="/" className="text-sm text-gray-400 hover:text-white">← 스크리너</a>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {/* 시장 국면 카드 */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">시장 국면</h2>
          <div className="grid grid-cols-2 gap-4">
            {states.map(s => (
              <div key={s.market} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-lg font-bold">{s.market}</span>
                  <span className={`text-xs font-semibold px-2 py-1 rounded ${PHASE_STYLE[s.marketPhase ?? 'UNKNOWN']}`}>
                    {s.marketPhase ?? 'UNKNOWN'}
                  </span>
                </div>
                {s.stateDate && (
                  <div className="space-y-1 text-sm text-gray-300">
                    <div className="flex justify-between">
                      <span className="text-gray-500">기준일</span>
                      <span>{s.stateDate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">추세</span>
                      <span>{TREND_SYMBOL[s.trendDirection ?? ''] ?? '-'} {s.trendDirection}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">종가(프록시)</span>
                      <span>{s.indexClose?.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">MA50</span>
                      <span className={s.indexClose && s.ma50d && s.indexClose > s.ma50d ? 'text-green-400' : 'text-red-400'}>
                        {s.ma50d?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">MA200</span>
                      <span className={s.indexClose && s.ma200d && s.indexClose > s.ma200d ? 'text-green-400' : 'text-red-400'}>
                        {s.ma200d?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">배분일</span>
                      <span className={Number(s.distributionDayCount) >= 4 ? 'text-red-400 font-bold' : ''}>
                        {s.distributionDayCount ?? 0}일
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* 30일 이력 */}
        <section>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">국면 이력 (최근 30일)</h2>
            <div className="flex gap-2">
              {['KOSPI', 'KOSDAQ'].map(m => (
                <button
                  key={m}
                  onClick={() => setHistoryMarket(m)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    historyMarket === m
                      ? 'border-blue-500 bg-blue-900 text-blue-200'
                      : 'border-gray-700 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 text-xs">
                  <th className="px-4 py-2 text-left">날짜</th>
                  <th className="px-4 py-2 text-left">국면</th>
                  <th className="px-4 py-2 text-left">추세</th>
                  <th className="px-4 py-2 text-right">종가</th>
                  <th className="px-4 py-2 text-right">MA50</th>
                  <th className="px-4 py-2 text-right">MA200</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.stateDate} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-2 text-gray-400">{h.stateDate}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${PHASE_STYLE[h.marketPhase] ?? PHASE_STYLE.UNKNOWN}`}>
                        {h.marketPhase}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-300">{TREND_SYMBOL[h.trendDirection] ?? '-'}</td>
                    <td className="px-4 py-2 text-right text-gray-200">{Number(h.indexClose).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-2 text-right text-gray-400">{Number(h.ma50d).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-2 text-right text-gray-400">{Number(h.ma200d).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 스코어링 실행 */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">스코어링</h2>
          <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 flex items-center gap-4">
            <button
              onClick={runScoring}
              disabled={scoringLoading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {scoringLoading ? '실행 중...' : '스코어링 실행'}
            </button>
            {scoring && (
              <span className="text-sm text-gray-300">
                {scoring.status === 'completed'
                  ? `완료 (${((scoring.elapsedMs ?? 0) / 1000).toFixed(1)}s)`
                  : scoring.status}
              </span>
            )}
          </div>
        </section>

      </div>
    </div>
  )
}
