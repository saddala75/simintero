import { Given } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { SimWorld, SERVICE_BASE } from '../world';
import { fetch } from 'undici';

const ALL_HEALTH_CHECKS: Array<{ label: string; url: string }> = [
  { label: 'document',      url: `${SERVICE_BASE['document']}/health` },
  { label: 'modelGateway',  url: `${SERVICE_BASE['modelGateway']}/health` },
  { label: 'controlPlane',  url: `${SERVICE_BASE['controlPlane']}/health` },
  { label: 'enstellarCase', url: `${SERVICE_BASE['enstellarCase']}/health` },
  { label: 'revital',       url: `${SERVICE_BASE['revital']}/health` },
  { label: 'qualitron',     url: `${SERVICE_BASE['qualitron']}/health` },
  { label: 'claims',        url: `${SERVICE_BASE['claims']}/health` },
  { label: 'automation',    url: `${SERVICE_BASE['automation']}/health` },
  { label: 'marketBundles', url: `${SERVICE_BASE['marketBundles']}/health` },
  { label: 'search',        url: `${SERVICE_BASE['search']}/health` },
  { label: 'analytics',     url: `${SERVICE_BASE['analytics']}/health` },
  { label: 'bff',           url: `${SERVICE_BASE['bff']}/health` },
];

async function checkAllServices(): Promise<void> {
  const results = await Promise.all(
    ALL_HEALTH_CHECKS.map(async ({ label, url }) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        return { label, ok: res.status === 200, status: res.status };
      } catch {
        return { label, ok: false };
      }
    }),
  );
  const healthy = results.filter((r) => r.ok);
  const unhealthy = results.filter((r) => !r.ok);
  if (unhealthy.length > 0) {
    console.warn(
      `[e2e] ${unhealthy.length} service(s) not reachable (tests that call them will fail): ` +
        unhealthy.map((r) => r.label).join(', '),
    );
  }
  if (healthy.length === 0) {
    throw new Error(
      `No platform services are reachable — is the stack running?\n` +
        unhealthy.map((r) => r.label).join(', '),
    );
  }
}

Given('the Simintero platform services are running', async function (this: SimWorld) {
  await checkAllServices();
});

Given('the platform is running', async function (this: SimWorld) {
  await checkAllServices();
});

Given('the pooled cell {string} is active', async function (this: SimWorld, cellId: string) {
  const { rows } = await this.dbQuery<{ status: string }>(
    `SELECT status FROM ctrl.cell WHERE cell_id = $1`,
    [cellId],
  );
  if (rows.length === 0) {
    await this.dbQuery(
      `INSERT INTO ctrl.cell (cell_id, tier, region, endpoint, status, capacity_max)
       VALUES ($1, 'pooled', 'us-east-1', 'postgres://sim:sim@localhost:5432/simintero', 'active', 200)
       ON CONFLICT (cell_id) DO NOTHING`,
      [cellId],
    );
  } else {
    assert.equal(rows[0].status, 'active', `Cell ${cellId} exists but status is ${rows[0].status}`);
  }
});

async function upsertSyntheticTenant(world: SimWorld, tenantId: string): Promise<void> {
  await world.dbQuery(
    `INSERT INTO ctrl.cell (cell_id, tier, region, endpoint, status, capacity_max)
     VALUES ('cell-pooled-us1', 'pooled', 'us-east-1', 'postgres://sim:sim@localhost:5432/simintero', 'active', 200)
     ON CONFLICT (cell_id) DO NOTHING`,
  );
  await world.dbQuery(
    `INSERT INTO ctrl.tenant
       (tenant_id, display, tier, cell_id, status, env_kind, env_group, compliance_baseline)
     VALUES ($1, $1, 'pooled', 'cell-pooled-us1', 'active', 'sandbox', 'test', 'MA')
     ON CONFLICT (tenant_id) DO UPDATE SET status = 'active'`,
    [tenantId],
  );
  world.currentTenantId = tenantId;
}

Given(
  'the synthetic tenant {string} is provisioned and active',
  async function (this: SimWorld, tenantId: string) {
    await upsertSyntheticTenant(this, tenantId);
  },
);

Given(
  'the synthetic MA tenant {string} is provisioned and active',
  async function (this: SimWorld, tenantId: string) {
    await upsertSyntheticTenant(this, tenantId);
  },
);

Given(
  'the tenant {string} is provisioned',
  async function (this: SimWorld, tenantId: string) {
    await upsertSyntheticTenant(this, tenantId);
  },
);
