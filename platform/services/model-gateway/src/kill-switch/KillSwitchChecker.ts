import type { Pool } from 'pg';

interface EntitlementRow {
  key: string;
  value: { value: boolean };
}

interface CacheEntry {
  data: Record<string, boolean>;
  fetchedAt: number;
}

export class KillSwitchChecker {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly TTL_MS = 60_000;

  constructor(private readonly pool: Pool) {}

  async isKilled(tenantId: string, workflowId?: string): Promise<boolean> {
    const ents = await this.fetchEntitlements(tenantId);
    if (ents['ai.inference.disabled']) return true;
    if (workflowId && ents[`ai.workflow.${workflowId}.disabled`]) return true;
    return false;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private async fetchEntitlements(tenantId: string): Promise<Record<string, boolean>> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.fetchedAt < this.TTL_MS) return cached.data;

    const { rows } = await this.pool.query<EntitlementRow>(
      `SELECT key, value FROM ctrl.entitlement WHERE tenant_id = $1 AND key LIKE 'ai.%'`,
      [tenantId],
    );
    const data = Object.fromEntries(rows.map(r => [r.key, r.value.value ?? false]));
    this.cache.set(tenantId, { data, fetchedAt: Date.now() });
    return data;
  }
}
