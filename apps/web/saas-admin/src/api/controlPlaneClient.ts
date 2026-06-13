export interface Tenant {
  tenant_id: string;
  display: string;
  tier: 'pooled' | 'dedicated' | 'enclave';
  env_kind: 'sandbox' | 'uat' | 'prod';
  env_group: string;
  compliance_baseline: string;
  status: 'provisioning' | 'active' | 'suspended' | 'archived' | 'decommissioned';
  cell_id: string;
  created_at: string;
}

export interface Entitlement {
  tenant_id: string;
  key: string;
  value: unknown;
  expires_at: string | null;
}

export interface TenantsResponse {
  tenants: Tenant[];
  limit: number;
  offset: number;
}

const BASE_URL = import.meta.env['VITE_CONTROL_PLANE_URL'] ?? 'http://localhost:3030';

export const controlPlaneClient = {
  async getTenants(params?: {
    limit?: number;
    offset?: number;
    status?: string;
    tier?: string;
    env_kind?: string;
  }): Promise<TenantsResponse> {
    const url = new URL(`${BASE_URL}/v1/tenants`);
    if (params?.limit) url.searchParams.set('limit', String(params.limit));
    if (params?.offset !== undefined) url.searchParams.set('offset', String(params.offset));
    if (params?.status) url.searchParams.set('status', params.status);
    if (params?.tier) url.searchParams.set('tier', params.tier);
    if (params?.env_kind) url.searchParams.set('env_kind', params.env_kind);
    const res = await fetch(url.toString());
    return res.json() as Promise<TenantsResponse>;
  },

  async getTenant(id: string): Promise<Tenant> {
    const res = await fetch(`${BASE_URL}/v1/tenants/${id}`);
    return res.json() as Promise<Tenant>;
  },

  async getEntitlements(tenantId: string): Promise<Entitlement[]> {
    const res = await fetch(`${BASE_URL}/v1/tenants/${tenantId}/entitlements`);
    const data = (await res.json()) as { entitlements: Entitlement[] };
    return data.entitlements;
  },

  async patchEntitlement(
    tenantId: string,
    key: string,
    value: string,
    expires_at: string | null,
  ): Promise<Entitlement> {
    const res = await fetch(`${BASE_URL}/v1/tenants/${tenantId}/entitlements`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, expires_at }),
    });
    return res.json() as Promise<Entitlement>;
  },

  async suspendTenant(tenantId: string, reason: string): Promise<void> {
    await fetch(`${BASE_URL}/v1/tenants/${tenantId}/suspend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
  },

  async archiveTenant(tenantId: string, reason: string): Promise<void> {
    await fetch(`${BASE_URL}/v1/tenants/${tenantId}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
  },
};
