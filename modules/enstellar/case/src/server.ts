/**
 * enstellar-case HTTP server
 *
 * Exposes internal REST routes used by sibling services (e.g. enstellar-workflow).
 * Not customer-facing; tenant context is derived from the x-sim-tenant-id header
 * (or the SIM_SYSTEM_TENANT_ID env var for service-to-service calls that omit the header).
 *
 * Default port: 8091 (overridable via PORT env var).
 */

import { createHash } from 'node:crypto';
import express from 'express';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { appendPin } from './commands/AppendPin.js';
import { withTenantContext } from '@sim/tenant-context-ts';
import type { TenantContext } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';

const app: ReturnType<typeof express> = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Dependency injection (set before calling app.listen)
// ---------------------------------------------------------------------------

let tenantDb: TenantDb | null = null;
let standalonePool: Pool | null = null;

export function setDb(db: TenantDb): void {
  tenantDb = db;
}

/** Returns a pg PoolClient — uses TenantDb's pool when injected, otherwise a standalone pool. */
function getClient(): Promise<PoolClient> {
  if (tenantDb) {
    return (tenantDb as unknown as { pool: Pool }).pool.connect();
  }
  if (!standalonePool) {
    standalonePool = new Pool({
      connectionString: process.env['DATABASE_URL'] ?? 'postgres://sim:sim@localhost:5432/simintero',
    });
  }
  return standalonePool.connect();
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

/**
 * Maps a case label (e.g. "case_exit_test_01") to a deterministic UUID.
 * If the input is already a UUID it is returned unchanged.
 */
function labelToUuid(id: string): string {
  if (/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return id;
  const h = createHash('md5').update(`sim:case:${id}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
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

/**
 * POST /v1/cases/:id/events
 *
 * Upserts a case row and appends an event to ens.case_event, then writes an
 * outbox entry for downstream consumers.
 *
 * Body: { type?: string; payload?: Record<string, unknown> }
 * 202: { case_ref: string; seq: number; status: 'created' }
 * 500: internal error
 */
app.post('/v1/cases/:id/events', async (req: Request, res: Response) => {
  const caseId = labelToUuid(req.params['id'] as string);
  const tenantId = resolveTenantId(req);
  const body = req.body as { type?: string; payload?: Record<string, unknown> };
  const eventType = body.type ?? 'CaseCreated';
  const payload = body.payload ?? {};

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tenantId]);

    // Upsert the case
    await client.query(
      `INSERT INTO ens.case (case_id, tenant_id, lob, state, urgency, channel)
       VALUES ($1, $2, $3, 'intake', $4, $5)
       ON CONFLICT (case_id) DO NOTHING`,
      [caseId, tenantId, payload['lob'] ?? 'MA', payload['urgency'] ?? 'standard', payload['channel'] ?? 'PAS'],
    );

    // Get next seq
    const seqResult = await client.query(
      `SELECT MAX(seq) AS max_seq FROM ens.case_event WHERE case_id = $1`,
      [caseId],
    ) as { rows: Array<{ max_seq: number | null }> };
    const seq = (seqResult.rows[0]?.max_seq ?? 0) + 1;

    // Insert event
    await client.query(
      `INSERT INTO ens.case_event (case_id, seq, tenant_id, event_type, payload, trace_ref, actor)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (case_id, seq) DO NOTHING`,
      [
        caseId, seq, tenantId, eventType,
        JSON.stringify(payload),
        'sim.case.created/v1',
        JSON.stringify({ type: 'human', role: 'um_nurse_reviewer', schema_ref: 'sim.case.created/v1' }),
      ],
    );

    // Write to outbox
    await client.query(
      `INSERT INTO shared.outbox (tenant_id, topic, event_id, key, envelope)
       VALUES ($1, 'sim.case.lifecycle', $2, $3, $4)`,
      [
        tenantId,
        `${tenantId}:${caseId}:${seq}`,
        `${tenantId}:${caseId}`,
        JSON.stringify({ event_type: eventType, case_ref: caseId, seq, payload }),
      ],
    );

    await client.query('COMMIT');
    res.status(202).json({ case_ref: caseId, seq, status: 'created' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[enstellar-case] POST /v1/cases/:id/events failed', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * POST /v1/cases/:id/replay
 *
 * Replays all events for a case and returns the folded state.
 *
 * 200: { case_ref: string; status: 'replayed'; payload: Record<string, unknown> }
 * 500: internal error
 */
app.post('/v1/cases/:id/replay', async (req: Request, res: Response) => {
  const caseId = labelToUuid(req.params['id'] as string);
  const tenantId = resolveTenantId(req);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tenantId]);

    const eventsResult = await client.query(
      `SELECT event_type, payload, seq FROM ens.case_event WHERE case_id = $1 AND tenant_id = $2 ORDER BY seq ASC`,
      [caseId, tenantId],
    ) as { rows: Array<{ event_type: string; payload: Record<string, unknown>; seq: number }> };
    const events = eventsResult.rows;

    await client.query('ROLLBACK');

    // Fold events into a state object
    const state: Record<string, unknown> = { case_id: caseId, tenant_id: tenantId };
    for (const evt of events) {
      const p = typeof evt.payload === 'string' ? JSON.parse(evt.payload as string) as Record<string, unknown> : evt.payload;
      Object.assign(state, p);
    }
    state['_event_count'] = events.length;

    res.status(200).json({ case_ref: caseId, status: 'replayed', payload: state });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[enstellar-case] POST /v1/cases/:id/replay failed', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * GET /v1/cases/:id
 *
 * Fetches a case row and replays its events into a folded payload.
 *
 * 200: { case_ref: string; case: Record<string, unknown>; payload: Record<string, unknown> }
 * 404: case not found
 * 500: internal error
 */
app.get('/v1/cases/:id', async (req: Request, res: Response) => {
  const caseId = labelToUuid(req.params['id'] as string);
  const tenantId = resolveTenantId(req);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tenantId]);

    const caseResult = await client.query(
      `SELECT * FROM ens.case WHERE case_id = $1 AND tenant_id = $2 LIMIT 1`,
      [caseId, tenantId],
    ) as { rows: Array<Record<string, unknown>> };
    const caseRows = caseResult.rows;

    if (caseRows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    const eventsResult = await client.query(
      `SELECT event_type, payload FROM ens.case_event WHERE case_id = $1 AND tenant_id = $2 ORDER BY seq ASC`,
      [caseId, tenantId],
    ) as { rows: Array<{ event_type: string; payload: Record<string, unknown> }> };
    const events = eventsResult.rows;

    await client.query('ROLLBACK');

    const payload: Record<string, unknown> = { case_id: caseId, tenant_id: tenantId };
    for (const evt of events) {
      const p = typeof evt.payload === 'string' ? JSON.parse(evt.payload as string) as Record<string, unknown> : evt.payload;
      Object.assign(payload, p);
    }

    res.status(200).json({ case_ref: caseId, case: caseRows[0], payload });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[enstellar-case] GET /v1/cases/:id failed', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
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
