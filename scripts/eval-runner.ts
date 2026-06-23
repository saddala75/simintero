#!/usr/bin/env tsx
// eval-runner — scores a candidate model_binding/prompt against a gold set and
// posts the gate='eval' approval that the VKAS /activate gate requires.
//
// Flow:
//   1. Resolve the eval_set (VKAS :resolve) → gold_cases.
//   2. For each gold case, POST {gateway}/eval with the CANDIDATE binding + case
//      inputs (mirrors /inference; runs the kill-switch → PHI filter → adapter chain).
//   3. scoreCase each output (structural + key-field + citation-resolves + abstention).
//   4. Run the gold set against the CURRENT ACTIVE binding too → computeOutcomeDelta.
//      The current-active version is read from the resolve response's TOP-LEVEL
//      `version` (NOT content.version — a model_binding content has no version).
//      (No current active / same version as candidate / resolve failure → {0,0} + a note.)
//   5. POST {vkas}/v1/approvals gate='eval', decided='approved' iff ALL cases passed.
//   6. Print N/M + decided; exit 0 iff all passed.
//
// Usage:
//   tsx scripts/eval-runner.ts --binding <ref> --binding-version <v> --eval-set <ref> \
//     [--gateway <url>] [--vkas <url>] [--approver <id>] [--tenant <id>] [--cell pooled]

import { scoreCase, computeOutcomeDelta, type GoldCase, type CaseScore, type OutcomeDelta } from './eval-scoring.js';

export interface Args {
  binding: string;
  bindingVersion: string;
  evalSet: string;
  gateway: string;
  vkas: string;
  approver: string;
  tenant: string;
  cell: string;
}

// Injectable fetch so the core flow is unit-testable (mocked fetch).
export type FetchImpl = typeof fetch;

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const binding = get('binding');
  const bindingVersion = get('binding-version');
  const evalSet = get('eval-set');
  if (!binding || !bindingVersion || !evalSet) {
    throw new Error(
      'usage: eval-runner --binding <ref> --binding-version <v> --eval-set <ref> ' +
        '[--gateway <url>] [--vkas <url>] [--approver <id>] [--tenant <id>] [--cell pooled]',
    );
  }
  return {
    binding,
    bindingVersion,
    evalSet,
    gateway: get('gateway') ?? process.env['MODEL_GATEWAY_URL'] ?? 'http://localhost:3011',
    vkas: get('vkas') ?? process.env['VKAS_URL'] ?? 'http://localhost:3040',
    approver: get('approver') ?? 'eval-runner',
    tenant: get('tenant') ?? 'tenant-dev',
    cell: get('cell') ?? 'pooled',
  };
}

interface ResolveResponse {
  status: string;
  content: Record<string, unknown>;
  // The artifact's top-level version, surfaced by VKAS :resolve (M-2). This is
  // the authoritative source for the current-active binding's version — a
  // model_binding's `content` does NOT carry a version field.
  version?: string;
}

async function resolveArtifact(
  fetchImpl: FetchImpl,
  vkas: string,
  tenant: string,
  canonicalUrl: string,
  version?: string,
): Promise<ResolveResponse | null> {
  let url = `${vkas}/v1/artifacts:resolve?canonical_url=${encodeURIComponent(canonicalUrl)}`;
  if (version) url += `&version=${encodeURIComponent(version)}`;
  const res = await fetchImpl(url, { headers: { 'x-sim-tenant-id': tenant } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`VKAS resolve failed (${res.status}) for ${canonicalUrl}`);
  return (await res.json()) as ResolveResponse;
}

async function runCase(
  fetchImpl: FetchImpl,
  args: Args,
  bindingVersion: string,
  goldCase: GoldCase,
): Promise<unknown> {
  const body = {
    task_kind: goldCase.task_kind,
    prompt_ref: 'eval',
    prompt_version: '1.0.0',
    model_binding_ref: args.binding,
    model_binding_version: bindingVersion,
    inputs: goldCase.inputs,
    workflow_id: `eval-${goldCase.id}`,
  };
  const res = await fetchImpl(`${args.gateway}/eval`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sim-tenant-id': args.tenant,
      'x-sim-cell-boundary': args.cell,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`/eval failed (${res.status}) for case ${goldCase.id}: ${detail}`);
  }
  const json = (await res.json()) as { output: unknown };
  return json.output;
}

export interface EvalResult {
  caseScores: CaseScore[];
  outcomeDelta: OutcomeDelta;
  passedCount: number;
  total: number;
  decided: 'approved' | 'rejected';
  notes: string[];
  attestation: Record<string, unknown>;
}

