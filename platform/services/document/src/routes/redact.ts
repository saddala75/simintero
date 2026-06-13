import { Router } from 'express';

export function createRedactRouter(): Router {
  const router = Router();
  router.post('/documents/:docId/redact', (_req, res) => {
    res.status(501).json({
      type: 'https://errors.simintero.io/SIM-PLAT-DOC-NOT_IMPLEMENTED',
      code: 'SIM-PLAT-DOC-NOT_IMPLEMENTED',
      detail: 'Redaction views are available in Phase 3',
    });
  });
  return router;
}
