import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useQuery } from '@tanstack/react-query';
async function fetchMetric(endpoint) {
    const res = await fetch(endpoint);
    if (!res.ok)
        throw new Error(`Metric fetch error ${res.status}`);
    return res.json();
}
export function SLAMetricsPanel({ metricKey, label, endpoint }) {
    const { data, isLoading, error } = useQuery({
        queryKey: ['metric', metricKey],
        queryFn: () => fetchMetric(endpoint),
        refetchInterval: 60_000,
        staleTime: 60_000,
    });
    if (isLoading)
        return _jsxs("div", { className: "metric-panel metric-panel--loading", children: [label, ": loading\u2026"] });
    if (error) {
        return (_jsxs("div", { className: "metric-panel metric-panel--error", role: "alert", children: [label, ": error loading metric"] }));
    }
    return (_jsxs("div", { className: "metric-panel", children: [_jsx("h4", { className: "metric-panel__label", children: label }), _jsxs("div", { className: "metric-panel__value", children: [_jsx("span", { className: "metric-panel__number", children: data?.value ?? '—' }), data?.unit && _jsx("span", { className: "metric-panel__unit", children: data.unit })] }), data?.label && _jsx("p", { className: "metric-panel__sublabel", children: data.label })] }));
}
