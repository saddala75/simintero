interface PlatformAggregate {
  aggregate_id: string;
  period_start: string;
  period_end: string;
  tenant_count: number;
  case_count: number;
  gap_count: number;
  total_cost_usd: number;
}

interface PlatformSummaryCardProps {
  summary: PlatformAggregate;
}

export default function PlatformSummaryCard({ summary }: PlatformSummaryCardProps) {
  return (
    <div data-testid="platform-summary-card">
      <p>Tenants: {summary.tenant_count}</p>
      <p>Cases: {summary.case_count}</p>
      <p>Gaps: {summary.gap_count}</p>
      <p>Total Cost: ${summary.total_cost_usd.toFixed(2)}</p>
      <small>De-identified aggregate — no tenant data shown</small>
    </div>
  );
}
