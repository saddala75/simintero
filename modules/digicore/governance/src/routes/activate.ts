import { Router } from 'express';
import type { Request, Response } from 'express';
import { GateEnforcer } from '../gates/GateEnforcer.js';
import type { ArtifactApprovalState } from '../gates/GateEnforcer.js';
import { GovernanceNotifier } from '../notifications/GovernanceNotifier.js';

export interface VkasClient {
  activate(canonicalUrl: string, version: string): Promise<void>;
}

export interface ActivateInput {
  artifact_id: string;
}

/**
 * Core activate handler — accepts injected dependencies so it can be unit-tested
 * without an HTTP server.
 */
export async function handleActivate(
  input: ActivateInput,
  store: Map<string, ArtifactApprovalState>,
  enforcer: GateEnforcer,
  vkasClient: VkasClient,
  notifier: GovernanceNotifier,
): Promise<{ status: number; body: unknown }> {
  const state = store.get(input.artifact_id);

  if (state === undefined) {
    return { status: 404, body: { error: 'Artifact not found' } };
  }

  const activationCheck = enforcer.checkActivationReady(state);

  if (!activationCheck.ready) {
    return {
      status: 409,
      body: {
        error: 'Both gates must be approved before activation',
        missingGates: activationCheck.missingGates,
      },
    };
  }

  // A rule = a coverage_rule (artifact_id) + a cql_library (cql_library_url).
  // Both artifacts must transition to active. Activate the cql_library FIRST so
  // the rule's logic is live before its registry entry, then the coverage_rule.
  const version = state.version ?? '1.0.0';

  if (state.cql_library_url !== undefined && state.cql_library_url.length > 0) {
    await vkasClient.activate(state.cql_library_url, version);
  }
  await vkasClient.activate(input.artifact_id, version);

  await notifier.notifyActivation(input.artifact_id);

  return {
    status: 200,
    body: { activated: true, artifact_id: input.artifact_id },
  };
}

export function createActivateRouter(
  store: Map<string, ArtifactApprovalState>,
  enforcer: GateEnforcer,
  vkasClient: VkasClient,
  notifier: GovernanceNotifier,
): Router {
  const router = Router();

  router.post('/v1/governance/activate', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;

    if (typeof body['artifact_id'] !== 'string') {
      res.status(400).json({ error: 'artifact_id is required' });
      return;
    }

    const result = await handleActivate(
      { artifact_id: body['artifact_id'] },
      store,
      enforcer,
      vkasClient,
      notifier,
    );
    res.status(result.status).json(result.body);
  });

  return router;
}
