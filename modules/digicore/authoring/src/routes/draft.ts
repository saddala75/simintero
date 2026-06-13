import { Router } from 'express';
import type { Request, Response } from 'express';
import { DraftArtifactCreator } from '../vkas/DraftArtifactCreator.js';
import type { DraftArtifactInput } from '../vkas/DraftArtifactCreator.js';

export function createDraftRouter(creator: DraftArtifactCreator): Router {
  const router = Router();

  router.post('/v1/authoring/draft', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;

    if (typeof body['canonical_url'] !== 'string' || body['canonical_url'].trim() === '') {
      res.status(400).json({ error: 'canonical_url is required and must be a string' });
      return;
    }

    if (body['artifact_type'] !== 'cql_library') {
      res.status(400).json({ error: 'artifact_type must be cql_library' });
      return;
    }

    const content = body['content'];
    if (typeof content !== 'object' || content === null) {
      res.status(400).json({ error: 'content is required and must be an object' });
      return;
    }

    const input: DraftArtifactInput = {
      artifact_type: 'cql_library',
      canonical_url: body['canonical_url'],
      content: content as DraftArtifactInput['content'],
      metadata: (typeof body['metadata'] === 'object' && body['metadata'] !== null
        ? body['metadata']
        : {}) as Record<string, unknown>,
    };

    try {
      const result = await creator.createDraft(input);
      res.status(201).json(result);
    } catch {
      res.status(500).json({ error: 'Failed to create draft artifact' });
    }
  });

  return router;
}
