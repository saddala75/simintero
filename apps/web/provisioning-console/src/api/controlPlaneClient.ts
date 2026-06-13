export interface TenantCreateInput {
  display: string;
  tier: 'pooled' | 'dedicated' | 'enclave';
  env_kind: 'sandbox' | 'uat' | 'prod';
  env_group: string;
  region: string;
  compliance_baseline: 'MA' | 'MEDICAID' | 'COMMERCIAL' | 'PUBLIC';
}

export interface ProvisioningOperation {
  operation_id: string;
  kind: string;
  tenant_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result: unknown;
  created_at: string;
}

const BASE_URL = import.meta.env['VITE_CONTROL_PLANE_URL'] ?? 'http://localhost:3030';

export const controlPlaneClient = {
  async createTenant(
    input: TenantCreateInput,
  ): Promise<{ tenant_id: string; operation_id: string }> {
    const res = await fetch(`${BASE_URL}/v1/tenants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return res.json() as Promise<{ tenant_id: string; operation_id: string }>;
  },
  async getOperation(operationId: string): Promise<ProvisioningOperation> {
    const res = await fetch(`${BASE_URL}/v1/operations/${operationId}`);
    return res.json() as Promise<ProvisioningOperation>;
  },
};
