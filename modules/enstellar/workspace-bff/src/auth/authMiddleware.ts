import type { Request, Response, NextFunction } from 'express';
import { withTenantContext } from '@sim/tenant-context-ts';
import type { TenantContext } from '@sim/tenant-context-ts';

/**
 * Express middleware that reads the x-sim-ctx header (base64-encoded JSON of TenantContext)
 * and establishes the AsyncLocalStorage tenant context for the request lifecycle.
 */
export function simAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const simCtxHeader = req.headers['x-sim-ctx'];

  if (!simCtxHeader) {
    res.status(401).json({ error: 'Missing x-sim-ctx header' });
    return;
  }

  try {
    const raw = Buffer.from(String(simCtxHeader), 'base64').toString('utf-8');
    const tenantCtx = JSON.parse(raw) as TenantContext;
    void withTenantContext(tenantCtx, () => {
      next();
      return Promise.resolve();
    });
  } catch {
    res.status(401).json({ error: 'Invalid x-sim-ctx header' });
  }
}
