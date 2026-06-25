import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from '@tanstack/react-query';
import MeasureRateCard from '../components/MeasureRateCard';
async function fetchRuns() {
    const res = await fetch('/api/quality/measures');
    if (!res.ok)
        throw new Error('Failed to fetch measure runs');
    const data = await res.json();
    return data.runs;
}
export default function MeasureDashboard() {
    const { data: runs, isLoading, isError } = useQuery({ queryKey: ['measures'], queryFn: fetchRuns });
    if (isLoading)
        return _jsx("p", { children: "Loading..." });
    if (isError)
        return _jsx("p", { role: "alert", children: "Failed to load measure runs." });
    return (_jsxs("div", { children: [_jsx("h1", { children: "Measure Dashboard" }), runs?.map((run) => (_jsx(MeasureRateCard, { run: run }, run.run_id)))] }));
}
