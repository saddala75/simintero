import { Router } from 'express';
import type { Request, Response } from 'express';
import type { GovernanceStore } from '../store/GovernanceStore.js';
import type { AuthedRequest } from '../middleware/requireAuth.js';

export interface EnqueueInput {
  artifact_id: string;
  created_by: string;
  cql_library_url?: string;
  version?: string;
}

/**
 * Core enqueue handler — registers a submitted rule for approval. Accepts an
 * injected store so it can be unit-tested without an HTTP server.
 *
 * Idempotent: if the artifact is already in the store, the existing entry
 * (including any recorded approvals) is left untouched.
 */
export async function handleEnqueue(
  input: EnqueueInput,
  store: GovernanceStore,
): Promise<{ status: number; body: unknown }> {
  if (typeof input.artifact_id !== 'string' || input.artifact_id.length === 0) {
    return { status: 400, body: { error: 'artifact_id is required' } };
  }
  if (typeof input.created_by !== 'string' || input.created_by.length === 0) {
    return { status: 400, body: { error: 'created_by is required' } };
  }

  const submitInput: {
    artifactId: string;
    createdBy: string;
    cqlLibraryUrl?: string;
    version?: string;
  } = {
    artifactId: input.artifact_id,
    createdBy: input.created_by,
  };
  if (input.cql_library_url !== undefined) {
    submitInput.cqlLibraryUrl = input.cql_library_url;
  }
  if (input.version !== undefined) {
    submitInput.version = input.version;
  }
  await store.submit(submitInput);

  return { status: 201, body: { queued: true, artifact_id: input.artifact_id } };
}

export function createEnqueueRouter(store: GovernanceStore): Router {
  const router = Router();

  router.post('/v1/governance/queue/submit', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;

    // created_by comes from the verified JWT sub claim, never from the request body.
    const input: EnqueueInput = {
      artifact_id: typeof body['artifact_id'] === 'string' ? body['artifact_id'] : '',
      created_by: (req as AuthedRequest).user.sub,
    };
    if (typeof body['cql_library_url'] === 'string') {
      input.cql_library_url = body['cql_library_url'];
    }
    if (typeof body['version'] === 'string') {
      input.version = body['version'];
    }

    const result = await handleEnqueue(input, store);
    res.status(result.status).json(result.body);
  });

  return router;
}
