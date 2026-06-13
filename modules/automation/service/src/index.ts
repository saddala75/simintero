import express from 'express';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const ADVERSE_OUTCOMES = new Set(['deny', 'partial_deny', 'modify']);
const AUTOMATION_MIN_CONFIDENCE = 0.85;

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgres://sim:sim@localhost:5432/simintero',
});

const app = express();
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'automation' });
});

/**
 * POST /v1/automation/disposition
 * Body: { case_ref: string, proposed_outcome: string, confidence: number, reasoning: string }
 *
 * SECURITY: adverse outcomes (deny/modify/partial_deny) are ALWAYS blocked.
 * ai.automation.live defaults to false — all allowed decisions run in dry_run mode.
 */
app.post('/v1/automation/disposition', async (req: Request, res: Response) => {
  const tenantId = (req.headers['x-sim-tenant-id'] as string | undefined) ?? 'system';
  const body = req.body as {
    case_ref?: string;
    proposed_outcome?: string;
    confidence?: number;
    reasoning?: string;
    analysis_id?: string;
  };

  const proposedOutcome = body.proposed_outcome ?? 'unknown';
  const caseRef = body.case_ref ?? 'unknown';
  const confidence = body.confidence ?? 0;
  const analysisId = body.analysis_id ?? 'e2e-test';

  const isAdverse = ADVERSE_OUTCOMES.has(proposedOutcome);
  const meetsConfidence = confidence >= AUTOMATION_MIN_CONFIDENCE;

  // All adverse outcomes are blocked regardless of confidence
  if (isAdverse) {
    // Write audit log (allow=false, dry_run=true for blocked decisions)
    await writeDispositionLog({
      tenantId,
      caseRef,
      analysisId,
      proposedOutcome,
      allow: false,
      denyReasons: ['ADVERSE_OUTCOME_BLOCKED'],
      dryRun: true,
    });
    res.status(422).json({
      error_code: 'SIM-AUTO-ADVERSE_BLOCKED',
      error: 'Adverse disposition outcomes require human review and cannot be automated',
    });
    return;
  }

  // Non-adverse but below confidence threshold
  if (!meetsConfidence) {
    await writeDispositionLog({
      tenantId,
      caseRef,
      analysisId,
      proposedOutcome,
      allow: false,
      denyReasons: ['CONFIDENCE_BELOW_THRESHOLD'],
      dryRun: true,
    });
    res.status(422).json({
      error_code: 'SIM-AUTO-LOW_CONFIDENCE',
      error: `Confidence ${confidence} below threshold ${AUTOMATION_MIN_CONFIDENCE}`,
    });
    return;
  }

  // OPA gate passes — but ai.automation.live defaults to false → dry_run
  // SECURITY: Never activate live mode without explicit entitlement check
  const isLive = await checkAutomationLive(tenantId);

  await writeDispositionLog({
    tenantId,
    caseRef,
    analysisId,
    proposedOutcome,
    allow: true,
    denyReasons: [],
    dryRun: !isLive,
  });

  if (!isLive) {
    res.status(200).json({
      status: 'dry_run',
      proposed_outcome: proposedOutcome,
      case_ref: caseRef,
      note: 'ai.automation.live is not enabled for this tenant',
    });
    return;
  }

  // Live mode: would update case state (not implemented in stub)
  res.status(200).json({
    status: 'applied',
    proposed_outcome: proposedOutcome,
    case_ref: caseRef,
  });
});

async function checkAutomationLive(tenantId: string): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      // ctrl.entitlement has no RLS — safe to query without GUC
      const { rows } = await client.query<{ value: string }>(
        `SELECT value FROM ctrl.entitlement WHERE tenant_id = $1 AND key = 'ai.automation.live' LIMIT 1`,
        [tenantId],
      );
      return rows.length > 0 && rows[0]?.value === 'true';
    } finally {
      client.release();
    }
  } catch {
    return false; // Safe default: never live if we can't check
  }
}

async function writeDispositionLog(params: {
  tenantId: string;
  caseRef: string;
  analysisId: string;
  proposedOutcome: string;
  allow: boolean;
  denyReasons: string[];
  dryRun: boolean;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [params.tenantId]);
    await client.query(
      `INSERT INTO automation.disposition_log
         (disposition_id, tenant_id, case_ref, analysis_id, proposed_outcome, allow, deny_reasons, dry_run, system_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'automation-service')`,
      [
        randomUUID(),
        params.tenantId,
        params.caseRef,
        params.analysisId,
        params.proposedOutcome,
        params.allow,
        params.denyReasons,
        params.dryRun,
      ],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[automation] Failed to write disposition_log', err);
  } finally {
    client.release();
  }
}

const PORT = Number(process.env['PORT'] ?? 3017);
app.listen(PORT, () => {
  console.log(`[automation] listening on :${PORT}`);
});

export default app;
