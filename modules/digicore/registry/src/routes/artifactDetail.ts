import { Router } from 'express';
import type { Request, Response } from 'express';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';

export function createArtifactDetailRouter(db: TenantDb): Router {
  const router = Router();

  router.get(
    '/:canonical/:version',
    async (req: Request, res: Response) => {
      // Ensure a valid tenant context exists (RLS is set inside transaction)
      ctx();

      const params = req.params as { canonical: string; version: string };
      const { canonical, version } = params;

      try {
        const rows = await db.transaction(async (client) => {
          const result = await client.query(
            `SELECT cache_key, canonical_url, version, artifact_type, tenant_id,
                    resolved_at, content_ref
               FROM dig.artifact_cache
              WHERE canonical_url = $1
                AND version = $2`,
            [canonical, version]
          );
          return result.rows;
        });

        const artifact = rows[0];
        if (artifact === undefined) {
          res.status(404).json({
            error: 'Artifact not found in cache',
            detail: 'Phase 1: VKAS fallback not implemented',
          });
          return;
        }

        res.json(artifact);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[registry] artifact detail failed', { message });
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  return router;
}
