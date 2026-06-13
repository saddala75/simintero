import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReplayConsole } from './pages/ReplayConsole.js';
import { SLADashboard } from './pages/SLADashboard.js';
import { SearchPanel } from './components/SearchPanel.js';

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <nav className="ops-nav">
          <span className="ops-nav__brand">AI Ops Console</span>
          <NavLink to="/" end>Replay Console</NavLink>
          <NavLink to="/sla">SLA Dashboard</NavLink>
          <NavLink to="/search">Search</NavLink>
        </nav>
        <main className="ops-main">
          <Routes>
            <Route path="/" element={<ReplayConsole />} />
            <Route path="/sla" element={<SLADashboard />} />
            <Route path="/search" element={<SearchPanel />} />
          </Routes>
        </main>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
