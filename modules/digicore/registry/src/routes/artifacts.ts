import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ArtifactSearchService } from '../search/ArtifactSearchService.js';

export function createArtifactsRouter(
  searchService: ArtifactSearchService
): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;

    try {
      const result = await searchService.search({
        artifact_type: q['artifact_type'],
        lob: q['lob'],
        service_category: q['service_category'],
        program: q['program'],
        product: q['product'],
      });
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[registry] artifact search failed', { message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
