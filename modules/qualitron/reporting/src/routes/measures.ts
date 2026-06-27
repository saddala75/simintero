import { Router } from 'express';
import type { Pool } from 'pg';

export function createMeasuresRouter(pool: Pool): Router {
  const router = Router();

  // GET /v1/quality/measures — list all measure runs for a tenant
  router.get('/v1/quality/measures', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;

      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }

      const { rows } = await pool.query(
        `SELECT run_id, measure_ref, period_start, period_end, status, started_at, completed_at
         FROM qual.measure_run
         WHERE tenant_id = $1
         ORDER BY created_at DESC`,
        [tenantId],
      );

      res.status(200).json({ runs: rows });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/quality/measures/:runId/summary — aggregate stats for a run
  router.get('/v1/quality/measures/:runId/summary', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;

      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }

      const { runId } = req.params as { runId: string };

      const { rows: summaryRows } = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE denominator) AS denominator_count,
           COUNT(*) FILTER (WHERE numerator) AS numerator_count,
           COUNT(*) FILTER (WHERE exclusion) AS exclusion_count
         FROM qual.measure_report
         WHERE run_id = $1 AND tenant_id = $2`,
        [runId, tenantId],
      );

      const summary = summaryRows[0] as
        | { denominator_count: string; numerator_count: string; exclusion_count: string }
        | undefined;

      const denominator_count = parseInt(summary?.denominator_count ?? '0', 10);
      const numerator_count = parseInt(summary?.numerator_count ?? '0', 10);
      const exclusion_count = parseInt(summary?.exclusion_count ?? '0', 10);

      const { rows: gapRows } = await pool.query(
        `SELECT COUNT(*) FROM qual.gap
         WHERE tenant_id = $1
           AND status = 'open'
           AND measure_ref = (
             SELECT measure_ref FROM qual.measure_run WHERE run_id = $2
           )`,
        [tenantId, runId],
      );

      const gapRow = gapRows[0] as { count: string } | undefined;
      const gap_count = parseInt(gapRow?.count ?? '0', 10);

      const rate = denominator_count === 0 ? 0 : numerator_count / denominator_count;

      res.status(200).json({
        run_id: runId,
        denominator_count,
        numerator_count,
        exclusion_count,
        gap_count,
        rate,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/quality/measures/:runId/members — paginated member-level reports
  router.get('/v1/quality/measures/:runId/members', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;

      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }

      const { runId } = req.params as { runId: string };
      const page = Math.max(0, parseInt((req.query['page'] as string | undefined) ?? '0', 10));
      const offset = page * 100;

      const { rows } = await pool.query(
        `SELECT report_id, member_id, numerator, denominator, exclusion, created_at
         FROM qual.measure_report
         WHERE run_id = $1 AND tenant_id = $2
         ORDER BY created_at
         LIMIT 100 OFFSET $3`,
        [runId, tenantId, offset],
      );

      res.status(200).json({ members: rows, page });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/quality/measures/:ref/runs/:runId/report — FHIR submission-ready Summary MeasureReport
  router.get('/v1/quality/measures/:ref/runs/:runId/report', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }
      const { runId } = req.params as { runId: string };
      const { rows } = await pool.query<{ report_fhir: object }>(
        `SELECT report_fhir FROM qual.measure_report
         WHERE run_id = $1 AND tenant_id = $2 AND report_type = 'summary'
         LIMIT 1`,
        [runId, tenantId],
      );
      if (!rows[0] || !rows[0].report_fhir) {
        res.status(404).json({ code: 'NOT_FOUND', detail: 'No summary report for this run' });
        return;
      }
      res.status(200)
        .header('Content-Type', 'application/fhir+json')
        .json(rows[0].report_fhir);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createMeasuresRouter;
