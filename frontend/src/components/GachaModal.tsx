import { useState, useEffect, useRef } from 'react'
import type { ScreenerItem } from '../types'

interface Props {
  items: ScreenerItem[]
  onSelect: (id: number) => void
  onClose: () => void
}

type Phase = 'idle' | 'rolling' | 'reveal'

const RARITY = (score: number) => {
  if (score >= 85) return { label: 'SSR', color: '#fabd44', glow: '#fabd4488', bg: 'linear-gradient(135deg, #1a1500, #2d2200)', border: '#fabd44' }
  if (score >= 75) return { label: 'SR', color: '#c084fc', glow: '#c084fc66', bg: 'linear-gradient(135deg, #1a0030, #2d0050)', border: '#c084fc' }
  if (score >= 65) return { label: 'R', color: '#58a6ff', glow: '#58a6ff55', bg: 'linear-gradient(135deg, #001a33, #002d55)', border: '#58a6ff' }
  return { label: 'N', color: '#4ade80', glow: '#4ade8044', bg: 'linear-gradient(135deg, #001a0d, #002d15)', border: '#4ade80' }
}

const scoreColor = (v: number) => v >= 85 ? '#4ade80' : v >= 70 ? '#9ae6b4' : v >= 55 ? '#f6ad55' : '#fc8181'

