/**
 * Activity: resolveWorkflowDef
 * Resolves the workflow definition from VKAS and pins it for the case.
 * Falls back to a hardcoded stub when VKAS returns 501 (Phase 0 / not yet deployed).
 */

const WORKFLOW_DEF_URL =
  'https://artifacts.simintero.io/shared/workflow_def/pa-standard-ma';

const PA_STANDARD_MA_STUB = {
  id: 'pa-standard-ma',
  version: '0.1.0-stub',
  states: [
    'intake',
    'completeness_check',
    'rfi_pending',
    'clinical_review',
    'determined',
    'withdrawn',
    'voided',
  ],
  initial_state: 'intake',
  terminal_states: ['determined', 'withdrawn', 'voided'],
  transitions: [
    { from: 'intake', to: 'completeness_check', trigger: 'case.created' },
    { from: 'completeness_check', to: 'rfi_pending', trigger: 'completeness.gap_found' },
    { from: 'completeness_check', to: 'clinical_review', trigger: 'completeness.complete' },
    { from: 'rfi_pending', to: 'clinical_review', trigger: 'rfi.satisfied' },
    { from: 'rfi_pending', to: 'determined', trigger: 'rfi.deadline_expired' },
    { from: 'clinical_review', to: 'determined', trigger: 'decision.recorded' },
  ],
};

export interface ResolveWorkflowDefInput {
  caseId: string;
}

export interface ResolvedArtifactPin {
  canonical_url: string;
  version: string;
}

export interface ResolveWorkflowDefResult {
  pin: ResolvedArtifactPin;
  content: Record<string, unknown>;
}

export async function resolveWorkflowDef(
  input: ResolveWorkflowDefInput,
): Promise<ResolveWorkflowDefResult> {
  const vkasUrl = process.env['VKAS_URL'] ?? 'http://localhost:8080';
  const url = `${vkasUrl}/v1/artifacts:resolve?canonical_url=${encodeURIComponent(WORKFLOW_DEF_URL)}`;

  let response: Response | null = null;
  try {
    response = await fetch(url, {
      headers: { 'X-Case-Id': input.caseId },
    });
  } catch (_err) {
    // Connection refused / network error — use stub
    return buildStub();
  }

  if (response.status === 501 || response.status === 404) {
    return buildStub();
  }

  if (!response.ok) {
    throw new Error(`VKAS resolve failed with status ${response.status}`);
  }

  const body = (await response.json()) as {
    canonical_url?: string;
    version?: string;
    content?: Record<string, unknown>;
  };

  return {
    pin: {
      canonical_url: body.canonical_url ?? WORKFLOW_DEF_URL,
      version: body.version ?? 'unknown',
    },
    content: body.content ?? {},
  };
}

function buildStub(): ResolveWorkflowDefResult {
  return {
    pin: {
      canonical_url: WORKFLOW_DEF_URL,
      version: PA_STANDARD_MA_STUB.version,
    },
    content: PA_STANDARD_MA_STUB as unknown as Record<string, unknown>,
  };
}
