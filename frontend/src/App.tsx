import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { IS_STATIC } from './api/client'
import ManifestsPage from './pages/ManifestsPage'
import RunsPage from './pages/RunsPage'
import DashboardPage from './pages/DashboardPage'
import PredictionsPage from './pages/PredictionsPage'

export default function App() {
  return (
    <div className="layout">
      <nav className="sidebar">
        <h1>🍚 K-Food Profiler{IS_STATIC && <span style={{ fontWeight: 400 }}> — 리포트</span>}</h1>
        {!IS_STATIC && <NavLink to="/manifests">1. 샘플셋 (Manifest)</NavLink>}
        {!IS_STATIC && <NavLink to="/runs">2. 테스트 실행</NavLink>}
        <NavLink to="/dashboard">{IS_STATIC ? '프로파일링 대시보드' : '3. 프로파일링 대시보드'}</NavLink>
        <NavLink to="/predictions">{IS_STATIC ? '예측 드릴다운' : '4. 예측 드릴다운'}</NavLink>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to={IS_STATIC ? '/dashboard' : '/manifests'} replace />} />
          {!IS_STATIC && <Route path="/manifests" element={<ManifestsPage />} />}
          {!IS_STATIC && <Route path="/runs" element={<RunsPage />} />}
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/predictions" element={<PredictionsPage />} />
        </Routes>
      </main>
    </div>
  )
}
