import { Routes, Route } from 'react-router-dom'
import ScreenerPage from './pages/ScreenerPage'
import StockDetailPage from './pages/StockDetailPage'
import TradingCalcPage from './pages/TradingCalcPage'
import AuthPage from './pages/AuthPage'
import PremiumPage from './pages/PremiumPage'
import AdminPage from './pages/AdminPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ScreenerPage />} />
      <Route path="/stock/:securityId" element={<StockDetailPage />} />
      <Route path="/calc" element={<TradingCalcPage />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/premium" element={<PremiumPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  )
}
