interface Gap {
  gap_id: string;
  member_id: string;
  measure_ref: string;
  period_start: string;
  period_end: string;
  gap_type: string;
  status: string;
  detected_at: string;
  task_id?: string | null;
}

interface GapTableProps {
  gaps: Gap[];
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
}

export default function GapTable({ gaps, statusFilter, onStatusFilterChange }: GapTableProps) {
  return (
    <div>
      <div>
        <label htmlFor="status-filter">Status: </label>
        <select id="status-filter" value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)}>
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      {gaps.length === 0 ? (
        <p data-testid="empty-state">No gaps found.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Measure</th>
              <th>Period</th>
              <th>Type</th>
              <th>Status</th>
              <th>Detected</th>
              <th>Outreach Task</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((gap) => (
              <tr key={gap.gap_id} data-testid={`gap-row-${gap.gap_id}`}>
                <td>{gap.member_id}</td>
                <td>{gap.measure_ref}</td>
                <td>{gap.period_start} — {gap.period_end}</td>
                <td>{gap.gap_type}</td>
                <td data-status={gap.status}>{gap.status}</td>
                <td>{new Date(gap.detected_at).toLocaleDateString()}</td>
                <td>{gap.task_id ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
