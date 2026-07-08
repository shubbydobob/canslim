import { useState } from 'react'
import type { ScreenerItem } from '../types'
import type { LiveQuote } from '../api/client'
import { useIsMobile } from '../hooks/useIsMobile'
import StatusBadges from '../components/StatusBadges'
import { scoreFg, changeColor } from '../utils/canslim'
import { fmtRate } from '../utils/format'

interface Props {
  items: ScreenerItem[]
  loading: boolean
  onStockClick: (id: number) => void
  liveMap?: Record<string, LiveQuote>
}

export default function RankingView({ items, loading, onStockClick, liveMap }: Props) {
  const [hovered, setHovered] = useState<number | null>(null)
  const isMobile = useIsMobile()

  const topItems = [...items]
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, 50)
  const maxScore = topItems[0]?.compositeScore ?? 100

  // 장중 라이브 오버레이 — 등락률·특이사항(뱃지) 병합.
  // 뱃지는 장중이면 실시간(q.statuses), 장외/미조회면 EOD 배치 스냅샷(item.statuses).
  const liveOf = (item: ScreenerItem) => {
    const q = liveMap?.[item.ticker]
    return {
      changeRate: q?.changeRate ?? item.changeRate,
      statuses: q?.statuses ?? item.statuses ?? null,
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '80px 0', color: 'var(--text-3)', fontSize: 13 }}>
        <span className="spinner" />
        랭킹 데이터 로딩 중...
      </div>
    )
  }

  const medalColor = (idx: number) =>
    idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : idx === 2 ? '#CD7F32' : null

  // ── 모바일: 카드형 리스트 (고정 그리드 대신 flex — 간격 정상화) ──────────
  if (isMobile) {
    return (
      <div style={{ padding: '16px 12px' }}>
        <div style={{ marginBottom: 14, padding: '0 4px' }}>
          <h1 style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.02em', marginBottom: 2 }}>
            스코어 랭킹
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-3)' }}>종합점수 기준 상위 50개 종목</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {topItems.map((item, idx) => {
            const live = liveOf(item)
            const sc = scoreFg(item.compositeScore)
            const barPct = maxScore > 0 ? (item.compositeScore / maxScore) * 100 : 0
            const medal = medalColor(idx)

            return (
              <div
                key={item.securityId}
                onClick={() => onStockClick(item.securityId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  background: 'var(--bg-nav)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  cursor: 'pointer',
                }}
              >
                {/* 순위 */}
                <div style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: medal ?? 'var(--text-4)',
                  fontFamily: 'var(--font-mono)',
                  minWidth: 24,
                  textAlign: 'center',
                  flexShrink: 0,
                }}>
                  {idx + 1}
                </div>

                {/* 종목명 · 티커 · 뱃지 · 바 */}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 15, fontWeight: 700, color: 'var(--text-1)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
                    }}>
                      {item.name}
                    </span>
                    {item.breakoutToday && (
                      <span style={{ fontSize: 9, background: '#16a34a', color: '#fff', borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>NEW</span>
                    )}
                    <StatusBadges statuses={live.statuses} size="xs" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {item.ticker}
                    </span>
                    {item.sector && (
                      <span style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        · {item.sector}
                      </span>
                    )}
                  </div>
                  <div style={{ height: 4, background: 'var(--track)', borderRadius: 2, overflow: 'hidden', marginTop: 7 }}>
                    <div style={{ height: '100%', width: `${barPct}%`, background: sc, borderRadius: 2, transition: 'width 0.4s' }} />
                  </div>
                </div>

                {/* 점수 · 등락률 */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: sc, fontFamily: 'var(--font-mono)', lineHeight: 1, letterSpacing: '-0.02em' }}>
                    {Math.round(item.compositeScore)}
                    <span style={{ fontSize: 10, color: 'var(--text-4)', marginLeft: 2, fontWeight: 400 }}>점</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: changeColor(live.changeRate), fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                    {fmtRate(live.changeRate)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── 데스크톱: 테이블 그리드 ────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{
          fontSize: 22,
          fontWeight: 800,
          color: 'var(--text-1)',
          letterSpacing: '-0.02em',
          marginBottom: 4,
        }}>
          스코어 랭킹
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
          종합점수 기준 상위 50개 종목
        </p>
      </div>

      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '36px 28px 100px 1fr 120px 52px 60px',
          gap: 0,
          padding: '10px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
        }}>
          {['순위', '#', '티커', '종목명', '스코어', '등락률', '섹터'].map((h, i) => (
            <div key={i} style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.07em',
              color: 'var(--text-4)',
              textTransform: 'uppercase',
              textAlign: i === 0 ? 'center' : i >= 5 ? 'right' : 'left',
            }}>
              {h}
            </div>
          ))}
        </div>

        {topItems.map((item, idx) => {
          const live = liveOf(item)
          const sc = scoreFg(item.compositeScore)
          const isHov = hovered === item.securityId
          const barPct = maxScore > 0 ? (item.compositeScore / maxScore) * 100 : 0
          const medal = medalColor(idx)

          return (
            <div
              key={item.securityId}
              onClick={() => onStockClick(item.securityId)}
              onMouseEnter={() => setHovered(item.securityId)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: 'grid',
                gridTemplateColumns: '36px 28px 100px 1fr 120px 52px 60px',
                gap: 0,
                padding: '10px 20px',
                cursor: 'pointer',
                background: isHov ? 'var(--bg-elevated)' : idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                borderBottom: '1px solid var(--border)',
                transition: 'background 0.1s',
                alignItems: 'center',
              }}
            >
              {/* Rank number */}
              <div style={{
                fontSize: 13,
                fontWeight: 800,
                color: medal ?? 'var(--text-4)',
                fontFamily: 'var(--font-mono)',
                textAlign: 'center',
              }}>
                {idx + 1}
              </div>

              {/* Market rank */}
              <div style={{
                fontSize: 10,
                color: 'var(--text-4)',
                fontFamily: 'var(--font-mono)',
              }}>
                {item.marketRank}
              </div>

              {/* Ticker */}
              <div style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--accent)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.03em',
              }}>
                {item.ticker}
                {item.breakoutToday && (
                  <span style={{
                    fontSize: 9, background: '#16a34a', color: '#fff',
                    borderRadius: 3, padding: '1px 4px', marginLeft: 5,
                  }}>NEW</span>
                )}
              </div>

              {/* Name + badges + bar */}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-1)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {item.name}
                  </span>
                  <StatusBadges statuses={live.statuses} size="sm" />
                </div>
                <div style={{
                  height: 4,
                  background: 'var(--track)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  maxWidth: 200,
                }}>
                  <div style={{
                    height: '100%',
                    width: `${barPct}%`,
                    background: sc,
                    borderRadius: 2,
                    transition: 'width 0.4s',
                  }} />
                </div>
              </div>

              {/* Score */}
              <div style={{
                fontSize: 18,
                fontWeight: 800,
                color: sc,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '-0.02em',
              }}>
                {Math.round(item.compositeScore)}
                <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 3, fontWeight: 400 }}>점</span>
              </div>

              {/* Change rate */}
              <div style={{
                fontSize: 12,
                fontWeight: 700,
                color: changeColor(live.changeRate),
                fontFamily: 'var(--font-mono)',
                textAlign: 'right',
              }}>
                {fmtRate(live.changeRate)}
              </div>

              {/* Sector */}
              <div style={{
                fontSize: 10,
                color: 'var(--text-3)',
                textAlign: 'right',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {item.sector ?? '—'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
