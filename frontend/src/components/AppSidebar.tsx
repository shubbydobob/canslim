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
  onToggleCollapse?: () => void
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

export default function AppSidebar({ activeTab, onTabChange, watchlistCount, totalStocks, collapsed, onToggleCollapse }: Props) {
  const isMobile = useIsMobile()

  // 모바일/앱: 좌측 사이드바 대신 하단 고정 탭바 (앱 관례)
  if (isMobile) {
    return (
      <nav className="sb-tabbar">
        {NAV_ITEMS.map(item => {
          const active = activeTab === item.id
          return (
            <button key={item.id} onClick={() => onTabChange(item.id)}
              className={active ? 'sb-tab on' : 'sb-tab'}>
              <span className="sb-tab-icon">{item.icon}</span>
              <span className="sb-tab-label">{item.label}</span>
              {item.id === 'watchlist' && watchlistCount > 0 && (
                <span className="sb-tab-badge">{watchlistCount}</span>
              )}
            </button>
          )
        })}
      </nav>
    )
  }

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <div className="sb-head">
        <span className="sb-label">메뉴</span>
        <button className="sb-collapse-btn" onClick={onToggleCollapse}
          title={collapsed ? '메뉴 펼치기' : '메뉴 접기'} aria-label={collapsed ? '메뉴 펼치기' : '메뉴 접기'}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      <nav className="sb-nav">
        {NAV_ITEMS.map(item => {
          const active = activeTab === item.id
          return (
            <button key={item.id} onClick={() => onTabChange(item.id)}
              className={active ? 'sb-item on' : 'sb-item'} title={collapsed ? item.label : undefined}>
              {active && <span className="sb-item-bar" />}
              <span className="sb-item-icon">{item.icon}</span>
              <span className="sb-item-label">{item.label}</span>
              {item.id === 'watchlist' && watchlistCount > 0 && (
                <span className="sb-count">{watchlistCount}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="sb-spacer" />
      <div className="sb-divider" />

      <div className="sb-bottom">
        <div className="sb-total">
          <span className="sb-total-dot" />
          {totalStocks.toLocaleString()}개 종목 · 종합 스코어
        </div>
      </div>
    </aside>
  )
}
