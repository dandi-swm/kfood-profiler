import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { IS_STATIC } from './api/client'
import ManifestsPage from './pages/ManifestsPage'
import RunsPage from './pages/RunsPage'
import DashboardPage from './pages/DashboardPage'
import PredictionsPage from './pages/PredictionsPage'

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◆
          </span>
          K-Food AI Profiler
        </div>
        <span className="crumb-sep" aria-hidden="true">
          /
        </span>
        <span className="crumb">kfood · 143 classes</span>
        <div className="spacer" />
        <span className="mode-chip">{IS_STATIC ? '정적 리포트' : '로컬'}</span>
      </header>

      <div className="app-body">
        <nav className="sidebar">
          {!IS_STATIC && <div className="nav-group">준비</div>}
          {!IS_STATIC && (
            <NavLink to="/manifests">
              <span className="step">1</span> 샘플셋
            </NavLink>
          )}
          {!IS_STATIC && (
            <NavLink to="/runs">
              <span className="step">2</span> 테스트 실행
            </NavLink>
          )}
          <div className="nav-group">분석</div>
          <NavLink to="/dashboard">
            <span className="step">{IS_STATIC ? '◱' : '3'}</span> 대시보드
          </NavLink>
          <NavLink to="/predictions">
            <span className="step">{IS_STATIC ? '◰' : '4'}</span> 예측 드릴다운
          </NavLink>
        </nav>

        <main className="content">
          <div className="page">
            <Routes>
              <Route
                path="/"
                element={<Navigate to={IS_STATIC ? '/dashboard' : '/manifests'} replace />}
              />
              {!IS_STATIC && <Route path="/manifests" element={<ManifestsPage />} />}
              {!IS_STATIC && <Route path="/runs" element={<RunsPage />} />}
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/predictions" element={<PredictionsPage />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  )
}
