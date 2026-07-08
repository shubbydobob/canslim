import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { isLoggedIn } from './api/auth'

// 라우트 코드 스플릿 — 초기 진입(스크리너)에 계산기·관리자·프리미엄·차트 번들을 안 받도록.
const ScreenerPage = lazy(() => import('./pages/ScreenerPage'))
const TradingCalcPage = lazy(() => import('./pages/TradingCalcPage'))
const AuthPage = lazy(() => import('./pages/AuthPage'))
const PremiumPage = lazy(() => import('./pages/PremiumPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))

function RequireAuth({ children }: { children: React.ReactNode }) {
  return isLoggedIn() ? <>{children}</> : <Navigate to="/auth" replace />
}

function RouteFallback() {
  return (
    <div className="route-fallback">
      <span className="spinner" /> 로딩 중...
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<ScreenerPage />} />
        <Route path="/stock/:securityId" element={<Navigate to="/" replace />} />
        <Route path="/calc" element={<TradingCalcPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/premium" element={<PremiumPage />} />
        <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
      </Routes>
    </Suspense>
  )
}
