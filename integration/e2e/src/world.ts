import { World, IWorldOptions, setWorldConstructor } from '@cucumber/cucumber';
import { Pool } from 'pg';
import { fetch, type Response } from 'undici';

export const SERVICE_BASE: Record<string, string> = {
  document:      process.env['DOCUMENT_URL']       ?? 'http://localhost:3010',
  modelGateway:  process.env['MODEL_GATEWAY_URL']  ?? 'http://localhost:3011',
  controlPlane:  process.env['CONTROL_PLANE_URL']  ?? 'http://localhost:3012',
  enstellarCase: process.env['ENSTELLAR_CASE_URL'] ?? 'http://localhost:3013',
  enstellarIntake: process.env['ENSTELLAR_INTAKE_URL'] ?? 'http://localhost:3003',
  workspaceBff:   process.env['WORKSPACE_BFF_URL']    ?? 'http://localhost:4010',
  revital:       process.env['REVITAL_URL']        ?? 'http://localhost:3014',
  qualitron:     process.env['QUALITRON_URL']      ?? 'http://localhost:3015',
  claims:        process.env['CLAIMS_URL']         ?? 'http://localhost:3016',
  automation:    process.env['AUTOMATION_URL']     ?? 'http://localhost:3017',
  marketBundles: process.env['MARKET_BUNDLES_URL'] ?? 'http://localhost:3018',
  search:        process.env['SEARCH_URL']         ?? 'http://localhost:3019',
  analytics:     process.env['ANALYTICS_URL']      ?? 'http://localhost:3020',
  bff:           process.env['BFF_URL']            ?? 'http://localhost:3021',
  fhirFacade:    process.env['FHIR_FACADE_URL']    ?? 'http://localhost:8081',
};

export class SimWorld extends World {
  readonly pool: Pool;
  readonly vars: Map<string, unknown> = new Map();
  lastResponse: Response | null = null;
  lastResponseBody: unknown = null;
  currentTenantId: string = 't_synth_ma';

  constructor(options: IWorldOptions) {
    super(options);
    this.pool = new Pool({
      connectionString: process.env['DATABASE_URL'] ?? 'postgres://sim:sim@localhost:5432/simintero',
    });
  }

  async get(
    service: keyof typeof SERVICE_BASE,
    path: string,
    tenantId: string,
    userId = 'user_test_01',
  ): Promise<Response> {
    const res = await fetch(`${SERVICE_BASE[service]}${path}`, {
      headers: {
        'x-sim-tenant-id': tenantId,
        'x-sim-user-id': userId,
      },
    });
    this.lastResponse = res;
    this.lastResponseBody = await res.json().catch(() => null);
    return res;
  }

  async post(
    service: keyof typeof SERVICE_BASE,
    path: string,
    body: unknown,
    tenantId: string,
    userId = 'user_test_01',
  ): Promise<Response> {
    const res = await fetch(`${SERVICE_BASE[service]}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sim-tenant-id': tenantId,
        'x-sim-user-id': userId,
      },
      body: JSON.stringify(body),
    });
    this.lastResponse = res;
    this.lastResponseBody = await res.json().catch(() => null);
    return res;
  }

  async dbQuery<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
    tenantId?: string,
  ) {
    const tid = tenantId ?? this.currentTenantId;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tid]);
      const result = await client.query<T>(sql, params);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  resolve(value: string): string {
    return value.replace(/\{(\w+)\}/g, (_, key: string) => {
      const v = this.vars.get(key);
      return v !== undefined ? String(v) : key;
    });
  }

  capture(name: string, value: unknown): void {
    this.vars.set(name, value);
  }

  async cleanup(): Promise<void> {
    await this.pool.end();
  }
}

setWorldConstructor(SimWorld);
