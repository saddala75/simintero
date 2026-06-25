import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import MeasureDashboard from './pages/MeasureDashboard';
import GapList from './pages/GapList';
export default function App() {
    return (_jsxs(BrowserRouter, { children: [_jsxs("nav", { children: [_jsx(Link, { to: "/", children: "Measure Dashboard" }), ' | ', _jsx(Link, { to: "/gaps", children: "Gap List" })] }), _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(MeasureDashboard, {}) }), _jsx(Route, { path: "/gaps", element: _jsx(GapList, {}) })] })] }));
}
