import { Router } from 'express';
import { ulid } from 'ulid';
import type { Pool } from 'pg';
import {
  qualitronRunMeasure,
  type RunMeasureInput,
  type RunMeasureResult,
} from '../workflows/QualitronRunMeasure.js';
import { withTenant } from '../db/withTenant.js';

export interface RunsRouterOpts {
  taskServiceUrl?: string;
  runner?: (input: RunMeasureInput, pool: Pool, taskServiceUrl: string) => Promise<RunMeasureResult>;
}

export function createRunsRouter(pool: Pool, opts: RunsRouterOpts = {}): Router {
  const taskServiceUrl = opts.taskServiceUrl ?? process.env['TASK_SERVICE_URL'] ?? 'http://localhost:9';
  const run = opts.runner ?? qualitronRunMeasure;
  const router = Router();

  router.post('/v1/quality/runs', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;

      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }

      const { measure_ref, measure_version, period_start, period_end } = req.body as {
        measure_ref?: string;
        measure_version?: string;
        period_start?: string;
        period_end?: string;
      };

      if (!measure_ref || !measure_version || !period_start || !period_end) {
        res.status(400).json({
          code: 'MISSING_FIELDS',
          detail: 'measure_ref, measure_version, period_start, and period_end are required',
        });
        return;
      }

      const run_id = ulid();

      await withTenant(pool, tenantId, (client) =>
        client.query(
          `INSERT INTO qual.measure_run
             (run_id, tenant_id, measure_ref, measure_version, period_start, period_end, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
          [run_id, tenantId, measure_ref, measure_version, period_start, period_end],
        ),
      );

      // Kick off the measure run in the background (non-awaited): the run sets
      // its own tenant transaction and transitions running -> complete. On
      // failure, mark the measure_run row failed.
      void run(
        {
          run_id,
          tenant_id: tenantId,
          measure_ref,
          measure_version,
          period_start,
          period_end,
        },
        pool,
        taskServiceUrl,
      ).catch(async (err) => {
        console.error('[qualitron] run failed', run_id, err);
        try {
          await withTenant(pool, tenantId, (client) =>
            client.query(
              `UPDATE qual.measure_run SET status='failed', completed_at=NOW() WHERE run_id=$1`,
              [run_id],
            ),
          );
        } catch {
          /* swallow: best-effort failure marking */
        }
      });

      res.status(202).json({ run_id, status: 'accepted' });
    } catch (err) {
      next(err);
    }
  });

  router.get('/v1/quality/runs/:runId', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;

      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }

      const { rows } = await withTenant(pool, tenantId, (client) =>
        client.query(
          `SELECT * FROM qual.measure_run WHERE run_id = $1 AND tenant_id = $2`,
          [req.params['runId'], tenantId],
        ),
      );

      if (!rows[0]) {
        res.status(404).json({ code: 'NOT_FOUND', detail: 'Run not found' });
        return;
      }

      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createRunsRouter;
