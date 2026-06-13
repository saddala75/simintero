import { useQuery } from '@tanstack/react-query';
import MarginChart from '../components/MarginChart.js';

interface MarginSnapshot {
  snapshot_id: string;
  period_start: string;
  period_end: string;
  revenue_usd: number;
  cost_usd: number;
  margin_usd: number;
}

export default function MarginDashboard() {
  const { data, isError } = useQuery<{ snapshots: MarginSnapshot[] }>({
    queryKey: ['analytics', 'margin'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/margin');
      if (!res.ok) throw new Error('Failed to load margin data');
      return res.json();
    },
  });

  return (
    <div>
      <h1>FinOps Margin Dashboard</h1>
      {isError && <p role="alert">Failed to load margin data — check that the analytics service is running</p>}
      <MarginChart snapshots={data?.snapshots ?? []} />
    </div>
  );
}
