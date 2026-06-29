import { Routes, Route } from 'react-router-dom'
import { MeasurePerformancePage } from './pages/MeasurePerformancePage'
import { GapAnalysisPage } from './pages/GapAnalysisPage'
import { GapDetailPage } from './pages/GapDetailPage'
import { SubmissionReadinessPage } from './pages/SubmissionReadinessPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MeasurePerformancePage />} />
      <Route path="/gaps" element={<GapAnalysisPage />} />
      <Route path="/gaps/:id" element={<GapDetailPage />} />
      <Route path="/readiness" element={<SubmissionReadinessPage />} />
    </Routes>
  )
}
