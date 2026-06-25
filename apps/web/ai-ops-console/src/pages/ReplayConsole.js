import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { WorkflowSearch } from '../components/WorkflowSearch.js';
import { ActivityTimeline } from '../components/ActivityTimeline.js';
import { DlqInspector } from '../components/DlqInspector.js';
export function ReplayConsole() {
    const [workflow, setWorkflow] = useState(null);
    return (_jsxs("div", { className: "replay-console", children: [_jsx("h2", { children: "Workflow Replay Console" }), _jsx("p", { className: "replay-console__note", children: "Read-only view. Search by case ID or correlation ID to inspect workflow history and activity status." }), _jsx(WorkflowSearch, { onResult: setWorkflow }), workflow && (_jsxs("div", { className: "replay-console__result", children: [_jsxs("h3", { children: [workflow.workflowId, _jsx("span", { className: `badge badge--${workflow.status.toLowerCase()}`, children: workflow.status })] }), _jsx(ActivityTimeline, { activities: workflow.activities })] })), _jsx("hr", {}), _jsx("h3", { children: "Dead Letter Queue" }), _jsx(DlqInspector, {})] }));
}
