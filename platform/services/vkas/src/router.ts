import crypto from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import type { PoolClient } from "pg";
import { resolveEffectiveVersion, type ArtifactRow } from "./resolve.js";
import { transitionStatus, StatusTransitionError, type ArtifactStatus } from "./lifecycle.js";
import { evaluateBlastRadius, applyPromotion, type PromotionSet } from "./promotions.js";
import { withTenant } from "./db/withTenant.js";
import { rollbackArtifact } from "./rollback.js";
import { recordApproval } from "./approvals.js";

function tenantOf(req: Request): string {
  return (req.header('x-sim-tenant-id') ?? '').trim();
}

async function currentStatus(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: { status: string; artifact_type: string }[] }> },
  url: string,
  version: string,
): Promise<{ status: string; artifact_type: string } | null> {
  const { rows } = await client.query(
    `SELECT status, artifact_type FROM vkas.artifact WHERE canonical_url=$1 AND version=$2`, [url, version]);
  if (!rows[0]) return null;
  return { status: rows[0].status, artifact_type: rows[0].artifact_type };
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
        transitionStatus(cur.status as ArtifactStatus, 'in_review');
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
        let s: ArtifactStatus = cur.status as ArtifactStatus;
        const artifactType = cur.artifact_type;

        // Eval gate: model_binding and prompt artifacts require a passing gate='eval' approval.
        if (artifactType === 'model_binding' || artifactType === 'prompt') {
          const ev = await client.query(
            `SELECT decided FROM vkas.approval WHERE canonical_url=$1 AND version=$2 AND gate='eval'`,
            [canonical_url, version]);
          if (ev.rows.length === 0 || ev.rows[0].decided !== 'approved') {
            return { evalRequired: true } as const;
          }
        }

        if (s === 'in_review') { transitionStatus(s, 'approved'); s = 'approved'; }
        transitionStatus(s, 'active');
        // Demote any currently-active version (≠ target) to superseded so the
        // rollback handler can restore it.  Touches only status — the V019
        // immutability trigger does not fire on status-only updates.
        await client.query(
          `UPDATE vkas.artifact SET status='superseded'
           WHERE canonical_url=$1 AND status='active' AND version <> $2`,
          [canonical_url, version]);
        await client.query(
          `UPDATE vkas.artifact SET status='active', effective_from=CURRENT_DATE WHERE canonical_url=$1 AND version=$2`,
          [canonical_url, version]);
        return { notFound: false } as const;
      });
      if (result.notFound) { res.status(404).json({ error: 'artifact not found' }); return; }
      if (result.evalRequired) {
        res.status(409).json({ error: 'a passing eval approval is required to activate this artifact', code: 'SIM-VKAS-EVAL_REQUIRED' });
        return;
      }
      res.status(200).json({ canonical_url, version, status: 'active' });
    } catch (err) {
      if (err instanceof StatusTransitionError) { res.status(422).json({ error: err.message }); return; }
      next(err);
    }
  });

  // POST /v1/artifacts/:canonical_url/:version/rollback — OpenAPI rollback endpoint
  // The canonical_url param is percent-encoded in the path (it contains slashes);
  // we decode it before passing to rollbackArtifact so all DB queries use the real URL.
  router.post('/v1/artifacts/:canonical_url/:version/rollback', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const canonicalUrl = decodeURIComponent(req.params['canonical_url'] as string);
      const version = req.params['version'] as string;
      const { reason, incident_ref } = (req.body ?? {}) as { reason?: string; incident_ref?: string | null };
      if (!reason || typeof reason !== 'string') {
        res.status(400).json({ error: 'reason is required' });
        return;
      }
      const pool = req.app.locals['pool'];
      const tenant = tenantOf(req);
      const result = await withTenant(pool, tenant, (client: PoolClient) =>
        rollbackArtifact(client, { canonicalUrl, version, reason, incidentRef: incident_ref ?? null, tenantId: tenant }));
      switch (result.status) {
        case 'not_found':  res.status(404).json({ error: 'artifact not found' }); return;
        case 'not_active': res.status(409).json({ error: 'artifact is not in active status' }); return;
        case 'no_prior':   res.status(409).json({ error: 'no prior version to restore' }); return;
        case 'ok':         res.status(200).json({ rolled_back: result.rolledBack, restored: result.restored }); return;
      }
    } catch (err) {
      if (err instanceof StatusTransitionError) { res.status(409).json({ error: (err as Error).message }); return; }
      next(err);
    }
  });

  // POST /v1/approvals — record a gate approval (clinical/compliance/eval/impact)
  // Writes (or upserts) a vkas.approval row; the eval gate consumer is the eval-runner.
  router.post('/v1/approvals', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as Record<string, unknown>;
      const { canonical_url, version, gate, approver, decided, rationale, attestation } = b;

      // Required field validation
      if (!canonical_url || typeof canonical_url !== 'string') {
        res.status(400).json({ error: 'canonical_url is required' });
        return;
      }
      if (!version || typeof version !== 'string') {
        res.status(400).json({ error: 'version is required' });
        return;
      }
      if (!approver || typeof approver !== 'string') {
        res.status(400).json({ error: 'approver is required' });
        return;
      }

      // Enum validation
      const VALID_GATES = new Set(['clinical', 'compliance', 'eval', 'impact']);
      if (!gate || !VALID_GATES.has(gate as string)) {
        res.status(400).json({ error: `gate must be one of: ${[...VALID_GATES].join(', ')}` });
        return;
      }
      const VALID_DECIDED = new Set(['approved', 'rejected']);
      if (!decided || !VALID_DECIDED.has(decided as string)) {
        res.status(400).json({ error: `decided must be one of: ${[...VALID_DECIDED].join(', ')}` });
        return;
      }

      const pool = req.app.locals['pool'];
      await withTenant(pool, tenantOf(req), (client: PoolClient) =>
        recordApproval(client, {
          canonicalUrl: canonical_url,
          version: version as string,
          gate: gate as string,
          approver: approver as string,
          decided: decided as string,
          rationale: (rationale as string | null | undefined) ?? null,
          attestation: (attestation as Record<string, unknown> | null | undefined) ?? null,
        }),
      );

      res.status(201).json({ canonical_url, version, gate, decided });
    } catch (err) {
      next(err);
    }
  });

  // POST /v1/promotions — promote artifacts through blast-radius gate
  router.post('/v1/promotions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const set = req.body as PromotionSet;
      const pool = req.app.locals['pool'];

      // Run blast-radius eval + apply in one transaction with the sim.tenant_id
      // GUC set, so the FORCE-RLS vkas.artifact reads/writes target the right tenant.
      const result = await withTenant(pool, tenantOf(req), async (client: PoolClient) => {
        const blastResult = await evaluateBlastRadius(set, client);
        if (!blastResult.passed) {
          return { blocked: true, blastResult } as const;
        }
        const diff = await applyPromotion(set, client);
        return { blocked: false, diff } as const;
      });

      if (result.blocked) {
        res.status(422).json({
          type: 'https://errors.simintero.io/SIM-VKAS-BLAST_RADIUS',
          code: 'SIM-VKAS-BLAST_RADIUS',
          detail: 'Promotion blocked by blast-radius gate',
          items: result.blastResult.items.filter(i => !i.passed),
        });
        return;
      }

      res.status(201).json({ status: 'promoted', diff: result.diff });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
