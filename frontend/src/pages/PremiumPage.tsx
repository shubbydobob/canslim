import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchMe, isLoggedIn, logout } from '../api/auth'
import type { UserInfo } from '../api/auth'

const BENEFITS = [
  { icon: '🔔', title: '알림 무제한', free: '5개 종목 제한', premium: '무제한 관심종목 알림' },
  { icon: '📄', title: 'PDF 리포트 다운로드', free: '미지원', premium: '종목별 상세 PDF 리포트' },
  { icon: '🔬', title: '섹터별 심층 분석', free: '기본 섹터 비교', premium: '섹터 내 전체 종목 심층 분석' },
  { icon: '💼', title: '포트폴리오 추적', free: '미지원', premium: '보유 종목 수익률 추적' },
  { icon: '📊', title: '점수 히스토리', free: '30일', premium: '전체 기간 히스토리' },
  { icon: '⚡', title: '실시간 알림', free: '미지원', premium: '브레이크아웃 즉시 알림 (예정)' },
]

export default function PremiumPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isLoggedIn()) {
      setLoading(false)
      return
    }
    fetchMe().then(u => { setUser(u); setLoading(false) })
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center',
      height: '100vh', color: 'var(--text-3)', background: 'var(--bg-nav)' }}>
      로딩 중...
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-nav)', color: 'var(--text-1)' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--border)', padding: '12px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg-nav)',
      }}>
        <button onClick={() => navigate('/')}
          style={{ color: 'var(--text-2)', fontSize: 14, cursor: 'pointer', background: 'none', border: 'none', fontFamily: 'var(--font-mono)', letterSpacing: '0.5px' }}>
          ← NEXT<span style={{ color: 'var(--accent)' }}>PICK</span>
        </button>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#6b7280' }}>{user.email}</span>
            <button onClick={handleLogout}
              style={{ fontSize: 12, color: 'var(--text-3)', background: 'none', border: '1px solid var(--border)',
                borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}>
              로그아웃
            </button>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 700, margin: '0 auto', padding: '40px 28px 80px' }}>
        {/* 현재 플랜 */}
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12,
          padding: '28px 28px', marginBottom: 32,
        }}>
          {user ? (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, marginBottom: 6 }}>현재 플랜</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: user.plan === 'premium' ? '#fabd44' : 'var(--text-1)' }}>
                  {user.plan === 'premium' ? '✦ 프리미엄' : '무료 플랜'}
                </div>
                {user.plan === 'premium' && user.expiresAt && (
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    만료: {new Date(user.expiresAt).toLocaleDateString('ko-KR')}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>{user.email}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>
                로그인이 필요합니다
              </div>
              <button onClick={() => navigate('/auth')}
                style={{
                  padding: '8px 20px', background: 'var(--accent)', border: 'none',
                  borderRadius: 6, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}>
                로그인 / 회원가입
              </button>
            </>
          )}
        </div>

        {/* 혜택 비교 */}
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.08em', marginBottom: 14 }}>
          플랜 비교
        </div>
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
          overflow: 'hidden', marginBottom: 32,
        }}>
          {/* 컬럼 헤더 */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-nav)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>기능</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, textAlign: 'center' }}>무료</div>
            <div style={{ fontSize: 12, color: '#fabd44', fontWeight: 700, textAlign: 'center' }}>✦ 프리미엄</div>
          </div>

          {BENEFITS.map((b, i) => (
            <div key={b.title} style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
              padding: '12px 16px',
              borderBottom: i < BENEFITS.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15 }}>{b.icon}</span>
                <span style={{ fontSize: 13, color: '#c9d1d9', fontWeight: 600 }}>{b.title}</span>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {b.free === '미지원' ? <span style={{ color: '#374151' }}>✕</span> : b.free}
              </div>
              <div style={{ fontSize: 12, color: '#4ade80', textAlign: 'center', fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <span style={{ color: '#4ade80' }}>✓</span> {b.premium}
              </div>
            </div>
          ))}
        </div>

        {/* 업그레이드 CTA */}
        {user?.plan !== 'premium' && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(31,111,235,0.15) 0%, rgba(250,189,68,0.08) 100%)',
            border: '1px solid rgba(31,111,235,0.3)', borderRadius: 10,
            padding: '28px 28px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)', marginBottom: 8 }}>
              프리미엄 업그레이드
            </div>
            <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 20, lineHeight: 1.7 }}>
              NEXTPICK의 분석 도구를 최대한 활용하세요.<br />
              고급 분석 도구와 무제한 알림으로 투자 엣지를 확보하세요.
            </div>
            <a
              href="mailto:contact@nextpick.kr?subject=프리미엄 구독 문의"
              style={{
                display: 'inline-block',
                padding: '12px 32px', background: 'var(--accent)', border: 'none',
                borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 700,
                textDecoration: 'none', cursor: 'pointer',
              }}>
              문의하기 (Toss Payments 연동 예정)
            </a>
            <div style={{ fontSize: 11, color: '#374151', marginTop: 12 }}>
              현재 베타 서비스 중 — 출시 시 별도 안내 예정
            </div>
          </div>
        )}

        {user?.plan === 'premium' && (
          <div style={{
            background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)',
            borderRadius: 10, padding: '20px 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#4ade80', marginBottom: 6 }}>
              ✦ 프리미엄 멤버
            </div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              모든 프리미엄 기능을 이용하실 수 있습니다.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
