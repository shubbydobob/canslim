import { Routes, Route, Navigate } from 'react-router-dom'
import ScreenerPage from './pages/ScreenerPage'
import TradingCalcPage from './pages/TradingCalcPage'
import AuthPage from './pages/AuthPage'
import PremiumPage from './pages/PremiumPage'
import AdminPage from './pages/AdminPage'
import { isLoggedIn } from './api/auth'

function RequireAuth({ children }: { children: React.ReactNode }) {
  return isLoggedIn() ? <>{children}</> : <Navigate to="/auth" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ScreenerPage />} />
      <Route path="/stock/:securityId" element={<Navigate to="/" replace />} />
      <Route path="/calc" element={<TradingCalcPage />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/premium" element={<PremiumPage />} />
      <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
    </Routes>
  )
}
