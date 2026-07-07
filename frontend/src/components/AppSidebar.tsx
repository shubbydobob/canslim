import React from 'react'
import { useIsMobile } from '../hooks/useIsMobile'

type MainTab = 'dashboard' | 'ranking' | 'screener' | 'watchlist'

interface SectorSummary {
  name: string
  change: number
}

interface Props {
  activeTab: MainTab
  onTabChange: (tab: MainTab) => void
  watchlistCount: number
  topSector: SectorSummary | null
  totalStocks: number
  collapsed?: boolean
}

const NAV_ITEMS: { id: MainTab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'dashboard',
    label: '대시보드',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9"/>
        <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9"/>
        <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9"/>
        <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9"/>
      </svg>
    ),
  },
  {
    id: 'ranking',
    label: '스코어 랭킹',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 12h2v2H2zM6 8h2v6H6zM10 5h2v9h-2zM14 2h2v12h-2z" fill="currentColor" opacity="0.9" transform="translate(-1,0)"/>
        <path d="M2 12h2.5v2H2zM6.5 8h2.5v6H6.5zM11 4.5h2.5v9.5H11z" fill="currentColor" opacity="0.9"/>
      </svg>
    ),
  },
  {
    id: 'screener',
    label: '스크리너',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="3" width="14" height="1.5" rx="0.75" fill="currentColor" opacity="0.9"/>
        <rect x="3" y="7" width="10" height="1.5" rx="0.75" fill="currentColor" opacity="0.9"/>
        <rect x="5" y="11" width="6" height="1.5" rx="0.75" fill="currentColor" opacity="0.9"/>
      </svg>
    ),
  },
  {
    id: 'watchlist',
    label: '관심종목',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 1.5l1.854 3.757 4.146.603-3 2.924.708 4.128L8 10.757l-3.708 1.955.708-4.128L2 5.66l4.146-.603L8 1.5z" fill="currentColor" opacity="0.9"/>
      </svg>
    ),
  },
]

export default function AppSidebar({ activeTab, onTabChange, watchlistCount, topSector, totalStocks }: Props) {
  const isMobile = useIsMobile()

  // 모바일/앱: 좌측 사이드바 대신 하단 고정 탭바 (앱 관례)
  if (isMobile) {
    return (
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        height: 56, background: 'var(--bg-nav)', borderTop: '1px solid var(--border)',
        display: 'flex', boxShadow: '0 -2px 12px rgba(0,0,0,0.15)',
      }}>
        {NAV_ITEMS.map(item => {
          const active = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 3,
                background: 'none', border: 'none', cursor: 'pointer', position: 'relative',
                color: active ? 'var(--accent)' : 'var(--text-3)',
              }}
            >
              <span style={{ display: 'flex', opacity: active ? 1 : 0.75 }}>{item.icon}</span>
              <span style={{ fontSize: 10, fontWeight: active ? 700 : 500 }}>{item.label}</span>
              {item.id === 'watchlist' && watchlistCount > 0 && (
                <span style={{
                  position: 'absolute', top: 4, left: '50%', marginLeft: 6,
                  background: 'var(--accent)', color: '#fff', borderRadius: 999,
                  fontSize: 9, fontWeight: 700, padding: '0 4px', minWidth: 14, textAlign: 'center',
                }}>{watchlistCount}</span>
              )}
            </button>
          )
        })}
      </nav>
    )
  }

  return (
    <aside style={{
      width: 220,
      flexShrink: 0,
      background: 'var(--bg-nav)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      position: 'sticky',
      top: 0,
      overflowY: 'auto',
    }}>
      {/* Nav section label */}
      <div style={{
        padding: '20px 16px 8px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.1em',
        color: 'var(--text-4)',
        textTransform: 'uppercase',
      }}>
        메뉴
      </div>

      {/* Nav items */}
      <nav style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map(item => {
          const active = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 10px',
                borderRadius: 8,
                background: active ? 'var(--accent-soft)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-2)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                textAlign: 'left',
                width: '100%',
                transition: 'background 0.12s, color 0.12s',
                position: 'relative',
              }}
              onMouseEnter={e => {
                if (!active) {
                  e.currentTarget.style.background = 'var(--bg-elevated)'
                  e.currentTarget.style.color = 'var(--text-1)'
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--text-2)'
                }
              }}
            >
              {/* Active indicator bar */}
              {active && (
                <span style={{
                  position: 'absolute',
                  left: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 3,
                  height: 20,
                  borderRadius: '0 2px 2px 0',
                  background: 'var(--accent)',
                }} />
              )}
              <span style={{
                display: 'flex',
                alignItems: 'center',
                opacity: active ? 1 : 0.7,
              }}>
                {item.icon}
              </span>
              <span>{item.label}</span>
              {/* Watchlist count badge */}
              {item.id === 'watchlist' && watchlistCount > 0 && (
                <span style={{
                  marginLeft: 'auto',
                  background: active ? 'var(--accent)' : 'var(--bg-elevated)',
                  color: active ? '#fff' : 'var(--text-3)',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 6px',
                  minWidth: 18,
                  textAlign: 'center',
                }}>
                  {watchlistCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Divider */}
      <div style={{ flex: 1 }} />
      <div style={{ height: 1, background: 'var(--border)', margin: '0 16px' }} />

      {/* Bottom: 오늘의 주도 섹터 */}
      <div style={{ padding: '14px 16px 20px' }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.1em',
          color: 'var(--text-4)',
          textTransform: 'uppercase',
          marginBottom: 10,
        }}>
          오늘의 주도 섹터
        </div>

        {topSector ? (
          <div style={{
            background: 'var(--bg-elevated)',
            borderRadius: 8,
            padding: '10px 12px',
            border: '1px solid var(--border)',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 4,
            }}>
              <span style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-1)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 110,
              }}>
                {topSector.name}
              </span>
              <span style={{
                fontSize: 12,
                fontWeight: 700,
                color: topSector.change >= 0 ? 'var(--up)' : 'var(--down)',
                fontFamily: 'var(--font-mono)',
                flexShrink: 0,
              }}>
                {topSector.change >= 0 ? '+' : ''}{topSector.change.toFixed(1)}%
              </span>
            </div>
            {/* Mini bar */}
            <div style={{
              height: 3,
              background: 'var(--border)',
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, Math.abs(topSector.change) * 20)}%`,
                background: topSector.change >= 0 ? 'var(--up)' : 'var(--down)',
                borderRadius: 2,
                transition: 'width 0.4s',
              }} />
            </div>
          </div>
        ) : (
          <div style={{
            height: 48,
            background: 'var(--bg-elevated)',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }} />
        )}

        {/* Total stocks info */}
        <div style={{
          marginTop: 10,
          fontSize: 10,
          color: 'var(--text-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          <span style={{
            display: 'inline-block',
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'var(--accent)',
            flexShrink: 0,
          }} />
          {totalStocks.toLocaleString()}개 종목 · 종합 스코어
        </div>
      </div>
    </aside>
  )
}
