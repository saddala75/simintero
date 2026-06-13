import express from 'express';
import type { Application, Request, Response } from 'express';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgres://sim:sim@localhost:5432/simintero',
});

const app: Application = express();
app.use(express.json());

function resolveTenant(req: Request): string {
  const h = req.headers['x-sim-tenant-id'];
  return (typeof h === 'string' && h.length > 0) ? h : 'system';
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'market-bundles' });
});

/**
 * POST /v1/market/bundles
 * Body: { bundle_ref: string, lob: string, source?: string }
 * Response: 201 { status: "draft", bundle_ref, bundle_id, lob }
 *
 * SECURITY: Bundles are ALWAYS created with status='draft'.
 */
app.post('/v1/market/bundles', async (req: Request, res: Response) => {
  const tenantId = resolveTenant(req);
  const body = req.body as { bundle_ref?: string; lob?: string; source?: string };

  if (!body.bundle_ref || !body.lob) {
    res.status(400).json({ error: 'bundle_ref and lob are required' });
    return;
  }

  const lob = body.lob;
  if (!['MA', 'Medicaid', 'Commercial'].includes(lob)) {
    res.status(400).json({ error: `Invalid lob: ${lob}` });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tenantId]);

    const { rows } = await client.query<{ bundle_id: string; status: string }>(
      `INSERT INTO market.bundle (tenant_id, bundle_ref, lob, source, status)
       VALUES ($1, $2, $3, $4, 'draft')
       ON CONFLICT (tenant_id, bundle_ref) DO UPDATE SET lob = $3, source = $4
       RETURNING bundle_id, status`,
      [tenantId, body.bundle_ref, lob, body.source ?? null],
    );

    await client.query('COMMIT');
    const created = rows[0];
    if (!created) {
      res.status(500).json({ error: 'Insert returned no rows' });
      return;
    }
    res.status(201).json({
      bundle_id: created.bundle_id,
      bundle_ref: body.bundle_ref,
      lob,
      status: created.status,
      tenant_id: tenantId,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[market-bundles] POST /v1/market/bundles failed', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * POST /v1/market/bundles/:bundleRef/activate
 * Body: { reviewer_id?: string }
 *
 * SECURITY: reviewer_id is REQUIRED. Bundle must not be activated without clinical review.
 */
app.post('/v1/market/bundles/:bundleRef/activate', async (req: Request, res: Response) => {
  const body = req.body as { reviewer_id?: string };

  if (!body.reviewer_id || String(body.reviewer_id).trim().length === 0) {
    res.status(422).json({
      error: 'reviewer_id_required',
      message: 'Bundle activation requires a human reviewer_id for audit and compliance',
    });
    return;
  }

  // Even with a reviewer_id, we only mark as active if the reviewer is authorized.
  // In this stub, we accept the reviewer_id and proceed.
  const tenantId = resolveTenant(req);
  const bundleRef = req.params['bundleRef'] as string;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tenantId]);
    const { rows } = await client.query<{ bundle_id: string }>(
      `UPDATE market.bundle SET status = 'active' WHERE tenant_id = $1 AND bundle_ref = $2
       RETURNING bundle_id`,
      [tenantId, bundleRef],
    );
    await client.query('COMMIT');
    if (rows.length === 0) {
      res.status(404).json({ error: 'Bundle not found' });
      return;
    }
    res.status(200).json({ bundle_ref: bundleRef, status: 'active', reviewer_id: body.reviewer_id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[market-bundles] activate failed', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * GET /v1/market/bundles/:bundleRef
 * Returns bundle with artifacts.
 */
app.get('/v1/market/bundles/:bundleRef', async (req: Request, res: Response) => {
  const tenantId = resolveTenant(req);
  const bundleRef = req.params['bundleRef'] as string;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tenantId]);

    const { rows: bundleRows } = await client.query<Record<string, unknown>>(
      `SELECT * FROM market.bundle WHERE tenant_id = $1 AND bundle_ref = $2 LIMIT 1`,
      [tenantId, bundleRef],
    );

    if (bundleRows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Bundle not found' });
      return;
    }

    const { rows: artifactRows } = await client.query<{ artifact_ref: string; role: string }>(
      `SELECT artifact_ref, role FROM market.bundle_artifact WHERE tenant_id = $1 AND bundle_ref = $2`,
      [tenantId, bundleRef],
    );

    await client.query('ROLLBACK');

    res.status(200).json({
      ...bundleRows[0],
      artifacts: artifactRows,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[market-bundles] GET /v1/market/bundles/:bundleRef failed', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

const PORT = Number(process.env['PORT'] ?? 3018);
app.listen(PORT, () => {
  console.log(`[market-bundles] listening on :${PORT}`);
});

export default app;
