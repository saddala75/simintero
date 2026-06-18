import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ArtifactApprovalState } from '../gates/GateEnforcer.js';

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
export function handleEnqueue(
  input: EnqueueInput,
  store: Map<string, ArtifactApprovalState>,
): { status: number; body: unknown } {
  if (typeof input.artifact_id !== 'string' || input.artifact_id.length === 0) {
    return { status: 400, body: { error: 'artifact_id is required' } };
  }
  if (typeof input.created_by !== 'string' || input.created_by.length === 0) {
    return { status: 400, body: { error: 'created_by is required' } };
  }

  if (!store.has(input.artifact_id)) {
    const state: ArtifactApprovalState = {
      artifact_id: input.artifact_id,
      created_by: input.created_by,
      approvals: [],
    };
    if (input.cql_library_url !== undefined) {
      state.cql_library_url = input.cql_library_url;
    }
    if (input.version !== undefined) {
      state.version = input.version;
    }
    store.set(input.artifact_id, state);
  }

  return { status: 201, body: { queued: true, artifact_id: input.artifact_id } };
}

export function createEnqueueRouter(
  store: Map<string, ArtifactApprovalState>,
): Router {
  const router = Router();

  router.post('/v1/governance/queue/submit', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;

    const input: EnqueueInput = {
      artifact_id: typeof body['artifact_id'] === 'string' ? body['artifact_id'] : '',
      created_by: typeof body['created_by'] === 'string' ? body['created_by'] : '',
    };
    if (typeof body['cql_library_url'] === 'string') {
      input.cql_library_url = body['cql_library_url'];
    }
    if (typeof body['version'] === 'string') {
      input.version = body['version'];
    }

    const result = handleEnqueue(input, store);
    res.status(result.status).json(result.body);
  });

  return router;
}
