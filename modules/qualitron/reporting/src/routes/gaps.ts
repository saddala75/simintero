import { Router } from 'express';
import type { Pool } from 'pg';

export function createGapsRouter(pool: Pool): Router {
  const router = Router();

  // GET /v1/quality/gaps — list gaps for a tenant with optional filters
  router.get('/v1/quality/gaps', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;

      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }

      const { member_id, measure_ref, status } = req.query as {
        member_id?: string;
        measure_ref?: string;
        status?: string;
      };

      const params: unknown[] = [tenantId];
      const conditions: string[] = ['g.tenant_id = $1'];

      if (member_id !== undefined && member_id !== '') {
        params.push(member_id);
        conditions.push(`g.member_id = $${params.length}`);
      }

      if (measure_ref !== undefined && measure_ref !== '') {
        params.push(measure_ref);
        conditions.push(`g.measure_ref = $${params.length}`);
      }

      if (status !== undefined && status !== '') {
        params.push(status);
        conditions.push(`g.status = $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const { rows } = await pool.query(
        `SELECT gap_id, member_id, measure_ref, period_start, period_end, gap_type, status,
                detected_at, closed_at, closure_reason
         FROM qual.gap g
         WHERE ${whereClause}
         ORDER BY detected_at DESC
         LIMIT 100`,
        params,
      );

      res.status(200).json({ gaps: rows });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/quality/gaps/:gapId — single gap with optional outreach task ref
  router.get('/v1/quality/gaps/:gapId', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;

      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }

      const { gapId } = req.params as { gapId: string };

      const { rows } = await pool.query(
        `SELECT g.gap_id, g.member_id, g.measure_ref, g.period_start, g.period_end,
                g.gap_type, g.status, g.detected_at, g.closed_at, g.closure_reason,
                otr.task_id
         FROM qual.gap g
         LEFT JOIN qual.outreach_task_ref otr
           ON otr.gap_id = g.gap_id AND otr.tenant_id = g.tenant_id
         WHERE g.gap_id = $1 AND g.tenant_id = $2`,
        [gapId, tenantId],
      );

      if (rows.length === 0) {
        res.status(404).json({ code: 'GAP_NOT_FOUND', detail: `Gap ${gapId} not found` });
        return;
      }

      res.status(200).json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createGapsRouter;
