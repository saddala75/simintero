import { Routes, Route } from 'react-router-dom'
import { RequireAuth } from './auth/AuthContext'
import { CaseSelectorPage } from './pages/CaseSelectorPage'
import { AiWorkbenchPage } from './pages/AiWorkbenchPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RequireAuth><CaseSelectorPage /></RequireAuth>} />
      <Route path="/ai-workbench" element={<RequireAuth><AiWorkbenchPage /></RequireAuth>} />
      <Route path="/ai-workbench/:caseId" element={<RequireAuth><AiWorkbenchPage /></RequireAuth>} />
    </Routes>
  )
}
