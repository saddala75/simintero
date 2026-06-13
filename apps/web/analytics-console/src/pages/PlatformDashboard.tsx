import { useQuery } from '@tanstack/react-query';
import PlatformSummaryCard from '../components/PlatformSummaryCard.js';

interface PlatformAggregate {
  aggregate_id: string;
  period_start: string;
  period_end: string;
  tenant_count: number;
  case_count: number;
  gap_count: number;
  total_cost_usd: number;
}

export default function PlatformDashboard() {
  const { data, isError } = useQuery<{ summary: PlatformAggregate | null }>({
    queryKey: ['analytics', 'platform-summary'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/platform-summary');
      if (!res.ok) throw new Error('Failed to load platform summary');
      return res.json();
    },
  });

  return (
    <div>
      <h1>Platform Summary</h1>
      {isError && <p role="alert">Failed to load platform summary</p>}
      {data?.summary ? (
        <PlatformSummaryCard summary={data.summary} />
      ) : (
        !isError && <p>No platform aggregate data available yet.</p>
      )}
    </div>
  );
}
