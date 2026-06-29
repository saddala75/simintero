import { Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from './auth/AuthContext'
import { LandingPage } from './pages/LandingPage'
import { WorklistPage } from './pages/WorklistPage'
import { CasePage } from './pages/CasePage'
import { EhrOrderSimPage } from './pages/EhrOrderSimPage'
import { DtrFormPage } from './pages/DtrFormPage'
import { AppealsPage } from './pages/AppealsPage'
import { AppealDetailPage } from './pages/AppealDetailPage'
import { GrievancesPage } from './pages/GrievancesPage'
import { GrievanceDetailPage } from './pages/GrievanceDetailPage'
import { RegulatoryClocksPage } from './pages/RegulatoryClocksPage'
import { IntakeChannelsPage } from './pages/IntakeChannelsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/worklist" element={<ProtectedRoute><WorklistPage /></ProtectedRoute>} />
      <Route path="/queues/:queueId/worklist" element={<ProtectedRoute><WorklistPage /></ProtectedRoute>} />
      <Route path="/cases/:caseId" element={<ProtectedRoute><CasePage /></ProtectedRoute>} />
      <Route path="/regulatory-clocks" element={<ProtectedRoute><RegulatoryClocksPage /></ProtectedRoute>} />
      <Route path="/intake" element={<ProtectedRoute><IntakeChannelsPage /></ProtectedRoute>} />
      <Route path="/ehr-sim" element={<EhrOrderSimPage />} />
      <Route path="/dtr" element={<DtrFormPage />} />
      <Route path="/appeals" element={<ProtectedRoute><AppealsPage /></ProtectedRoute>} />
      <Route path="/cases/:caseId/appeals/:appealId" element={<ProtectedRoute><AppealDetailPage /></ProtectedRoute>} />
      <Route path="/grievances" element={<ProtectedRoute><GrievancesPage /></ProtectedRoute>} />
      <Route path="/grievances/:grievanceId" element={<ProtectedRoute><GrievanceDetailPage /></ProtectedRoute>} />
    </Routes>
  )
}
