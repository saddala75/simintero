import type { Tenant } from '../api/controlPlaneClient.js';

interface Props {
  status: Tenant['status'];
}

const STATUS_COLORS: Record<Tenant['status'], string> = {
  active: '#16a34a',
  provisioning: '#ca8a04',
  suspended: '#ea580c',
  archived: '#6b7280',
  decommissioned: '#dc2626',
};

export function TenantStatusBadge({ status }: Props) {
  return (
    <span
      data-testid={`status-badge-${status}`}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '4px',
        backgroundColor: STATUS_COLORS[status],
        color: '#ffffff',
        fontSize: '0.75rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}
