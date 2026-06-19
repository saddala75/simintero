import { Router, type Request, type Response } from 'express';

export function tenantOf(req: Request, res: Response): string | null {
  const t = req.headers['x-sim-tenant-id'] as string | undefined;
  if (!t) {
    res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
    return null;
  }
  return t;
}

export function createTaskRouter(): Router {
  const router = Router();
  // routes added in later tasks
  return router;
}
