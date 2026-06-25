import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReplayConsole } from './pages/ReplayConsole.js';
import { SLADashboard } from './pages/SLADashboard.js';
import { SearchPanel } from './components/SearchPanel.js';
const queryClient = new QueryClient();
export function App() {
    return (_jsx(QueryClientProvider, { client: queryClient, children: _jsxs(BrowserRouter, { children: [_jsxs("nav", { className: "ops-nav", children: [_jsx("span", { className: "ops-nav__brand", children: "AI Ops Console" }), _jsx(NavLink, { to: "/", end: true, children: "Replay Console" }), _jsx(NavLink, { to: "/sla", children: "SLA Dashboard" }), _jsx(NavLink, { to: "/search", children: "Search" })] }), _jsx("main", { className: "ops-main", children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(ReplayConsole, {}) }), _jsx(Route, { path: "/sla", element: _jsx(SLADashboard, {}) }), _jsx(Route, { path: "/search", element: _jsx(SearchPanel, {}) })] }) })] }) }));
}
