interface MarginSnapshot {
  snapshot_id: string;
  period_start: string;
  period_end: string;
  revenue_usd: number;
  cost_usd: number;
  margin_usd: number;
}

interface MarginChartProps {
  snapshots: MarginSnapshot[];
}

export default function MarginChart({ snapshots }: MarginChartProps) {
  if (snapshots.length === 0) {
    return <p data-testid="empty-state">No margin data available.</p>;
  }
  return (
    <ul>
      {snapshots.map((s) => (
        <li key={s.snapshot_id} data-testid={`margin-row-${s.snapshot_id}`}>
          <strong>{s.period_start} — {s.period_end}</strong>
          {' '}
          Margin: ${s.margin_usd.toFixed(2)} (Revenue: ${s.revenue_usd.toFixed(2)}, Cost: ${s.cost_usd.toFixed(2)})
        </li>
      ))}
    </ul>
  );
}
