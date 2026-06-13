import { useState, useEffect } from 'react';
import type { Tenant } from '../api/controlPlaneClient.js';
import { controlPlaneClient } from '../api/controlPlaneClient.js';
import { TenantStatusBadge } from '../components/TenantStatusBadge.js';

type EnvKind = 'sandbox' | 'uat' | 'prod';

interface GroupedTenants {
  env_group: string;
  sandbox: Tenant | null;
  uat: Tenant | null;
  prod: Tenant | null;
}

function groupTenants(tenants: Tenant[]): GroupedTenants[] {
  const groups = new Map<string, GroupedTenants>();

  for (const t of tenants) {
    if (!groups.has(t.env_group)) {
      groups.set(t.env_group, { env_group: t.env_group, sandbox: null, uat: null, prod: null });
    }
    const g = groups.get(t.env_group)!;
    g[t.env_kind as EnvKind] = t;
  }

  return Array.from(groups.values()).sort((a, b) => a.env_group.localeCompare(b.env_group));
}

export function EnvGroupView() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    controlPlaneClient
      .getTenants({ limit: 500 })
      .then((res) => setTenants(res.tenants))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const groups = groupTenants(tenants);

  if (loading) return <p>Loading...</p>;
  if (error) return <p role="alert" style={{ color: 'red' }}>{error}</p>;

  return (
    <div>
      <h1>Env Group View</h1>
      <table data-testid="env-group-table">
        <thead>
          <tr>
            <th>Env Group</th>
            <th>Sandbox</th>
            <th>UAT</th>
            <th>Prod</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.env_group}>
              <td>{g.env_group}</td>
              {(['sandbox', 'uat', 'prod'] as const).map((kind) => {
                const t = g[kind];
                return (
                  <td key={kind}>
                    {t ? (
                      <div>
                        <div>{t.tenant_id}</div>
                        <TenantStatusBadge status={t.status} />
                      </div>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
