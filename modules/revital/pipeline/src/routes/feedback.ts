import { Router } from 'express';
import type { Pool } from 'pg';

export function createFeedbackRouter(pool: Pool): Router {
  const router = Router();

  router.post('/v1/assist/analyses/:id/feedback', async (req, res, next) => {
    try {
      const { id } = req.params;
      const tenantId = req.headers['x-sim-tenant-id'] as string;
      const actor = { type: 'human', id: req.headers['x-sim-user-id'] as string ?? 'unknown' };

      await pool.query(
        `INSERT INTO revital.feedback (tenant_id, analysis_id, actor, items)
         VALUES (current_setting('sim.tenant_id', true), $1, $2, $3)`,
        [id, JSON.stringify(actor), JSON.stringify(req.body.items)],
      );

      // Emit FeedbackRecorded to outbox
      await pool.query(
        `INSERT INTO shared.outbox (tenant_id, topic, payload)
         VALUES (current_setting('sim.tenant_id', true), 'sim.ai.interaction', $1)`,
        [JSON.stringify({ event_type: 'FeedbackRecorded', analysis_id: id, actor, items_count: (req.body.items as unknown[]).length })],
      );

      // HUMAN_REVIEW: if override + hallucination_suspected — enqueue for AI-ops review
      const hasHallucination = ((req.body.items ?? []) as Array<{ action: string; reason_code?: string }>)
        .some(item => item.action === 'overridden' && item.reason_code === 'hallucination_suspected');
      if (hasHallucination) {
        await pool.query(
          `INSERT INTO shared.outbox (tenant_id, topic, payload)
           VALUES (current_setting('sim.tenant_id', true), 'sim.ai.ops-review', $1)`,
          [JSON.stringify({ analysis_id: id, reason: 'hallucination_suspected', flagged_by: tenantId })],
        );
      }

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
