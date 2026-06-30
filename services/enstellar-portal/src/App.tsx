import { type ReactNode } from 'react'
import { Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from './auth/AuthContext'
import { AppShell } from './components/AppShell'
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
import { DashboardPage } from './pages/DashboardPage'
import { RevitalPage } from './pages/RevitalPage'

// Real Console Apps & Pages
import { AiWorkbenchPage } from '@sim/reviewer-workspace/pages/AiWorkbenchPage'
import { CaseSelectorPage } from '@sim/reviewer-workspace/pages/CaseSelectorPage'
import { PolicyListPage } from '@sim/digicore-console/pages/PolicyListPage'
import { PolicyDetailPage } from '@sim/digicore-console/pages/PolicyDetailPage'
import { NewPolicyPage } from '@sim/digicore-console/pages/NewPolicyPage'
import { GovernanceReportsPage } from '@sim/digicore-console/pages/GovernanceReportsPage'
import { GapAnalysisPage } from '@sim/quality-console/pages/GapAnalysisPage'
import { MeasurePerformancePage } from '@sim/quality-console/pages/MeasurePerformancePage'
import { GapDetailPage } from '@sim/quality-console/pages/GapDetailPage'
import { MeasureLibraryPage } from '@sim/quality-console/pages/MeasureLibraryPage'
import AnalyticsApp from '@sim/analytics-console/App'
import AiOpsApp from '@sim/ai-ops-console/App'
import SaasAdminApp from '@sim/saas-admin/App'
import SupportConsoleApp from '@sim/support-console/App'

function Nav({ children, noScroll }: { children: ReactNode; noScroll?: boolean }) {
  return <AppShell noScroll={noScroll}>{children}</AppShell>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/dashboard" element={<ProtectedRoute><Nav><DashboardPage /></Nav></ProtectedRoute>} />
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

      {/* Unified Platform Intelligence & Governance Routes */}
      <Route path="/revital" element={<ProtectedRoute><Nav><RevitalPage /></Nav></ProtectedRoute>} />
      <Route path="/revital/:caseId" element={<ProtectedRoute><Nav noScroll><AiWorkbenchPage /></Nav></ProtectedRoute>} />
      <Route path="/ai-workbench/:caseId" element={<ProtectedRoute><Nav noScroll><AiWorkbenchPage /></Nav></ProtectedRoute>} />
      <Route path="/digicore" element={<ProtectedRoute><Nav><PolicyListPage /></Nav></ProtectedRoute>} />
      <Route path="/digicore/new" element={<ProtectedRoute><Nav><NewPolicyPage /></Nav></ProtectedRoute>} />
      <Route path="/digicore/policies/:id" element={<ProtectedRoute><Nav><PolicyDetailPage /></Nav></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><Nav><GovernanceReportsPage /></Nav></ProtectedRoute>} />
      <Route path="/qualitron" element={<ProtectedRoute><Nav><MeasurePerformancePage /></Nav></ProtectedRoute>} />
      <Route path="/qualitron/measures" element={<ProtectedRoute><Nav><MeasurePerformancePage /></Nav></ProtectedRoute>} />
      <Route path="/qualitron/gaps" element={<ProtectedRoute><Nav><GapAnalysisPage /></Nav></ProtectedRoute>} />
      <Route path="/qualitron/gaps/:id" element={<ProtectedRoute><Nav><GapDetailPage /></Nav></ProtectedRoute>} />
      <Route path="/qualitron/library" element={<ProtectedRoute><Nav><MeasureLibraryPage /></Nav></ProtectedRoute>} />
      <Route path="/analytics" element={<ProtectedRoute><Nav><AnalyticsApp /></Nav></ProtectedRoute>} />
      <Route path="/ai-ops" element={<ProtectedRoute><Nav><AiOpsApp /></Nav></ProtectedRoute>} />
      <Route path="/saas-admin" element={<ProtectedRoute><Nav><SaasAdminApp /></Nav></ProtectedRoute>} />
      <Route path="/support" element={<ProtectedRoute><Nav><SupportConsoleApp /></Nav></ProtectedRoute>} />
    </Routes>
  )
}
