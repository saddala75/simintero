import { Routes, Route } from 'react-router-dom'
import { AiWorkbenchPage } from './pages/AiWorkbenchPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AiWorkbenchPage />} />
      <Route path="/ai-workbench" element={<AiWorkbenchPage />} />
      <Route path="/ai-workbench/:caseId" element={<AiWorkbenchPage />} />
    </Routes>
  )
}
