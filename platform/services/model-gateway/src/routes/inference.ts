import { Router } from 'express';
import type { InferenceDispatcher } from '../gateway/InferenceDispatcher.js';

export function createInferenceRouter(dispatcher: InferenceDispatcher): Router {
  const router = Router();

  router.post('/inference', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string;
    const cellBoundary = (req.headers['x-sim-cell-boundary'] ?? 'pooled') as
      'pooled' | 'dedicated' | 'enclave';

    try {
      const result = await dispatcher.dispatch({
        ...req.body,
        tenant_ctx: { tenant_id: tenantId, cell_boundary: cellBoundary },
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { code?: string; status?: number; message: string };
      res.status(e.status ?? 500).json({
        type: `https://errors.simintero.io/${e.code ?? 'SIM-MG-INTERNAL'}`,
        code: e.code ?? 'SIM-MG-INTERNAL',
        detail: e.message,
      });
    }
  });

  return router;
}
