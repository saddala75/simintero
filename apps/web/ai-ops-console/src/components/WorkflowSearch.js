import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
export function WorkflowSearch({ onResult }) {
    const [query, setQuery] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    async function handleSearch() {
        if (!query.trim())
            return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/workflows/${encodeURIComponent(query.trim())}`);
            if (!res.ok) {
                setError(res.status === 404 ? 'Workflow not found' : `Error ${res.status}`);
                return;
            }
            const data = (await res.json());
            onResult(data);
        }
        catch {
            setError('Network error — check that the Temporal proxy is running');
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { className: "workflow-search", children: [_jsx("label", { htmlFor: "workflow-search-input", className: "sr-only", children: "Search by correlation ID" }), _jsx("input", { id: "workflow-search-input", role: "searchbox", type: "search", value: query, onChange: e => setQuery(e.target.value), onKeyDown: e => e.key === 'Enter' && void handleSearch(), placeholder: "Enter case ID or correlation ID\u2026", className: "workflow-search__input" }), _jsx("button", { onClick: () => void handleSearch(), disabled: loading, "aria-label": "Search", className: "workflow-search__button", children: loading ? 'Searching…' : 'Search' }), error && (_jsx("div", { role: "alert", className: "workflow-search__error", children: error }))] }));
}
