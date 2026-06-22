import type pg from 'pg';
import { appendEvent } from '@sim/outbox-ts/append';
import type { ArtifactApprovalState, ApprovalRecord, Gate } from '../gates/GateEnforcer.js';
import type { GovernanceStore, Decision } from './GovernanceStore.js';
import { withTenant } from '../db/withTenant.js';

const GOVERNANCE_TENANT = 'shared';

export class PgGovernanceStore implements GovernanceStore {
  constructor(private pool: pg.Pool) {}

  async submit(i: { artifactId: string; createdBy: string; cqlLibraryUrl?: string; version?: string }): Promise<{ created: boolean }> {
    return withTenant(this.pool, GOVERNANCE_TENANT, async (client) => {
      const r = await client.query(
        `INSERT INTO governance.artifact (artifact_id, tenant_id, created_by, cql_library_url, version)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (artifact_id) DO NOTHING`,
        [i.artifactId, GOVERNANCE_TENANT, i.createdBy, i.cqlLibraryUrl ?? null, i.version ?? null],
      );
      return { created: (r.rowCount ?? 0) > 0 };
    });
  }

  async get(artifactId: string): Promise<ArtifactApprovalState | undefined> {
    return withTenant(this.pool, GOVERNANCE_TENANT, async (client) => {
      const h = await client.query(
        `SELECT artifact_id, created_by, cql_library_url, version, activated_at
           FROM governance.artifact WHERE artifact_id = $1`, [artifactId]);
      if (h.rows.length === 0) return undefined;
      const row = h.rows[0] as Record<string, unknown>;
      const ap = await client.query(
        `SELECT gate, approver, decision, recorded_at FROM governance.approval
           WHERE artifact_id = $1 ORDER BY recorded_at, id`, [artifactId]);
      const approvals: ApprovalRecord[] = ap.rows.map((a: Record<string, unknown>) => ({
        gate: a['gate'] as Gate, approver: a['approver'] as string,
        decision: a['decision'] as Decision, recorded_at: new Date(a['recorded_at'] as string).toISOString(),
      }));
      const state: ArtifactApprovalState = {
        artifact_id: row['artifact_id'] as string, created_by: row['created_by'] as string, approvals,
      };
      if (row['cql_library_url'] != null) state.cql_library_url = row['cql_library_url'] as string;
      if (row['version'] != null) state.version = row['version'] as string;
      if (row['activated_at'] != null) state.activated_at = new Date(row['activated_at'] as string).toISOString();
      return state;
    });
  }

  async recordApproval(r: { artifactId: string; gate: Gate; approver: string; decision: Decision; recordedAt: string }): Promise<void> {
    await withTenant(this.pool, GOVERNANCE_TENANT, async (client) => {
      await client.query(
        `INSERT INTO governance.approval (artifact_id, tenant_id, gate, approver, decision, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [r.artifactId, GOVERNANCE_TENANT, r.gate, r.approver, r.decision, r.recordedAt]);
      await appendEvent(client, {
        topic: 'sim.artifact', schemaRef: 'sim.artifact/ApprovalRecorded/v1', tenantId: GOVERNANCE_TENANT,
        payload: { artifact_id: r.artifactId, gate: r.gate, decision: r.decision }, correlationId: r.artifactId,
      });
    });
  }

  async markActivated(artifactId: string): Promise<void> {
    await withTenant(this.pool, GOVERNANCE_TENANT, async (client) => {
      await client.query(`UPDATE governance.artifact SET activated_at = now() WHERE artifact_id = $1`, [artifactId]);
      await appendEvent(client, {
        topic: 'sim.artifact', schemaRef: 'sim.artifact/Activated/v1', tenantId: GOVERNANCE_TENANT,
        payload: { artifact_id: artifactId }, correlationId: artifactId,
      });
    });
  }

  async list(): Promise<ArtifactApprovalState[]> {
    return withTenant(this.pool, GOVERNANCE_TENANT, async (client) => {
      const h = await client.query(
        `SELECT artifact_id, created_by, cql_library_url, version, activated_at FROM governance.artifact`);
      const out: ArtifactApprovalState[] = [];
      for (const row of h.rows as Record<string, unknown>[]) {
        const ap = await client.query(
          `SELECT gate, approver, decision, recorded_at FROM governance.approval
             WHERE artifact_id = $1 ORDER BY recorded_at, id`, [row['artifact_id']]);
        const state: ArtifactApprovalState = {
          artifact_id: row['artifact_id'] as string, created_by: row['created_by'] as string,
          approvals: ap.rows.map((a: Record<string, unknown>) => ({
            gate: a['gate'] as Gate, approver: a['approver'] as string,
            decision: a['decision'] as Decision, recorded_at: new Date(a['recorded_at'] as string).toISOString(),
          })),
        };
        if (row['cql_library_url'] != null) state.cql_library_url = row['cql_library_url'] as string;
        if (row['version'] != null) state.version = row['version'] as string;
        if (row['activated_at'] != null) state.activated_at = new Date(row['activated_at'] as string).toISOString();
        out.push(state);
      }
      return out;
    });
  }
}
