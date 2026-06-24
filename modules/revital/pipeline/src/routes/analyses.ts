import { Router } from 'express';
import { monotonicFactory } from 'ulid';
import type { Pool } from 'pg';
import { withTenant } from '../db/withTenant.js';

const ulid = monotonicFactory();

interface TemporalClientLike {
  start(workflowFn: unknown, opts: unknown): Promise<{ workflowId: string }>;
}

export function createAnalysesRouter(pool: Pool, temporalClient: TemporalClientLike): Router {
  const router = Router();

  router.post('/v1/assist/analyses', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string;

      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }

      // Check kill-switch
      const { rows: ks } = await pool.query<{ value: { value: boolean } }>(
        `SELECT value FROM ctrl.entitlement WHERE tenant_id = $1 AND key = 'ai.inference.disabled'`,
        [tenantId],
      );
      if (ks[0]?.value?.value) {
        res.status(409).json({
          type: 'https://errors.simintero.io/SIM-REV-DISABLED',
          code: 'SIM-REV-DISABLED',
          detail: 'AI inference is disabled for this tenant',
        });
        return;
      }

      const analysisId = `ana_${ulid()}`;
      const { case_ref, inputs, analysis_kinds } = req.body as {
        case_ref: string;
        analysis_kinds: string[];
        inputs: { document_refs: string[]; case_context: Record<string, unknown> };
      };
      const rawMember = inputs?.case_context?.['member_ref'];
      const member_ref = typeof rawMember === 'string' ? rawMember : undefined;

      // Insert processing row under the tenant GUC (RLS-protected table).
      await withTenant(pool, tenantId, (c) =>
        c.query(
          `INSERT INTO revital.analysis
             (analysis_id, tenant_id, case_ref, status, interaction, abstentions, unprocessed_inputs)
           VALUES ($1, current_setting('sim.tenant_id', true), $2, 'processing', '{}', '[]', '[]')`,
          [analysisId, case_ref],
        ),
      );

      // Start Temporal workflow
      await temporalClient.start('revitalAnalyzeCase', {
        workflowId: analysisId,
        taskQueue: 'revital',
        args: [{
          analysis_id: analysisId,
          tenant_id: tenantId,
          case_ref,
          document_refs: inputs.document_refs,
          member_ref,
          evidence_requirements_ref: null,
          model_binding_ref: process.env['DEFAULT_MODEL_BINDING'] ?? 'https://artifacts.simintero.io/shared/model_binding/claude-pa',
          model_binding_version: process.env['DEFAULT_MODEL_BINDING_VERSION'] ?? '1.0.0',
          prompt_ref: process.env['DEFAULT_PROMPT'] ?? 'https://artifacts.simintero.io/shared/prompt/pa-review',
          prompt_version: '1.0.0',
          cell_boundary: 'pooled',
        }],
      });

      res.status(202).json({
        analysis_id: analysisId,
        operation: `/v1/operations/${analysisId}`,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/v1/assist/analyses/:id', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string;
      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
        return;
      }
      const rows = await withTenant(pool, tenantId, async (c) => {
        const r = await c.query(`SELECT * FROM revital.analysis WHERE analysis_id = $1`, [req.params['id']]);
        return r.rows;
      });
      if (!rows[0]) { res.status(404).end(); return; }

      const row = rows[0] as {
        analysis_id: string; status: string; case_ref: string;
        interaction: unknown; summary: unknown; extraction: unknown;
        completeness: unknown; triage: unknown; abstentions: unknown; unprocessed_inputs: unknown;
      };

      res.json({
        analysis_id: row.analysis_id,
        classification: 'advisory',  // INV-1: always advisory
        status: row.status,
        case_ref: row.case_ref,
        interaction: row.interaction,
        summary: row.summary,
        extraction: row.extraction,
        completeness: row.completeness,
        triage: row.triage,
        abstentions: row.abstentions,
        unprocessed_inputs: row.unprocessed_inputs,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
