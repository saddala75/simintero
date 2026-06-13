/**
 * enstellar-case HTTP server
 *
 * Exposes internal REST routes used by sibling services (e.g. enstellar-workflow).
 * Not customer-facing; tenant context is derived from the x-sim-tenant-id header
 * (or the SIM_SYSTEM_TENANT_ID env var for service-to-service calls that omit the header).
 *
 * Default port: 8091 (overridable via PORT env var).
 */

import express from 'express';
import type { Request, Response } from 'express';
import { appendPin } from './commands/AppendPin.js';
import { withTenantContext } from '@sim/tenant-context-ts';
import type { TenantContext } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Dependency injection (set before calling app.listen)
// ---------------------------------------------------------------------------

let tenantDb: TenantDb | null = null;

export function setDb(db: TenantDb): void {
  tenantDb = db;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PinItem {
  canonical_url: string;
  version: string;
}

/**
 * Builds a minimal service TenantContext for internal service-to-service calls.
 * In Phase 3 this will be replaced by full JWT-verified context.
 */
function buildServiceContext(tenantId: string): TenantContext {
  return {
    tenant_id: tenantId,
    cell_id: process.env['SIM_CELL_ID'] ?? 'cell-pooled-us1',
    tier: 'pooled' as const,
    scopes: { lob: [], region: [], modules: ['ENS'] },
    roles: [],
    principal_type: 'service' as const,
  };
}

/** Resolves the tenant ID for the request: header → env var → fallback. */
function resolveTenantId(req: Request): string {
  const header = req.headers['x-sim-tenant-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  return process.env['SIM_SYSTEM_TENANT_ID'] ?? 'system';
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'enstellar-case' });
});

/**
 * POST /v1/cases/:id/pins
 *
 * Appends artifact pins to ens.case_pin for the given case.
 * Called by enstellar-workflow after a successful C-1 runtime evaluate.
 *
 * Body: { pins: Array<{ canonical_url: string; version: string }> }
 * 200: { case_id: string; pins_added: number }
 * 400: pins field missing or not an array
 * 404: case not found (FK violation from DB)
 * 503: DB not initialised
 */
app.post('/v1/cases/:id/pins', async (req: Request, res: Response) => {
  if (!tenantDb) {
    res.status(503).json({ error: 'DB not initialised' });
    return;
  }

  const caseId = req.params['id'] as string;
  const body = req.body as { pins?: unknown };

  if (!Array.isArray(body.pins)) {
    res.status(400).json({ error: 'pins must be an array' });
    return;
  }

  const pins = body.pins as PinItem[];
  const tenantCtx = buildServiceContext(resolveTenantId(req));

  let pinsAdded = 0;

  try {
    await withTenantContext(tenantCtx, async () => {
      for (const pin of pins) {
        const result = await appendPin(tenantDb!, {
          caseId,
          canonicalUrl: pin.canonical_url,
          version: pin.version,
        });
        if (result.inserted) pinsAdded++;
      }
    });
  } catch (err: unknown) {
    // FK violation: case_id does not exist in ens.case
    const pgErr = err as { code?: string };
    if (pgErr.code === '23503') {
      res.status(404).json({ error: `Case not found: ${caseId}` });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[enstellar-case] POST /v1/cases/:id/pins failed', { caseId, message });
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  res.status(200).json({ case_id: caseId, pins_added: pinsAdded });
});

export default app;

// ---------------------------------------------------------------------------
// Standalone start when invoked directly
// ---------------------------------------------------------------------------

if (process.env['NODE_ENV'] !== 'test') {
  const port = Number(process.env['PORT'] ?? 8091);
  app.listen(port, () => {
    console.log(`[enstellar-case] listening on :${port}`);
  });
}
