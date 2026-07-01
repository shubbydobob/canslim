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
      minHeight: '100vh', background: 'var(--bg-nav)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 400, margin: '0 16px',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '36px 32px',
      }}>
        {/* 로고 */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 800, letterSpacing: '1.5px',
            display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, background: 'var(--accent)', borderRadius: 2, display: 'inline-block' }} />
            NEXT<span style={{ color: 'var(--accent)' }}>PICK</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6, letterSpacing: '0.04em' }}>주도주 스코어 스크리너</div>
        </div>

        {/* 탭 */}
        <div style={{
          display: 'flex', marginBottom: 24,
          border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden',
        }}>
          {(['login', 'register'] as Tab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(null); setSuccess(null) }}
              style={{
                flex: 1, padding: '8px 0', fontSize: 14, fontWeight: 600, border: 'none',
                cursor: 'pointer', transition: 'all 0.15s',
                background: tab === t ? 'var(--accent)' : 'transparent',
                color: tab === t ? '#fff' : '#6b7280',
              }}>
              {t === 'login' ? '로그인' : '회원가입'}
            </button>
          ))}
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
              이메일
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required autoComplete="email"
              style={{
                width: '100%', padding: '9px 12px', fontSize: 14,
                background: 'var(--bg-nav)', border: '1px solid var(--border-sub)', borderRadius: 6,
                color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.target.style.borderColor = 'var(--border-sub)')}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
              비밀번호 {tab === 'register' && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(6자 이상)</span>}
            </label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required minLength={tab === 'register' ? 6 : 1}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              style={{
                width: '100%', padding: '9px 12px', fontSize: 14,
                background: 'var(--bg-nav)', border: '1px solid var(--border-sub)', borderRadius: 6,
                color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.target.style.borderColor = 'var(--border-sub)')}
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
              background: loading ? 'var(--border-sub)' : 'var(--accent)', color: '#fff',
              marginTop: 4, transition: 'background 0.15s',
            }}>
            {loading ? '처리 중...' : tab === 'login' ? '로그인' : '회원가입'}
          </button>
        </form>

        {/* 하단 링크 */}
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <button onClick={() => navigate('/')}
            style={{ fontSize: 12, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
            ← 스크리너로 돌아가기
          </button>
        </div>
      </div>
    </div>
  )
}
