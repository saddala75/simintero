import { useTenantDetail } from '../hooks/useTenantDetail.js';
import { EntitlementEditor } from '../components/EntitlementEditor.js';
import { LifecycleActions } from '../components/LifecycleActions.js';
import { TenantStatusBadge } from '../components/TenantStatusBadge.js';

interface Props {
  tenantId: string;
}

export function TenantDetail({ tenantId }: Props) {
  const { tenant, entitlements, loading, error, refetch } = useTenantDetail(tenantId);

  if (loading) return <p>Loading...</p>;
  if (error) return <p role="alert" style={{ color: 'red' }}>{error}</p>;
  if (!tenant) return null;

  return (
    <div>
      <h1>{tenant.display}</h1>
      <dl>
        <dt>Tenant ID</dt>
        <dd>{tenant.tenant_id}</dd>
        <dt>Tier</dt>
        <dd>{tenant.tier}</dd>
        <dt>Env Kind</dt>
        <dd>{tenant.env_kind}</dd>
        <dt>Env Group</dt>
        <dd>{tenant.env_group}</dd>
        <dt>Compliance Baseline</dt>
        <dd>{tenant.compliance_baseline}</dd>
        <dt>Cell ID</dt>
        <dd>{tenant.cell_id}</dd>
        <dt>Status</dt>
        <dd><TenantStatusBadge status={tenant.status} /></dd>
        <dt>Created At</dt>
        <dd>{tenant.created_at}</dd>
      </dl>

      <section>
        <h2>Lifecycle</h2>
        <LifecycleActions tenant={tenant} onSuccess={refetch} />
      </section>

      <section>
        <h2>Entitlements</h2>
        <EntitlementEditor tenantId={tenantId} entitlements={entitlements} />
      </section>
    </div>
  );
}
