import { Router } from 'express';
import type { Pool } from 'pg';
import type { KillSwitchChecker } from '../kill-switch/KillSwitchChecker.js';

export function createKillSwitchRouter(pool: Pool, checker: KillSwitchChecker): Router {
  const router = Router();

  router.post('/tenants/:id/kill-switch', async (req, res) => {
    const { id } = req.params;
    const { workflow } = req.body as { workflow?: string };
    const key = workflow ? `ai.workflow.${workflow}.disabled` : 'ai.inference.disabled';
    await pool.query(
      `INSERT INTO ctrl.entitlement (tenant_id, key, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [id, key, JSON.stringify({ value: true })],
    );
    checker.invalidate(id);
    res.status(204).send();
  });

  router.delete('/tenants/:id/kill-switch', async (req, res) => {
    const { id } = req.params;
    const workflow = req.query['workflow'] as string | undefined;
    const key = workflow ? `ai.workflow.${workflow}.disabled` : 'ai.inference.disabled';
    await pool.query(
      `DELETE FROM ctrl.entitlement WHERE tenant_id = $1 AND key = $2`,
      [id, key],
    );
    checker.invalidate(id);
    res.status(204).send();
  });

  return router;
}
