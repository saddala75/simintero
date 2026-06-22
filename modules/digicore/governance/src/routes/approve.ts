import { Router } from 'express';
import type { Request, Response } from 'express';
import { GateEnforcer } from '../gates/GateEnforcer.js';
import type { GovernanceStore } from '../store/GovernanceStore.js';

export interface ApproveInput {
  artifact_id: string;
  gate: 'clinical' | 'compliance';
  decision: 'approved' | 'rejected';
  approver: string;
}

export interface ApproveSuccess {
  recorded: true;
  gate: 'clinical' | 'compliance';
  decision: 'approved' | 'rejected';
}

/**
 * Core approve handler — accepts injected dependencies so it can be unit-tested
 * without an HTTP server.
 */
export async function handleApprove(
  input: ApproveInput,
  store: GovernanceStore,
  enforcer: GateEnforcer,
): Promise<{ status: number; body: unknown }> {
  const state = await store.get(input.artifact_id);

  if (state === undefined) {
    return { status: 404, body: { error: 'Artifact not found' } };
  }

  // Enforce segregation of duties
  try {
    enforcer.checkSegregationOfDuties(input.approver, state.created_by);
  } catch (err) {
    const sodErr = err as { code: string; status: number };
    return {
      status: sodErr.status,
      body: { error: 'Segregation of duties violation', code: sodErr.code },
    };
  }

  // Block re-recording only when the gate was already approved (rejected gate may be re-submitted)
  const latestForGate = state.approvals.filter(a => a.gate === input.gate).at(-1);
  if (latestForGate?.decision === 'approved') {
    return {
      status: 409,
      body: { error: 'Gate already approved', gate: input.gate },
    };
  }

  // Record the approval (event emission is atomic inside the store)
  await store.recordApproval({
    artifactId: input.artifact_id,
    gate: input.gate,
    approver: input.approver,
    decision: input.decision,
    recordedAt: new Date().toISOString(),
  });

  const success: ApproveSuccess = {
    recorded: true,
    gate: input.gate,
    decision: input.decision,
  };
  return { status: 200, body: success };
}

export function createApproveRouter(
  store: GovernanceStore,
  enforcer: GateEnforcer,
): Router {
  const router = Router();

  router.post('/v1/governance/approve', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;

    if (
      typeof body['artifact_id'] !== 'string' ||
      (body['gate'] !== 'clinical' && body['gate'] !== 'compliance') ||
      (body['decision'] !== 'approved' && body['decision'] !== 'rejected') ||
      typeof body['approver'] !== 'string'
    ) {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    const input: ApproveInput = {
      artifact_id: body['artifact_id'],
      gate: body['gate'],
      decision: body['decision'],
      approver: body['approver'],
    };

    const result = await handleApprove(input, store, enforcer);
    res.status(result.status).json(result.body);
  });

  return router;
}
