import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import ManifestsPage from './pages/ManifestsPage'
import RunsPage from './pages/RunsPage'
import DashboardPage from './pages/DashboardPage'
import PredictionsPage from './pages/PredictionsPage'

export default function App() {
  return (
    <div className="layout">
      <nav className="sidebar">
        <h1>🍚 K-Food Profiler</h1>
        <NavLink to="/manifests">1. 샘플셋 (Manifest)</NavLink>
        <NavLink to="/runs">2. 테스트 실행</NavLink>
        <NavLink to="/dashboard">3. 프로파일링 대시보드</NavLink>
        <NavLink to="/predictions">4. 예측 드릴다운</NavLink>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/manifests" replace />} />
          <Route path="/manifests" element={<ManifestsPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/predictions" element={<PredictionsPage />} />
        </Routes>
      </main>
    </div>
  )
}
