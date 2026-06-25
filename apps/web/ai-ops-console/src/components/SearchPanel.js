import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
export function SearchPanel() {
    const [query, setQuery] = useState('');
    const [submittedQuery, setSubmittedQuery] = useState('');
    const { data, isLoading, isError } = useQuery({
        queryKey: ['search', submittedQuery],
        queryFn: async () => {
            const res = await fetch(`/api/search?q=${encodeURIComponent(submittedQuery)}`);
            if (!res.ok)
                throw new Error(`Search failed: ${res.status}`);
            return res.json();
        },
        enabled: submittedQuery.length > 0,
    });
    function handleSubmit() {
        if (query.trim())
            setSubmittedQuery(query.trim());
    }
    // Group results by entity_type
    const byType = (data?.results ?? []).reduce((acc, r) => {
        acc[r.entity_type] = [...(acc[r.entity_type] ?? []), r];
        return acc;
    }, {});
    return (_jsxs("div", { className: "search-panel", children: [_jsxs("div", { className: "search-panel__input-row", children: [_jsx("input", { "data-testid": "search-input", type: "text", value: query, onChange: (e) => setQuery(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                            handleSubmit(); }, placeholder: "Search cases, documents, gaps\u2026", "aria-label": "Search" }), _jsx("button", { onClick: handleSubmit, disabled: isLoading, children: isLoading ? 'Searching…' : 'Search' })] }), isError && (_jsx("p", { role: "alert", className: "search-panel__error", children: "Search failed \u2014 check that the search service is running" })), submittedQuery.length === 0 && (_jsx("p", { "data-testid": "search-empty-state", className: "search-panel__empty", children: "Enter a query to search across cases, documents, and gaps." })), data && data.results.length === 0 && (_jsxs("p", { className: "search-panel__no-results", children: ["No results for \"", submittedQuery, "\""] })), Object.entries(byType).map(([entityType, results]) => (_jsxs("section", { className: "search-panel__group", children: [_jsx("h3", { className: "search-panel__group-title", children: entityType }), results.map((r) => (_jsxs("div", { "data-testid": `search-result-${r.entity_id}`, className: "search-panel__result", children: [_jsx("span", { className: "search-panel__entity-id", children: r.entity_id }), Object.entries(r.metadata).map(([k, v]) => (_jsxs("span", { className: "search-panel__meta", children: [k, ": ", v] }, k)))] }, r.entity_id)))] }, entityType)))] }));
}