// Core flow (testable). Runs the candidate, computes the real outcome_delta vs the
// current-active binding, posts the eval approval, and returns the result.
export async function runEval(args: Args, fetchImpl: FetchImpl = fetch): Promise<EvalResult> {
  const notes: string[] = [];

  // 1. Resolve the eval_set.
  const evalSet = await resolveArtifact(fetchImpl, args.vkas, args.tenant, args.evalSet);
  if (!evalSet) throw new Error(`eval_set not found: ${args.evalSet}`);
  const goldCases = (evalSet.content?.['gold_cases'] ?? []) as GoldCase[];
  if (!Array.isArray(goldCases) || goldCases.length === 0) {
    throw new Error(`eval_set ${args.evalSet} has no gold_cases`);
  }

  // 2 + 3. Run + score each case against the CANDIDATE binding.
  const candidateOutputs: unknown[] = [];
  const caseScores: CaseScore[] = [];
  for (const gc of goldCases) {
    const output = await runCase(fetchImpl, args, args.bindingVersion, gc);
    candidateOutputs.push(output);
    caseScores.push(scoreCase(gc, output));
  }

  // 4. Outcome delta vs the CURRENT ACTIVE binding (best-effort, robust).
  //    The active version comes from the resolve response's TOP-LEVEL `version`.
  let outcomeDelta: OutcomeDelta = { approve_pct_delta: 0, deny_pct_delta: 0 };
  try {
    const active = await resolveArtifact(fetchImpl, args.vkas, args.tenant, args.binding);
    if (!active) {
      notes.push('no current-active binding — outcome_delta defaulted to {0,0}');
    } else {
      const activeVersion = active.version;
      if (activeVersion && activeVersion !== args.bindingVersion) {
        const currentOutputs: unknown[] = [];
        for (const gc of goldCases) {
          currentOutputs.push(await runCase(fetchImpl, args, activeVersion, gc));
        }
        outcomeDelta = computeOutcomeDelta(candidateOutputs, currentOutputs);
      } else {
        // Active resolves but is the same version as the candidate (or its version
        // is unknown from :resolve) → no measurable delta.
        notes.push(
          'current-active is the candidate version (or version unknown) — outcome_delta {0,0}',
        );
      }
    }
  } catch (err) {
    notes.push(`current-active resolve failed (${(err as Error).message}) — outcome_delta {0,0}`);
  }

  const passedCount = caseScores.filter((c) => c.passed).length;
  const total = caseScores.length;
  const allPassed = passedCount === total;
  const decided: 'approved' | 'rejected' = allPassed ? 'approved' : 'rejected';

  // 5. Post the eval approval.
  const attestation = {
    outcome_delta: outcomeDelta,
    passed_cases: passedCount,
    total_cases: total,
    eval_set_ref: args.evalSet,
    case_scores: caseScores,
    ...(notes.length ? { notes } : {}),
  };
  const approvalRes = await fetchImpl(`${args.vkas}/v1/approvals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sim-tenant-id': args.tenant },
    body: JSON.stringify({
      canonical_url: args.binding,
      version: args.bindingVersion,
      gate: 'eval',
      approver: args.approver,
      decided,
      rationale: `eval-runner: ${passedCount}/${total} gold cases passed`,
      attestation,
    }),
  });
  if (!approvalRes.ok) {
    const detail = await approvalRes.text().catch(() => '');
    throw new Error(`POST /v1/approvals failed (${approvalRes.status}): ${detail}`);
  }

  return { caseScores, outcomeDelta, passedCount, total, decided, notes, attestation };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { caseScores, outcomeDelta, passedCount, total, decided, notes } = await runEval(args);

  // 6. Summary.
  console.log(`eval-runner: ${args.binding}@${args.bindingVersion} against ${args.evalSet}`);
  for (const cs of caseScores) {
    const failed = cs.checks.filter((c) => !c.passed).map((c) => c.name);
    console.log(
      `  [${cs.passed ? 'PASS' : 'FAIL'}] ${cs.id} (${cs.task_kind})` +
        (failed.length ? ` — failed: ${failed.join(', ')}` : ''),
    );
  }
  console.log(`  outcome_delta: ${JSON.stringify(outcomeDelta)}`);
  for (const n of notes) console.log(`  note: ${n}`);
  console.log(`${passedCount}/${total} passed → decided: ${decided}`);

  process.exit(passedCount === total ? 0 : 1);
}

// Only run the CLI when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`eval-runner error: ${(err as Error).message}`);
    process.exit(2);
  });
}
