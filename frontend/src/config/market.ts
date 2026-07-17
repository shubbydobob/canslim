// 화면이 대상으로 하는 시장. 빌드 시 VITE_MARKET로 주입(기본 KR).
// US 화면은 같은 백엔드를 쓰되 VITE_MARKET=US로 별도 Vercel 배포한다.
export const MARKET = ((import.meta.env.VITE_MARKET as string | undefined) || 'KR').toUpperCase()
export const IS_US = MARKET === 'US'
export const CURRENCY: 'USD' | 'KRW' = IS_US ? 'USD' : 'KRW'

// 등락색: 한국식(상승=빨강/하락=파랑) vs 미국식(상승=초록/하락=빨강).
// 백엔드/기존 CSS는 한국식 토큰(--sc-*) 기준 → US는 CSS 변수 오버라이드로 대응(추후).
export const UP_IS_RED = !IS_US
