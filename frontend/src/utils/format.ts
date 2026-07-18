import { IS_US } from '../config/market'

export function fmtPrice(v: number | null): string {
  if (v === null) return '—'
  // US: 달러 2자리($334.77). KR: 원 정수.
  if (IS_US) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 })
}

/** 한국 실시간 오버레이 창(평일 08:00~20:00 KST). 이 창에선 배치 시세가 전일 종가 기준이라
 *  실시간이 붙기 전 전일 등락률·상한가·상태뱃지를 노출하지 않도록 게이트에 쓴다. (백엔드 isKrMarketOpen과 동일 창) */
export function isKrMarketHours(): boolean {
  const now = new Date()
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000)
  const day = kst.getDay()
  if (day === 0 || day === 6) return false
  const mins = kst.getHours() * 60 + kst.getMinutes()
  return mins >= 480 && mins <= 1200   // 08:00 ~ 20:00
}

/** 미장 실시간 오버레이 창(평일 09:30~16:30 ET). DST 안전하게 Intl(America/New_York)로 계산.
 *  백엔드 isUsMarketOpen과 동일 창. KIS 해외주식 시세(HHDFS00000300)로 오버레이. */
export function isUsMarketHours(): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const wd = get('weekday')
  if (wd === 'Sat' || wd === 'Sun') return false
  let h = parseInt(get('hour'), 10)
  if (h === 24) h = 0
  const mins = h * 60 + parseInt(get('minute'), 10)
  return mins >= 570 && mins <= 990   // 09:30 ~ 16:30 ET
}

/** 실시간 오버레이 활성 창. US=ET 장중(KIS 해외주식), KR=KST 08:00~20:00. */
export function isLiveOverlayHours(): boolean {
  return IS_US ? isUsMarketHours() : isKrMarketHours()
}

export function fmtRate(v: number | null): string {
  return v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%'
}

/** USD 대금: $1.2T / $45.2B / $820M / $1,234 */
function fmtUsd(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e12) return '$' + (v / 1e12).toFixed(1) + 'T'
  if (a >= 1e9)  return '$' + (v / 1e9).toFixed(1) + 'B'
  if (a >= 1e6)  return '$' + (v / 1e6).toFixed(0) + 'M'
  return '$' + Math.round(v).toLocaleString('en-US')
}

/** 시가총액: US=$T/$B/$M, KR=조/천억/억 */
export function fmtMarketCap(v: number | null): string {
  if (v === null) return '—'
  if (IS_US) return fmtUsd(v)
  const b = v / 1e8
  if (b >= 10000) return Math.round(b / 10000) + '조'
  if (b >= 1000) return Math.round(b / 1000) + '천억'
  return Math.round(b) + '억'
}

/** 거래대금 등 금액: US=$B/$M, KR=천억/억 */
export function fmtAmt(v: number | null): string {
  if (v === null) return '—'
  if (IS_US) return fmtUsd(v)
  const b = v / 1e8
  if (b >= 1000) return Math.round(b / 1000) + '천억'
  return Math.round(b) + '억'
}

/** 거래량: US=M/K, KR=천만/만 */
export function fmtVolume(v: number | null): string {
  if (v === null) return '—'
  if (IS_US) {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
    if (v >= 1e3) return Math.round(v / 1e3) + 'K'
    return v.toLocaleString('en-US')
  }
  if (v >= 1e7) return Math.round(v / 1e7) + '천만'
  if (v >= 1e4) return Math.round(v / 1e4) + '만'
  return v.toLocaleString()
}

/** 재무 금액 → 억 단위 정수 (차트용) */
export function fmtFinAmt(v: number | null): number | null {
  return v === null ? null : Math.round(v / 1e8)
}

/** 거래량: 상세용. US=M/K sh, KR=천만주/만주 */
export function fmtVol(v: number | null): string {
  if (v === null) return '—'
  if (IS_US) {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M sh'
    if (v >= 1e3) return Math.round(v / 1e3) + 'K sh'
    return v.toLocaleString('en-US') + ' sh'
  }
  if (v >= 1e7) return Math.round(v / 1e7) + '천만주'
  return Math.round(v / 1e4) + '만주'
}

/** 순매수 금액 → 억 단위 부호 표기 */
export function fmtFlow(v: number | null): string {
  if (v === null) return '—'
  const b = v / 1e8
  return (b > 0 ? '+' : '') + Math.round(b) + '억'
}

/** 52주 고가 대비 등락률 */
export function fmtHigh52pct(close: number | null, high: number | null): string {
  if (!close || !high || high <= 0) return '—'
  const pct = (close - high) / high * 100
  return (pct >= 0 ? '+' : '') + Math.round(pct) + '%'
}
