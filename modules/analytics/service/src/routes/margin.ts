import express from 'express';
import type { Pool } from 'pg';

export function buildMarginRouter(pool: Pool): express.Router {
  const router = express.Router();

  // GET /v1/analytics/margin — returns margin snapshots for the tenant
  router.get('/v1/analytics/margin', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
      if (!tenantId) {
        res.status(401).json({ error: 'Missing x-sim-tenant-id header' });
        return;
      }

      const result = await pool.query<{
        snapshot_id: string;
        tenant_id: string;
        period_start: string;
        period_end: string;
        revenue_usd: string;
        cost_usd: string;
        margin_usd: string;
        computed_at: string;
      }>(
        `SELECT snapshot_id, tenant_id, period_start, period_end,
                revenue_usd::text, cost_usd::text, margin_usd::text, computed_at
         FROM analytics.margin_snapshot
         WHERE tenant_id = $1
         ORDER BY period_start DESC`,
        [tenantId],
      );

      const snapshots = result.rows.map((row) => ({
        snapshot_id: row.snapshot_id,
        tenant_id: row.tenant_id,
        period_start: row.period_start,
        period_end: row.period_end,
        revenue_usd: parseFloat(row.revenue_usd),
        cost_usd: parseFloat(row.cost_usd),
        margin_usd: parseFloat(row.margin_usd),
        computed_at: row.computed_at,
      }));

      res.status(200).json({ snapshots, count: snapshots.length });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/analytics/platform-summary — returns latest de-identified cross-tenant aggregate
  router.get('/v1/analytics/platform-summary', async (_req, res, next) => {
    try {
      const result = await pool.query<{
        aggregate_id: string;
        period_start: string;
        period_end: string;
        tenant_count: number;
        case_count: number;
        gap_count: number;
        total_cost_usd: string;
        computed_at: string;
      }>(
        `SELECT aggregate_id, period_start, period_end, tenant_count, case_count, gap_count,
                total_cost_usd::text, computed_at
         FROM analytics.platform_aggregate
         ORDER BY period_start DESC
         LIMIT 1`,
      );

      if (result.rows.length === 0) {
        res.status(200).json({ summary: null });
        return;
      }

      const row = result.rows[0]!;
      const summary = {
        aggregate_id: row.aggregate_id,
        period_start: row.period_start,
        period_end: row.period_end,
        tenant_count: row.tenant_count,
        case_count: row.case_count,
        gap_count: row.gap_count,
        total_cost_usd: parseFloat(row.total_cost_usd),
        computed_at: row.computed_at,
      };

      res.status(200).json({ summary });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
