import React, { useState, useEffect } from 'react';
import type { Tenant } from '../api/controlPlaneClient.js';
import { controlPlaneClient } from '../api/controlPlaneClient.js';
import { TenantStatusBadge } from '../components/TenantStatusBadge.js';

interface CellGroup {
  cell_id: string;
  tenants: Tenant[];
  activeTenants: number;
}

function groupByCell(tenants: Tenant[]): CellGroup[] {
  const cells = new Map<string, Tenant[]>();

  for (const t of tenants) {
    if (!cells.has(t.cell_id)) cells.set(t.cell_id, []);
    cells.get(t.cell_id)!.push(t);
  }

  return Array.from(cells.entries())
    .map(([cell_id, ts]) => ({
      cell_id,
      tenants: ts,
      activeTenants: ts.filter((t) => t.status === 'active').length,
    }))
    .sort((a, b) => a.cell_id.localeCompare(b.cell_id));
}

export function CellView() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCell, setExpandedCell] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    controlPlaneClient
      .getTenants({ limit: 500 })
      .then((res) => setTenants(res.tenants))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const cells = groupByCell(tenants);

  if (loading) return <p>Loading...</p>;
  if (error) return <p role="alert" style={{ color: 'red' }}>{error}</p>;

  return (
    <div>
      <h1>Cell Health View</h1>
      <table data-testid="cell-table">
        <thead>
          <tr>
            <th>Cell ID</th>
            <th>Total Tenants</th>
            <th>Active Tenants</th>
            <th>Health</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((cell) => {
            const healthPct =
              cell.tenants.length > 0
                ? Math.round((cell.activeTenants / cell.tenants.length) * 100)
                : 0;
            const isExpanded = expandedCell === cell.cell_id;
            return (
              <React.Fragment key={cell.cell_id}>
                <tr>
                  <td>{cell.cell_id}</td>
                  <td>{cell.tenants.length}</td>
                  <td>{cell.activeTenants}</td>
                  <td>{healthPct}% active</td>
                  <td>
                    <button
                      onClick={() => setExpandedCell(isExpanded ? null : cell.cell_id)}
                    >
                      {isExpanded ? 'Collapse' : 'Expand'}
                    </button>
                  </td>
                </tr>
                {isExpanded &&
                  cell.tenants.map((t) => (
                    <tr key={`${cell.cell_id}-${t.tenant_id}`} style={{ backgroundColor: '#f9fafb' }}>
                      <td colSpan={1} style={{ paddingLeft: '2rem' }}>{t.tenant_id}</td>
                      <td colSpan={1}>{t.display}</td>
                      <td colSpan={1}>{t.tier}</td>
                      <td colSpan={2}>
                        <TenantStatusBadge status={t.status} />
                      </td>
                    </tr>
                  ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
