import { useState, useEffect } from 'react';
import type { Tenant } from '../api/controlPlaneClient.js';
import { controlPlaneClient } from '../api/controlPlaneClient.js';
import { TenantStatusBadge } from '../components/TenantStatusBadge.js';

const PAGE_SIZE = 50;

const STATUS_OPTIONS = ['', 'provisioning', 'active', 'suspended', 'archived', 'decommissioned'];
const TIER_OPTIONS = ['', 'pooled', 'dedicated', 'enclave'];
const ENV_KIND_OPTIONS = ['', 'sandbox', 'uat', 'prod'];

interface TenantListProps {
  onSelect?: (tenantId: string) => void;
}

export function TenantList(props: TenantListProps) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [envKindFilter, setEnvKindFilter] = useState('');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params: Parameters<typeof controlPlaneClient.getTenants>[0] = {
      limit: PAGE_SIZE,
      offset,
    };
    if (statusFilter) params.status = statusFilter;
    if (tierFilter) params.tier = tierFilter;
    if (envKindFilter) params.env_kind = envKindFilter;

    controlPlaneClient
      .getTenants(params)
      .then((res) => {
        if (!cancelled) setTenants(res.tenants);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tenants');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [statusFilter, tierFilter, envKindFilter, offset]);

  function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setStatusFilter(e.target.value);
    setOffset(0);
  }

  function handleTierChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setTierFilter(e.target.value);
    setOffset(0);
  }

  function handleEnvKindChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setEnvKindFilter(e.target.value);
    setOffset(0);
  }

  return (
    <div>
      <h1>Tenants</h1>

      <div style={{ marginBottom: '12px', display: 'flex', gap: '12px' }}>
        <label>
          Status:
          <select
            value={statusFilter}
            onChange={handleStatusChange}
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || 'All'}
              </option>
            ))}
          </select>
        </label>

        <label>
          Tier:
          <select
            value={tierFilter}
            onChange={handleTierChange}
            aria-label="Filter by tier"
          >
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t || 'All'}
              </option>
            ))}
          </select>
        </label>

        <label>
          Env Kind:
          <select
            value={envKindFilter}
            onChange={handleEnvKindChange}
            aria-label="Filter by env kind"
          >
            {ENV_KIND_OPTIONS.map((e) => (
              <option key={e} value={e}>
                {e || 'All'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <table data-testid="tenant-table">
        <thead>
          <tr>
            <th>Tenant ID</th>
            <th>Display</th>
            <th>Tier</th>
            <th>Env Kind</th>
            <th>Env Group</th>
            <th>Status</th>
            <th>Created At</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((tenant) => (
            <tr
              key={tenant.tenant_id}
              data-testid={`tenant-row-${tenant.tenant_id}`}
              onClick={() => props.onSelect?.(tenant.tenant_id)}
              style={props.onSelect ? { cursor: 'pointer' } : undefined}
            >
              <td>{tenant.tenant_id}</td>
              <td>{tenant.display}</td>
              <td>{tenant.tier}</td>
              <td>{tenant.env_kind}</td>
              <td>{tenant.env_group}</td>
              <td>
                <TenantStatusBadge status={tenant.status} />
              </td>
              <td>{tenant.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
        <button
          onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
          disabled={offset === 0}
          aria-label="Previous page"
        >
          Previous
        </button>
        <button
          onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
          disabled={tenants.length < PAGE_SIZE}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
}
