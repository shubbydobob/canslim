// frontend/src/utils/canslim.ts
// CAN SLIM 팩터 메타 + 스코어→색/티어 매핑 (실제 index.css 변수 사용).
// 색은 전부 CSS 변수라 [data-theme] 라이트/다크에 자동 대응됩니다.
import type { ScreenerItem } from '../types'

export const CANSLIM = [
  { key: 'cScore', letter: 'C', name: '최근 분기 실적', desc: '최근 분기 EPS·매출 성장률' },
  { key: 'aScore', letter: 'A', name: '연간 실적',     desc: '연간 EPS 성장·ROE' },
  { key: 'nScore', letter: 'N', name: '신고가·신제품', desc: '52주 신고가·베이스 돌파' },
  { key: 'sScore', letter: 'S', name: '수급',          desc: '거래량·기관/외인 순매수' },
  { key: 'lScore', letter: 'L', name: '주도주',        desc: '상대강도·업종 내 순위' },
  { key: 'iScore', letter: 'I', name: '기관 수급',     desc: '기관 보유·프로그램 순매수' },
  { key: 'mScore', letter: 'M', name: '시장 방향',     desc: '시장 추세·M지수' },
] as const

export type CanslimKey = (typeof CANSLIM)[number]['key']

export interface Tier { color: string; label: string; tint: string }

/** 종합 스코어 → 티어(색·라벨·배경틴트). null은 미집계 처리. */
export function scoreTier(score: number | null): Tier {
  if (score == null) return { color: 'var(--text-4)', label: '미집계', tint: 'transparent' }
  if (score >= 80)   return { color: 'var(--accent-strong)', label: '매우 강함', tint: 'var(--accent-soft)' }
  if (score >= 68)   return { color: 'var(--accent)',        label: '강함',       tint: 'var(--accent-soft)' }
  if (score >= 52)   return { color: 'var(--accent)',        label: '보통',       tint: 'transparent' }
  return               { color: 'var(--text-3)',       label: '약함',       tint: 'transparent' }
}

/** 개별 팩터 값(0~100) → 막대 색. null(DART 커버리지 부족)은 연한 회색. */
export function factorColor(v: number | null): string {
  if (v == null) return 'var(--border-sub)'
  if (v >= 70)   return 'var(--accent)'
  if (v >= 45)   return 'color-mix(in srgb, var(--accent) 55%, var(--surface))'
  return           'color-mix(in srgb, var(--accent) 28%, var(--surface))'
}

/** ScreenerItem → C..M 7개 값 배열 (null 유지). 레이더/막대에 그대로 전달. */
export function canslimValues(item: ScreenerItem): (number | null)[] {
  return CANSLIM.map(m => item[m.key] as number | null)
}

/** 한국식 등락 색 (index.css --up/--down). */
export const changeColor = (chg: number | null): string =>
  chg == null ? 'var(--text-3)' : chg > 0 ? 'var(--up)' : chg < 0 ? 'var(--down)' : 'var(--text-3)'
