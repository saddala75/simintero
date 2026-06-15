import { Routes, Route } from 'react-router-dom'
import { LandingPage } from './pages/LandingPage'
import { WorklistPage } from './pages/WorklistPage'
import { CasePage } from './pages/CasePage'
import { EhrOrderSimPage } from './pages/EhrOrderSimPage'
import { DtrFormPage } from './pages/DtrFormPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/queues/:queueId/worklist" element={<WorklistPage />} />
      <Route path="/cases/:caseId" element={<CasePage />} />
      <Route path="/ehr-sim" element={<EhrOrderSimPage />} />
      <Route path="/dtr" element={<DtrFormPage />} />
    </Routes>
  )
}
