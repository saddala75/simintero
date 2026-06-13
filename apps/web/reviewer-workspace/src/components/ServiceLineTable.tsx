import type { ServiceLine } from '../types.js';

interface ServiceLineTableProps {
  lines: ServiceLine[];
}

export function ServiceLineTable({ lines }: ServiceLineTableProps) {
  if (lines.length === 0) {
    return <p className="service-line-table__empty">No service lines.</p>;
  }

  return (
    <table className="service-line-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>System</th>
          <th>Qty</th>
          <th>Status</th>
          <th>Place of Service</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.line_id}>
            <td>{line.code.code}</td>
            <td>{line.code.system}</td>
            <td>{line.qty}</td>
            <td>{line.status}</td>
            <td>{line.place_of_service ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
