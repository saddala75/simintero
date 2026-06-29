import { Routes, Route } from 'react-router-dom'
import { PolicyListPage } from './pages/PolicyListPage'
import { PolicyDetailPage } from './pages/PolicyDetailPage'
import { GovernanceReportsPage } from './pages/GovernanceReportsPage'
import { NewPolicyPage } from './pages/NewPolicyPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PolicyListPage />} />
      <Route path="/policies/:id" element={<PolicyDetailPage />} />
      <Route path="/reports" element={<GovernanceReportsPage />} />
      <Route path="/new" element={<NewPolicyPage />} />
    </Routes>
  )
}
