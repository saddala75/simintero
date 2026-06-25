import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from '@tanstack/react-query';
async function fetchDlqMessages(topic) {
    const url = topic ? `/api/dlq?topic=${encodeURIComponent(topic)}` : '/api/dlq';
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`DLQ fetch error ${res.status}`);
    return res.json();
}
export function DlqInspector({ topic }) {
    const { data, isLoading, error } = useQuery({
        queryKey: ['dlq', topic],
        queryFn: () => fetchDlqMessages(topic),
        refetchInterval: 30_000,
    });
    if (isLoading)
        return _jsx("p", { children: "Loading DLQ messages\u2026" });
    if (error)
        return _jsxs("p", { role: "alert", children: ["Error loading DLQ: ", error.message] });
    if (!data?.length)
        return _jsxs("p", { children: ["No messages in DLQ", topic ? ` for topic ${topic}` : '', "."] });
    return (_jsxs("div", { className: "dlq-inspector", children: [_jsxs("h3", { children: ["DLQ Messages (", data.length, ")"] }), _jsxs("table", { className: "dlq-inspector__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Correlation ID" }), _jsx("th", { children: "Topic" }), _jsx("th", { children: "Error" }), _jsx("th", { children: "Failed At" })] }) }), _jsx("tbody", { children: data.map(msg => (_jsxs("tr", { children: [_jsx("td", { children: msg.correlation_id }), _jsx("td", { children: msg.topic }), _jsx("td", { children: msg.error }), _jsx("td", { children: new Date(msg.failed_at).toLocaleString() })] }, msg.message_id))) })] })] }));
}
