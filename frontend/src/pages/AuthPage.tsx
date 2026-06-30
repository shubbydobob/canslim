import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, register } from '../api/auth'

type Tab = 'login' | 'register'

export default function AuthPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      if (tab === 'login') {
        await login(email.trim(), password)
        navigate('/')
      } else {
        await register(email.trim(), password)
        setSuccess('회원가입 완료! 로그인하세요.')
        setTab('login')
        setPassword('')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#1b212c',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 400, margin: '0 16px',
        background: '#1e242f', border: '1px solid #2d3440',
        borderRadius: 12, padding: '36px 32px',
      }}>
        {/* 로고 */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>
            성장주<span style={{ color: '#1f6feb' }}>스크리너</span>
          </div>
          <div style={{ fontSize: 12, color: '#7c8694', marginTop: 4 }}>CAN SLIM 기반 종목 분석</div>
        </div>

        {/* 탭 */}
        <div style={{
          display: 'flex', marginBottom: 24,
          border: '1px solid #2d3440', borderRadius: 6, overflow: 'hidden',
        }}>
          {(['login', 'register'] as Tab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(null); setSuccess(null) }}
              style={{
                flex: 1, padding: '8px 0', fontSize: 14, fontWeight: 600, border: 'none',
                cursor: 'pointer', transition: 'all 0.15s',
                background: tab === t ? '#1f6feb' : 'transparent',
                color: tab === t ? '#fff' : '#6b7280',
              }}>
              {t === 'login' ? '로그인' : '회원가입'}
            </button>
          ))}
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: '#adb6c2', fontWeight: 600, display: 'block', marginBottom: 5 }}>
              이메일
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required autoComplete="email"
              style={{
                width: '100%', padding: '9px 12px', fontSize: 14,
                background: '#1b212c', border: '1px solid #3a414e', borderRadius: 6,
                color: '#f0f4f9', outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => (e.target.style.borderColor = '#1f6feb')}
              onBlur={e => (e.target.style.borderColor = '#3a414e')}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#adb6c2', fontWeight: 600, display: 'block', marginBottom: 5 }}>
              비밀번호 {tab === 'register' && <span style={{ color: '#6e7681', fontWeight: 400 }}>(6자 이상)</span>}
            </label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required minLength={tab === 'register' ? 6 : 1}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              style={{
                width: '100%', padding: '9px 12px', fontSize: 14,
                background: '#1b212c', border: '1px solid #3a414e', borderRadius: 6,
                color: '#f0f4f9', outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => (e.target.style.borderColor = '#1f6feb')}
              onBlur={e => (e.target.style.borderColor = '#3a414e')}
            />
          </div>

          {error && (
            <div style={{
              background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#f87171',
            }}>{error}</div>
          )}

          {success && (
            <div style={{
              background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
              borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#4ade80',
            }}>{success}</div>
          )}

          <button type="submit" disabled={loading}
            style={{
              padding: '10px 0', fontSize: 14, fontWeight: 700, border: 'none',
              borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? '#3a414e' : '#1f6feb', color: '#fff',
              marginTop: 4, transition: 'background 0.15s',
            }}>
            {loading ? '처리 중...' : tab === 'login' ? '로그인' : '회원가입'}
          </button>
        </form>

        {/* 하단 링크 */}
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <button onClick={() => navigate('/')}
            style={{ fontSize: 12, color: '#7c8694', background: 'none', border: 'none', cursor: 'pointer' }}>
            ← 스크리너로 돌아가기
          </button>
        </div>
      </div>
    </div>
  )
}
