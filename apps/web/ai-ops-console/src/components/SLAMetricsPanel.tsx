import { useQuery } from '@tanstack/react-query';

interface MetricValue {
  value: number;
  label: string;
  unit: string;
  trend?: 'up' | 'down' | 'stable';
}

interface SLAMetricsPanelProps {
  metricKey: string;
  label: string;
  endpoint: string;
}

async function fetchMetric(endpoint: string): Promise<MetricValue> {
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`Metric fetch error ${res.status}`);
  return res.json() as Promise<MetricValue>;
}

export function SLAMetricsPanel({ metricKey, label, endpoint }: SLAMetricsPanelProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['metric', metricKey],
    queryFn: () => fetchMetric(endpoint),
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  if (isLoading) return <div className="metric-panel metric-panel--loading">{label}: loading…</div>;
  if (error) {
    return (
      <div className="metric-panel metric-panel--error" role="alert">
        {label}: error loading metric
      </div>
    );
  }

  return (
    <div className="metric-panel">
      <h4 className="metric-panel__label">{label}</h4>
      <div className="metric-panel__value">
        <span className="metric-panel__number">{data?.value ?? '—'}</span>
        {data?.unit && <span className="metric-panel__unit">{data.unit}</span>}
      </div>
      {data?.label && <p className="metric-panel__sublabel">{data.label}</p>}
    </div>
  );
}
