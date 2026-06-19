import crypto from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import type { PoolClient } from "pg";
import { resolveEffectiveVersion, type ArtifactRow } from "./resolve.js";
import { transitionStatus, StatusTransitionError, type ArtifactStatus } from "./lifecycle.js";
import { evaluateBlastRadius, applyPromotion, type PromotionSet } from "./promotions.js";
import { withTenant } from "./db/withTenant.js";

function tenantOf(req: Request): string {
  return (req.header('x-sim-tenant-id') ?? '').trim();
}

async function currentStatus(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: { status: string }[] }> },
  url: string,
  version: string,
): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT status FROM vkas.artifact WHERE canonical_url=$1 AND version=$2`, [url, version]);
  return rows[0]?.status ?? null;
}

export function createVkasRouter(): Router {
  const router = Router();

  // POST /v1/artifacts — create draft artifact
  router.post("/v1/artifacts", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as Record<string, unknown>;
      if (!b['canonical_url'] || !b['artifact_type'] || b['content'] === undefined) {
        res.status(400).json({ error: 'canonical_url, artifact_type, content are required' });
        return;
      }
      const canonical_url = b['canonical_url'] as string;
      const version = (b['version'] as string) ?? '1.0.0';
      const tenant_id = (b['tenant_id'] as string) ?? 'shared';
      const created_by = (b['created_by'] as string) ?? 'authoring';
      const content_hash = 'sha256:' + crypto.createHash('sha256')
        .update(JSON.stringify(b['content'])).digest('hex');
      const pool = req.app.locals['pool'];
      const { rowCount } = await withTenant(pool, tenantOf(req), (client: PoolClient) => client.query(
        `INSERT INTO vkas.artifact
           (canonical_url, version, tenant_id, artifact_type, status, content, content_hash, applicability, metadata, created_by)
         VALUES ($1,$2,$3,$4,'draft',$5::jsonb,$6,$7::jsonb,$8::jsonb,$9)
         ON CONFLICT (canonical_url, version) DO NOTHING`,
        [canonical_url, version, tenant_id, b['artifact_type'], JSON.stringify(b['content']), content_hash,
          JSON.stringify(b['applicability'] ?? {}), JSON.stringify(b['metadata'] ?? {}), created_by],
      ));
      if (rowCount === 0) {
        res.status(409).json({ error: `artifact ${canonical_url}@${version} already exists` });
        return;
      }
      res.status(201).json({ artifact_id: canonical_url, canonical_url, version, status: 'draft' });
    } catch (err) {
      next(err);
    }
  });

  // Express route for Google custom-method pattern GET /v1/artifacts:resolve
  // The regex ensures ':resolve' is matched literally, not as a param capture.
  router.get(/^\/v1\/artifacts:resolve$/, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { canonical_url, version, lob, region, program, product } = req.query as Record<string, string>;
      if (!canonical_url) {
        res.status(400).json({ error: 'canonical_url is required' });
        return;
      }
      const pool = req.app.locals['pool'];
      const { rows } = await withTenant(pool, tenantOf(req), (client: PoolClient) => client.query(
        `SELECT canonical_url, version, tenant_id, artifact_type, status,
                effective_from, effective_to, applicability, content, content_hash,
                relations, metadata, created_by, created_at
         FROM vkas.artifact
         WHERE canonical_url = $1`,
        [canonical_url],
      ));
      const candidates: ArtifactRow[] = rows.map((r: Record<string, unknown>) => ({
        ...r,
        effective_from: r['effective_from'] ? new Date(r['effective_from'] as string) : null,
        effective_to: r['effective_to'] ? new Date(r['effective_to'] as string) : null,
      })) as ArtifactRow[];

      let chosen: ArtifactRow | null;
      if (version) {
        chosen = candidates.find((a) => a.version === version && a.status === 'active') ?? null;
      } else {
        const ctx: { lob?: string; region?: string; program?: string; product?: string } = {};
        if (lob) ctx.lob = lob;
        if (region) ctx.region = region;
        if (program) ctx.program = program;
        if (product) ctx.product = product;
        chosen = resolveEffectiveVersion(candidates, { asOf: new Date(), ctx });
      }
      if (!chosen) {
        res.status(404).json({ error: `No active artifact for ${canonical_url}${version ? `@${version}` : ''}` });
        return;
      }
      res.json({ status: chosen.status, content: chosen.content });
    } catch (err) {
      next(err);
    }
  });

  // POST /v1/artifacts/submit — body-based lifecycle transition (draft → in_review)
  router.post('/v1/artifacts/submit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { canonical_url, version } = req.body as { canonical_url: string; version: string };
      const pool = req.app.locals['pool'];
      const result = await withTenant(pool, tenantOf(req), async (client: PoolClient) => {
        const cur = await currentStatus(client, canonical_url, version);
        if (!cur) { return { notFound: true } as const; }
        transitionStatus(cur as ArtifactStatus, 'in_review');
        await client.query(
          `UPDATE vkas.artifact SET status='in_review' WHERE canonical_url=$1 AND version=$2`,
          [canonical_url, version]);
        return { notFound: false } as const;
      });
      if (result.notFound) { res.status(404).json({ error: 'artifact not found' }); return; }
      res.status(200).json({ canonical_url, version, status: 'in_review' });
    } catch (err) {
      if (err instanceof StatusTransitionError) { res.status(422).json({ error: err.message }); return; }
      next(err);
    }
  });

  // POST /v1/artifacts/activate — body-based lifecycle transition (folds in_review → approved → active)
  router.post('/v1/artifacts/activate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { canonical_url, version } = req.body as { canonical_url: string; version: string };
      const pool = req.app.locals['pool'];
      const result = await withTenant(pool, tenantOf(req), async (client: PoolClient) => {
        const cur = await currentStatus(client, canonical_url, version);
        if (!cur) { return { notFound: true } as const; }
        let s: ArtifactStatus = cur as ArtifactStatus;
        if (s === 'in_review') { transitionStatus(s, 'approved'); s = 'approved'; }
        transitionStatus(s, 'active');
        await client.query(
          `UPDATE vkas.artifact SET status='active', effective_from=CURRENT_DATE WHERE canonical_url=$1 AND version=$2`,
          [canonical_url, version]);
        return { notFound: false } as const;
      });
      if (result.notFound) { res.status(404).json({ error: 'artifact not found' }); return; }
      res.status(200).json({ canonical_url, version, status: 'active' });
    } catch (err) {
      if (err instanceof StatusTransitionError) { res.status(422).json({ error: err.message }); return; }
      next(err);
    }
  });

  // POST /v1/promotions — promote artifacts through blast-radius gate
  router.post('/v1/promotions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const set = req.body as PromotionSet;
      const pool = req.app.locals['pool'];

      const blastResult = await evaluateBlastRadius(set, pool);
      if (!blastResult.passed) {
        res.status(422).json({
          type: 'https://errors.simintero.io/SIM-VKAS-BLAST_RADIUS',
          code: 'SIM-VKAS-BLAST_RADIUS',
          detail: 'Promotion blocked by blast-radius gate',
          items: blastResult.items.filter(i => !i.passed),
        });
        return;
      }

      const diff = await applyPromotion(set, pool);
      res.status(201).json({ status: 'promoted', diff });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