export default function GachaModal({ items, onSelect, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [picked, setPicked] = useState<ScreenerItem | null>(null)
  const [rollingName, setRollingName] = useState('')
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; dx: number; dy: number; color: string }[]>([])
  const intervalRef = useRef<number>(0)

  const pool = items.filter(i => i.compositeScore >= 60)
  const pickRandom = () => pool[Math.floor(Math.random() * pool.length)] ?? items[0]

  const startRoll = () => {
    setPhase('rolling')
    setPicked(null)
    setParticles([])

    const target = pickRandom()
    let count = 0
    const maxCount = 25

    intervalRef.current = window.setInterval(() => {
      count++
      const fake = pool[Math.floor(Math.random() * pool.length)]
      if (fake) setRollingName(fake.name)

      if (count >= maxCount) {
        clearInterval(intervalRef.current)
        setPicked(target)
        setPhase('reveal')

        // spawn particles
        const rarity = RARITY(target.compositeScore)
        const newParticles = Array.from({ length: 30 }, (_, i) => ({
          id: i,
          x: 50 + (Math.random() - 0.5) * 10,
          y: 50 + (Math.random() - 0.5) * 10,
          dx: (Math.random() - 0.5) * 200,
          dy: (Math.random() - 0.5) * 200 - 50,
          color: [rarity.color, '#fff', rarity.glow][i % 3],
        }))
        setParticles(newParticles)
      }
    }, 60)
  }

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  const rarity = picked ? RARITY(picked.compositeScore) : null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={phase === 'idle' || phase === 'reveal' ? onClose : undefined}>
      <div style={{
        width: 380, minHeight: 460, position: 'relative',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 20,
      }} onClick={e => e.stopPropagation()}>

        {/* Particles */}
        {phase === 'reveal' && particles.map(p => (
          <div key={p.id} style={{
            position: 'absolute',
            left: `${p.x}%`, top: `${p.y}%`,
            width: 6, height: 6, borderRadius: '50%',
            background: p.color,
            animation: `gacha-particle 1s ease-out forwards`,
            animationDelay: `${Math.random() * 0.2}s`,
            ['--dx' as string]: `${p.dx}px`,
            ['--dy' as string]: `${p.dy}px`,
          }} />
        ))}

        {/* Idle state */}
        {phase === 'idle' && (
          <>
            <div style={{ fontSize: 14, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.6 }}>
              성장주 스크리너 AI가<br />오늘의 추천 종목을 선별합니다
            </div>
            <button onClick={startRoll} style={{
              width: 200, height: 200, borderRadius: '50%',
              background: 'radial-gradient(circle, #1f6feb 0%, #0d1117 70%)',
              border: '3px solid #58a6ff',
              color: '#fff', fontSize: 18, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 0 40px rgba(31,111,235,0.4), inset 0 0 30px rgba(31,111,235,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 8,
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'scale(1.05)'
              e.currentTarget.style.boxShadow = '0 0 60px rgba(31,111,235,0.6), inset 0 0 40px rgba(31,111,235,0.3)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'scale(1)'
              e.currentTarget.style.boxShadow = '0 0 40px rgba(31,111,235,0.4), inset 0 0 30px rgba(31,111,235,0.2)'
            }}>
              <span style={{ fontSize: 32 }}>PICK</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: '#93c5fd' }}>클릭하여 뽑기</span>
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
              SCORE 60점 이상 {pool.length}개 종목 중 추천
            </div>
          </>
        )}

        {/* Rolling state */}
        {phase === 'rolling' && (
          <div style={{
            width: 300, height: 320, borderRadius: 16,
            background: 'var(--bg-nav)', border: '2px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 12,
            animation: 'gacha-shake 0.1s infinite',
          }}>
            <div style={{ fontSize: 14, color: 'var(--text-3)', fontWeight: 600 }}>선별 중...</div>
            <div style={{
              fontSize: 24, fontWeight: 800, color: '#58a6ff',
              animation: 'gacha-text-flash 0.15s infinite',
            }}>{rollingName}</div>
            <div style={{ width: 60, height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ width: '100%', height: '100%', background: '#58a6ff', animation: 'gacha-progress 2s linear' }} />
            </div>
          </div>
        )}

        {/* Reveal state */}
        {phase === 'reveal' && picked && rarity && (
          <>
            <div style={{
              width: 300, borderRadius: 16,
              background: rarity.bg, border: `2px solid ${rarity.border}`,
              padding: '28px 24px',
              boxShadow: `0 0 60px ${rarity.glow}`,
              animation: 'gacha-reveal 0.5s ease-out',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            }}>
              {/* Rarity badge */}
              <div style={{
                fontSize: 28, fontWeight: 900, color: rarity.color,
                textShadow: `0 0 20px ${rarity.glow}`,
                letterSpacing: 4,
              }}>{rarity.label}</div>

              {/* Stock info */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{picked.sector ?? ''}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-1)' }}>{picked.name}</div>
                <div style={{ fontSize: 13, fontFamily: 'monospace', color: '#58a6ff', marginTop: 4 }}>{picked.ticker}</div>
              </div>

              {/* Score */}
              <div style={{
                fontSize: 48, fontWeight: 900, color: scoreColor(picked.compositeScore),
                lineHeight: 1, marginTop: 4,
                textShadow: `0 0 20px ${scoreColor(picked.compositeScore)}44`,
              }}>{picked.compositeScore.toFixed(1)}</div>

              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                Rank {picked.marketRank} · Top {(100 - picked.marketPercentile * 100).toFixed(1)}%
              </div>

              {/* Factor mini bars */}
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {[
                  { label: 'C', value: picked.cScore, color: '#f6ad55' },
                  { label: 'A', value: picked.aScore, color: '#68d391' },
                  { label: 'N', value: picked.nScore, color: '#76e4f7' },
                  { label: 'S', value: picked.sScore, color: '#b794f4' },
                  { label: 'L', value: picked.lScore, color: '#fc8181' },
                  { label: 'I', value: picked.iScore, color: '#63b3ed' },
                  { label: 'M', value: picked.mScore, color: '#d6bcfa' },
                ].map(f => (
                  <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, fontSize: 9, fontWeight: 700, color: f.color }}>{f.label}</span>
                    <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2 }}>
                      <div style={{ height: 4, borderRadius: 2, width: `${f.value ?? 0}%`, background: f.color, transition: 'width 0.8s ease-out' }} />
                    </div>
                    <span style={{ width: 28, fontSize: 9, color: 'var(--text-3)', textAlign: 'right' }}>
                      {f.value != null ? f.value.toFixed(0) : '-'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button onClick={() => onSelect(picked.securityId)} style={{
                padding: '10px 28px', fontSize: 13, fontWeight: 700,
                background: '#1f6feb', border: 'none', borderRadius: 8,
                color: '#fff', cursor: 'pointer',
              }}>상세 보기</button>
              <button onClick={() => { setPhase('idle'); setPicked(null); setParticles([]) }} style={{
                padding: '10px 28px', fontSize: 13, fontWeight: 600,
                background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                color: 'var(--text-3)', cursor: 'pointer',
              }}>다시 뽑기</button>
            </div>
          </>
        )}
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes gacha-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-3px) rotate(-0.5deg); }
          75% { transform: translateX(3px) rotate(0.5deg); }
        }
        @keyframes gacha-text-flash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes gacha-progress {
          from { width: 0%; }
          to { width: 100%; }
        }
        @keyframes gacha-reveal {
          0% { transform: scale(0.3) rotateY(180deg); opacity: 0; }
          50% { transform: scale(1.1) rotateY(0deg); opacity: 1; }
          100% { transform: scale(1) rotateY(0deg); }
        }
        @keyframes gacha-particle {
          0% { transform: translate(0, 0) scale(1); opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
