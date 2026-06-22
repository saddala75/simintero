import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ArtifactApprovalState } from '../gates/GateEnforcer.js';
import type { GovernanceStore } from '../store/GovernanceStore.js';

export interface QueueResult {
  artifacts: ArtifactApprovalState[];
}

function getGateForRole(role: string): 'clinical' | 'compliance' | undefined {
  if (role === 'clinical_reviewer') return 'clinical';
  if (role === 'compliance_officer') return 'compliance';
  return undefined;
}

/**
 * Returns artifacts from the store where the given role's gate has not yet
 * been approved. If no role is specified, returns all artifacts.
 */
export async function handleQueue(
  role: string | undefined,
  store: GovernanceStore,
): Promise<{ status: number; body: QueueResult }> {
  const gate = role !== undefined ? getGateForRole(role) : undefined;

  const all = await store.list();
  const pending = all.filter(state => {
    if (gate === undefined) return true;
    const hasApprovedGate = state.approvals.some(
      a => a.gate === gate && a.decision === 'approved',
    );
    return !hasApprovedGate;
  });

  return { status: 200, body: { artifacts: pending } };
}

export function createQueueRouter(store: GovernanceStore): Router {
  const router = Router();

  router.get('/v1/governance/queue', async (req: Request, res: Response) => {
    const role =
      typeof req.query['role'] === 'string' ? req.query['role'] : undefined;
    const result = await handleQueue(role, store);
    res.status(result.status).json(result.body);
  });

  return router;
}
