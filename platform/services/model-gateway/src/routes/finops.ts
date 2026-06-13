import { Router } from 'express';
import type { Pool } from 'pg';

export function createFinopsRouter(pool: Pool): Router {
  const router = Router();

  // GET /v1/finops/cost-summary
  router.get('/v1/finops/cost-summary', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ code: 'MISSING_TENANT', detail: 'x-sim-tenant-id required' });

    const { period_start, period_end, module } = req.query as Record<string, string | undefined>;
    if (!period_start || !period_end) {
      return res.status(400).json({ code: 'MISSING_PERIOD', detail: 'period_start and period_end required' });
    }

    const params: unknown[] = [tenantId, period_start, period_end];
    const moduleFilter = module ? `AND payload->>'module' = $${params.push(module)}` : '';

    const { rows } = await pool.query<{
      module: string;
      total_usd: string;
      inference_count: string;
      avg_latency_ms: string;
    }>(
      `SELECT
         payload->>'module' AS module,
         SUM((payload->>'provider_cost_usd')::numeric) AS total_usd,
         COUNT(*) AS inference_count,
         AVG((payload->>'latency_ms')::numeric) AS avg_latency_ms
       FROM shared.outbox
       WHERE topic = 'sim.ai.interaction'
         AND tenant_id = $1
         AND created_at >= $2
         AND created_at <= $3
         ${moduleFilter}
       GROUP BY payload->>'module'
       ORDER BY total_usd DESC`,
      params,
    );

    return res.json({
      period_start,
      period_end,
      tenant_id: tenantId,
      summary: rows.map((r) => ({
        module: r.module,
        total_usd: parseFloat(r.total_usd ?? '0'),
        inference_count: parseInt(r.inference_count, 10),
        avg_latency_ms: parseFloat(r.avg_latency_ms ?? '0'),
      })),
    });
  });

  // GET /v1/finops/cost-by-model
  router.get('/v1/finops/cost-by-model', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ code: 'MISSING_TENANT', detail: 'x-sim-tenant-id required' });

    const { period_start, period_end } = req.query as Record<string, string | undefined>;
    if (!period_start || !period_end) {
      return res.status(400).json({ code: 'MISSING_PERIOD', detail: 'period_start and period_end required' });
    }

    const { rows } = await pool.query<{
      model_binding_ref: string;
      total_usd: string;
      inference_count: string;
      avg_latency_ms: string;
    }>(
      `SELECT
         payload->>'model_binding_ref' AS model_binding_ref,
         SUM((payload->>'provider_cost_usd')::numeric) AS total_usd,
         COUNT(*) AS inference_count,
         AVG((payload->>'latency_ms')::numeric) AS avg_latency_ms
       FROM shared.outbox
       WHERE topic = 'sim.ai.interaction'
         AND tenant_id = $1
         AND created_at >= $2
         AND created_at <= $3
       GROUP BY payload->>'model_binding_ref'
       ORDER BY total_usd DESC`,
      [tenantId, period_start, period_end],
    );

    return res.json({
      period_start,
      period_end,
      tenant_id: tenantId,
      by_model: rows.map((r) => ({
        model_binding_ref: r.model_binding_ref,
        total_usd: parseFloat(r.total_usd ?? '0'),
        inference_count: parseInt(r.inference_count, 10),
        avg_latency_ms: parseFloat(r.avg_latency_ms ?? '0'),
      })),
    });
  });

  return router;
}
