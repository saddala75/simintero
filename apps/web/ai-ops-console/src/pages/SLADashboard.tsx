import { SLAMetricsPanel } from '../components/SLAMetricsPanel.js';

const METRICS = [
  {
    key: 'worklist_age',
    label: 'Worklist Age',
    endpoint: '/api/metrics/worklist-age',
    description: 'Cases in Clinical Review (hours since last state change)',
  },
  {
    key: 'clock_breaches',
    label: 'Clock Breach Count',
    endpoint: '/api/metrics/clock-breaches',
    description: 'Active cases with regulatory clock breach or breach warning',
  },
  {
    key: 'ai_override_rate',
    label: 'AI Override Rate',
    endpoint: '/api/metrics/ai-override-rate',
    description: 'Fraction of advisory triage suggestions overridden by reviewers (trailing 7 days)',
  },
  {
    key: 'throughput',
    label: 'Daily Throughput',
    endpoint: '/api/metrics/throughput',
    description: 'Cases reaching DETERMINED state per day (trailing 7-day average)',
  },
];

export function SLADashboard() {
  return (
    <div className="sla-dashboard">
      <h2>SLA Dashboard</h2>
      <p className="sla-dashboard__note">
        Metrics refresh every 60 seconds. All times are in the tenant's configured timezone.
      </p>
      <div className="sla-dashboard__grid">
        {METRICS.map(m => (
          <div key={m.key} className="sla-dashboard__card">
            <SLAMetricsPanel metricKey={m.key} label={m.label} endpoint={m.endpoint} />
            <p className="sla-dashboard__description">{m.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
