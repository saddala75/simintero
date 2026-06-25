import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import GapTable from '../components/GapTable';
async function fetchGaps(status) {
    const params = new URLSearchParams();
    if (status)
        params.set('status', status);
    const res = await fetch(`/api/quality/gaps?${params.toString()}`);
    if (!res.ok)
        throw new Error('Failed to fetch gaps');
    const data = await res.json();
    return data.gaps;
}
export default function GapList() {
    const [statusFilter, setStatusFilter] = useState('open');
    const { data: gaps = [], isError } = useQuery({
        queryKey: ['gaps', statusFilter],
        queryFn: () => fetchGaps(statusFilter),
    });
    if (isError)
        return _jsx("p", { role: "alert", children: "Failed to load gaps." });
    return (_jsxs("div", { children: [_jsx("h1", { children: "Quality Gaps" }), _jsx(GapTable, { gaps: gaps, statusFilter: statusFilter, onStatusFilterChange: setStatusFilter })] }));
}
