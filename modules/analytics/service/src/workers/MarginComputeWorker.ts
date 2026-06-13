import type { Pool } from 'pg';
import { ulid } from 'ulid';

// HUMAN_REVIEW: revenue calculation requires claims billing integration (Phase 4C+)
// Revenue is set to $0 as a placeholder until billing data is available
export async function computeMargin(
  pool: Pool,
  tenantId: string,
  periodStart: string,
  periodEnd: string,
): Promise<void> {
  // Cost: sum provider_cost_usd from sim.ai.interaction outbox events in the period
  const { rows: costRows } = await pool.query<{ total_cost: string }>(
    `SELECT COALESCE(SUM((payload->>'provider_cost_usd')::numeric), 0)::text AS total_cost
     FROM shared.outbox
     WHERE topic = 'sim.ai.interaction'
       AND tenant_id = $1
       AND created_at >= $2::timestamptz
       AND created_at < $3::timestamptz`,
    [tenantId, periodStart, periodEnd],
  );
  const costUsd = parseFloat(costRows[0]?.total_cost ?? '0');

  const snapshotId = ulid();
  await pool.query(
    `INSERT INTO analytics.margin_snapshot (snapshot_id, tenant_id, period_start, period_end, revenue_usd, cost_usd)
     VALUES ($1, $2, $3::date, $4::date, $5, $6)
     ON CONFLICT DO NOTHING`,
    [snapshotId, tenantId, periodStart, periodEnd, 0, costUsd],
  );
}
