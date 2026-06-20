import { Router } from 'express';
import type { Pool } from 'pg';
import { appendEvent } from '@sim/outbox-ts/append';
import { withTenant } from '../db/withTenant.js';

export function createFeedbackRouter(pool: Pool): Router {
  const router = Router();

  router.post('/v1/assist/analyses/:id/feedback', async (req, res, next) => {
    try {
      const { id } = req.params;
      const tenantId = req.headers['x-sim-tenant-id'] as string;
      const actor = { type: 'human', id: req.headers['x-sim-user-id'] as string ?? 'unknown' };

      const hasHallucination = ((req.body.items ?? []) as Array<{ action: string; reason_code?: string }>)
        .some(item => item.action === 'overridden' && item.reason_code === 'hallucination_suspected');

      await withTenant(pool, tenantId, async (client) => {
        // The tenant GUC is now set transaction-locally, so RLS on revital.feedback applies.
        await client.query(
          `INSERT INTO revital.feedback (tenant_id, analysis_id, actor, items)
           VALUES (current_setting('sim.tenant_id', true), $1, $2, $3)`,
          [id, JSON.stringify(actor), JSON.stringify(req.body.items)],
        );

        // Emit FeedbackRecorded to outbox
        await appendEvent(client, {
          topic: 'sim.ai.interaction',
          schemaRef: 'sim.ai.interaction/FeedbackRecorded/v1',
          tenantId,
          payload: { event_type: 'FeedbackRecorded', analysis_id: id, actor, items_count: (req.body.items as unknown[]).length },
          correlationId: id,
        });

        // HUMAN_REVIEW: if override + hallucination_suspected — enqueue for AI-ops review
        if (hasHallucination) {
          await appendEvent(client, {
            topic: 'sim.ai.ops-review',
            schemaRef: 'sim.ai.ops-review/HallucinationFlagged/v1',
            tenantId,
            payload: { event_type: 'HallucinationFlagged', analysis_id: id, reason: 'hallucination_suspected', flagged_by: tenantId },
            correlationId: id,
          });
        }
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
