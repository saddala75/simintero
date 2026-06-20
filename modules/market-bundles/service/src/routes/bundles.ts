import express from 'express';
import type { Pool } from 'pg';
import { ulid } from 'ulid';
import { appendEvent } from '@sim/outbox-ts/append';
import { withTenant } from '../db/withTenant.js';

export function buildBundlesRouter(pool: Pool): express.Router {
  const router = express.Router();
  router.use(express.json());

  // GET /v1/bundles/:bundleRef
  router.get('/:bundleRef', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ error: 'Missing x-sim-tenant-id header' });

    const { bundleRef } = req.params;

    const bundleResult = await pool.query<{
      bundle_id: string;
      bundle_ref: string;
      lob: string;
      name: string;
      status: string;
      version: number;
      created_at: string;
    }>(
      `SELECT bundle_id, bundle_ref, lob, name, status, version, created_at
       FROM market.bundle WHERE tenant_id = $1 AND bundle_ref = $2`,
      [tenantId, bundleRef],
    );

    if (bundleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bundle not found' });
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const bundle = bundleResult.rows[0]!;
    const artifactsResult = await pool.query<{ artifact_id: string; artifact_role: string }>(
      `SELECT ba.artifact_id, ba.artifact_role
       FROM market.bundle_artifact ba
       WHERE ba.bundle_id = $1 AND ba.tenant_id = $2`,
      [bundle.bundle_id, tenantId],
    );

    return res.status(200).json({
      bundle_id: bundle.bundle_id,
      bundle_ref: bundle.bundle_ref,
      lob: bundle.lob,
      name: bundle.name,
      status: bundle.status,
      version: bundle.version,
      created_at: bundle.created_at,
      artifacts: artifactsResult.rows,
    });
  });

  // POST /v1/bundles/:bundleRef/provision
  router.post('/:bundleRef/provision', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ error: 'Missing x-sim-tenant-id header' });

    const { bundleRef } = req.params;
    const { artifact_refs } = req.body as { artifact_refs?: Array<{ role: string; ref: string }> };

    if (!artifact_refs || !Array.isArray(artifact_refs) || artifact_refs.length === 0) {
      return res.status(400).json({ error: 'artifact_refs must be a non-empty array' });
    }

    // Check if bundle already exists
    const existing = await pool.query(
      `SELECT bundle_id FROM market.bundle WHERE tenant_id = $1 AND bundle_ref = $2`,
      [tenantId, bundleRef],
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Bundle already provisioned', bundle_ref: bundleRef });
    }

    const bundleId = ulid();
    // HUMAN_REVIEW: status is always 'draft' on provisioning — clinical review required to activate
    await pool.query(
      `INSERT INTO market.bundle (bundle_id, tenant_id, bundle_ref, lob, name, status, version)
       VALUES ($1, $2, $3, 'MA', $4, 'draft', 1)`,
      [bundleId, tenantId, bundleRef, `MA Bundle: ${bundleRef}`],
    );

    for (const art of artifact_refs) {
      // Resolve artifact_id from vkas.artifact by ref key
      const artResult = await pool.query<{ artifact_id: string }>(
        `SELECT artifact_id FROM vkas.artifact WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
        [tenantId, art.ref],
      );
      if (artResult.rows.length === 0) continue; // skip missing artifacts — VKAS may not have them yet

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await pool.query(
        `INSERT INTO market.bundle_artifact (bundle_id, artifact_id, tenant_id, artifact_role)
         VALUES ($1, $2, $3, $4)`,
        [bundleId, artResult.rows[0]!.artifact_id, tenantId, art.role],
      );
    }

    await withTenant(pool, tenantId, (client) =>
      appendEvent(client, {
        topic: 'sim.market.bundle.provisioned',
        schemaRef: 'sim.market.bundle/BundleProvisioned/v1',
        tenantId,
        payload: { event_type: 'BundleProvisioned', bundle_ref: bundleRef, bundle_id: bundleId, lob: 'MA', status: 'draft' },
        correlationId: bundleId,
      }),
    );

    return res.status(201).json({
      bundle_id: bundleId,
      bundle_ref: bundleRef,
      status: 'draft',
      lob: 'MA',
    });
  });

  return router;
}
