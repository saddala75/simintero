import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import MeasureDashboard from './pages/MeasureDashboard';
import GapList from './pages/GapList';

export default function App() {
  return (
    <BrowserRouter>
      <nav>
        <Link to="/">Measure Dashboard</Link>
        {' | '}
        <Link to="/gaps">Gap List</Link>
      </nav>
      <Routes>
        <Route path="/" element={<MeasureDashboard />} />
        <Route path="/gaps" element={<GapList />} />
      </Routes>
    </BrowserRouter>
  );
}
