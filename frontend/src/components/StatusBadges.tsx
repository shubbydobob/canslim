/**
 * 종목 특이사항 뱃지 — 거래정지·투자주의/경고/위험·관리종목·단기과열 등.
 *
 * 데이터 출처: KIS 주식현재가시세(FHKST01010100)의 종목상태/시장경고/단기과열 코드.
 * 백엔드 /api/realtime/quotes 가 statuses(string[])로 내려주며, 장중 오버레이 창에서만 채워진다.
 * (장외 시간엔 KIS가 상태를 주지 않으므로 뱃지도 표시되지 않음 — 실시간 시세와 동일한 정책.)
 */

// 심각도 높은 순으로 정렬 우선순위 + index.css 공통 뱃지 클래스(테마 자동 대비).
const BADGE_STYLES: Record<string, { order: number; cls: string }> = {
  거래정지: { order: 0, cls: 'badge-halt' },
  정리매매: { order: 1, cls: 'badge-liquidation' },
  위험:     { order: 2, cls: 'badge-danger' },
  경고:     { order: 3, cls: 'badge-warn' },
  주의:     { order: 4, cls: 'badge-caution' },
  과열:     { order: 5, cls: 'badge-overheat' },
  관리:     { order: 6, cls: 'badge-manage' },
}

// 뱃지 라벨을 좀 더 명확한 표기로 (툴팁·접근성용).
const FULL_LABEL: Record<string, string> = {
  거래정지: '거래정지 — 매매 중단 상태',
  정리매매: '정리매매 — 상장폐지 절차 진행',
  위험: '투자위험 — 시장경보 3단계',
  경고: '투자경고 — 시장경보 2단계',
  주의: '투자주의 — 시장경보 1단계',
  과열: '단기과열 — 단기 급등락 지정',
  관리: '관리종목 — 상장폐지 우려',
}

interface Props {
  statuses?: string[] | null
  size?: 'sm' | 'xs'
}

export default function StatusBadges({ statuses, size = 'sm' }: Props) {
  if (!statuses || statuses.length === 0) return null

  const sorted = [...new Set(statuses)]
    .filter(s => BADGE_STYLES[s])
    .sort((a, b) => BADGE_STYLES[a].order - BADGE_STYLES[b].order)

  if (sorted.length === 0) return null

  const sizeCls = size === 'xs' ? 'badge-xs' : 'badge-sm'

  return (
    <span style={{ display: 'inline-flex', gap: 3, flexShrink: 0, verticalAlign: 'middle' }}>
      {sorted.map(s => (
        <span key={s} className={`badge ${sizeCls} ${BADGE_STYLES[s].cls}`} title={FULL_LABEL[s] ?? s}>
          {s}
        </span>
      ))}
    </span>
  )
}
