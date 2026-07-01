import { Router } from 'express';
import type { Pool } from 'pg';

export function createGapsRouter(pool: Pool): Router {
  const router = Router();

  // GET /v1/quality/gaps/summary — grouped gap summary per measure
  router.get('/v1/quality/gaps/summary', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;

      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }

      const { program, status } = req.query as { program?: string; status?: string };

      const { rows } = await pool.query(
        `SELECT
           g.measure_ref                              AS id,
           g.measure_ref                              AS "measureCode",
           g.measure_ref                              AS "measureName",
           MAX(g.provider_id)                         AS provider,
           COUNT(DISTINCT g.member_id)                AS "memberCount",
           COALESCE(MAX(rpt.denominator_count), 0)    AS population,
           MAX(g.status)                              AS status
         FROM qual.gap g
         LEFT JOIN LATERAL (
           SELECT run_id FROM qual.measure_run
           WHERE measure_ref = g.measure_ref
             AND status = 'completed'
             AND tenant_id = $1
           ORDER BY started_at DESC LIMIT 1
         ) latest_run ON TRUE
         LEFT JOIN qual.measure_report rpt ON rpt.run_id = latest_run.run_id
         WHERE g.tenant_id = $1
           AND ($2::TEXT IS NULL OR g.status = $2)
           AND ($3::TEXT IS NULL OR g.measure_ref LIKE lower($3) || '-%')
         GROUP BY g.measure_ref`,
        [tenantId, status ?? null, program ?? null],
      );

      const result = rows.map((row) => ({
        id: row.id,
        measureCode: row.measureCode,
        measureName: row.measureName,
        provider: row.provider ?? '',
        memberCount: Number(row.memberCount),
        population: Number(row.population),
        opportunityScore: Math.round(
          (Number(row.memberCount) / Math.max(Number(row.population), 1)) * 100,
        ),
        status: row.status,
      }));

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/quality/gaps/summary/:measureRef/members — member list for a measure gap
  router.get('/v1/quality/gaps/summary/:measureRef/members', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;

      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }

      const { measureRef } = req.params as { measureRef: string };

      const { rows } = await pool.query(
        `SELECT gap_id AS "gapId", member_id AS "memberId", status
         FROM qual.gap
         WHERE tenant_id = $1 AND measure_ref = $2
         ORDER BY detected_at DESC`,
        [tenantId, measureRef],
      );

      res.status(200).json(rows);
    } catch (err) {
      next(err);
    }
  });

  // POST /v1/quality/gaps/summary/:measureRef/members/:memberId/close — close a gap for a member
  router.post(
    '/v1/quality/gaps/summary/:measureRef/members/:memberId/close',
    async (req, res, next) => {
      try {
        const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;

        if (!tenantId) {
          res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
          return;
        }

        const { measureRef, memberId } = req.params as {
          measureRef: string;
          memberId: string;
        };
        const { reason } = (req.body ?? {}) as { reason?: string };

        const { rows } = await pool.query(
          `UPDATE qual.gap
              SET status = 'closed',
                  closed_at = now(),
                  closure_reason = $4
            WHERE tenant_id = $1
              AND measure_ref = $2
              AND member_id = $3
              AND status = 'open'
           RETURNING gap_id`,
          [tenantId, measureRef, memberId, reason ?? null],
        );

        if (rows.length === 0) {
          res.status(404).json({ code: 'GAP_NOT_FOUND', detail: 'No open gap found' });
          return;
        }

        res.status(200).json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /v1/quality/readiness — readiness check per activated measure
  router.get('/v1/quality/readiness', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;

      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }

      const { rows } = await pool.query(
        `SELECT
           a.measure_ref,
           MAX(r.status)                     AS run_status,
           COUNT(g.gap_id) FILTER (WHERE g.status = 'open') AS open_gaps
         FROM qual.measure_activation a
         LEFT JOIN qual.measure_run r
           ON r.measure_ref = a.measure_ref AND r.tenant_id = $1
         LEFT JOIN qual.gap g
           ON g.measure_ref = a.measure_ref AND g.tenant_id = $1
         WHERE a.tenant_id = $1 AND a.active = true
         GROUP BY a.measure_ref`,
        [tenantId],
      );

      const items = rows.map((row) => {
        const open_gaps = Number(row.open_gaps);
        return {
          measureRef: row.measure_ref,
          status:
            row.run_status === 'completed' && open_gaps === 0
              ? 'passed'
              : open_gaps > 0
                ? 'warning'
                : 'pending',
          flags: open_gaps,
        };
      });

      res.status(200).json({ items });
    } catch (err) {
      next(err);
    }
  });

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
