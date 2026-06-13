import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MarginDashboard from './pages/MarginDashboard.js';
import PlatformDashboard from './pages/PlatformDashboard.js';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <nav>
          <Link to="/">Margin Dashboard</Link>{' | '}
          <Link to="/platform">Platform Summary</Link>
        </nav>
        <Routes>
          <Route path="/" element={<MarginDashboard />} />
          <Route path="/platform" element={<PlatformDashboard />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
