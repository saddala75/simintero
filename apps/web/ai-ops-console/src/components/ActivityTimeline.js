import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const STATUS_CLASS = {
    COMPLETED: 'activity--completed',
    FAILED: 'activity--failed',
    RUNNING: 'activity--running',
    SCHEDULED: 'activity--scheduled',
};
export function ActivityTimeline({ activities }) {
    return (_jsx("ol", { className: "activity-timeline", "aria-label": "Workflow activity timeline", children: activities.map((activity) => (_jsxs("li", { className: `activity ${STATUS_CLASS[activity.status] ?? 'activity--unknown'}`, "data-status": activity.status, children: [_jsx("span", { className: "activity__name", children: activity.name }), _jsx("span", { className: "activity__status", children: activity.status }), _jsx("time", { className: "activity__time", dateTime: activity.startedAt, children: new Date(activity.startedAt).toLocaleTimeString() })] }, activity.name))) }));
}
