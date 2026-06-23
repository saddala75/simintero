import type { Pool, PoolClient } from 'pg';
import { jsonDiff, type PathDiff } from './diff.js';

// Accepts either a connection pool or a pooled client (e.g. from withTenant,
// which runs inside a transaction with the sim.tenant_id GUC set). Both expose
// a compatible `.query(...)`.
type Queryable = Pool | PoolClient;

// Blast-radius threshold — any single artifact with outcome deltas exceeding these
// values requires an extra clinical-override approval gate before promotion.
const BLAST_RADIUS_THRESHOLD = {
  approve_pct_delta: 0.10,
  deny_pct_delta: 0.05,
};

export interface PromotionItem {
  canonical_url: string;
  version: string;
}

export interface PromotionSet {
  items: PromotionItem[];
  target_env: 'uat' | 'prod';
  promoted_by: string;
  reason: string;
}

export interface BlastRadiusItemResult {
  canonical_url: string;
  version: string;
  passed: boolean;
  blocked_reason?: string;
}

export interface BlastRadiusResult {
  passed: boolean;
  items: BlastRadiusItemResult[];
}

export interface DiffItem {
  canonical_url: string;
  version: string;
  has_content_diff: boolean;
  changes: PathDiff[];
}

interface ApprovalRow {
  gate: string;
  decided: string;
  attestation: {
    outcome_delta?: {
      approve_pct_delta: number;
      deny_pct_delta: number;
    };
  };
}

export async function evaluateBlastRadius(
  set: PromotionSet,
  pool: Queryable,
): Promise<BlastRadiusResult> {
  const itemResults: BlastRadiusItemResult[] = [];

  for (const item of set.items) {
    const { rows } = await pool.query<ApprovalRow>(
      `SELECT gate, decided, attestation
       FROM vkas.approval
       WHERE canonical_url = $1 AND version = $2 AND gate = 'eval'`,
      [item.canonical_url, item.version],
    );

    if (rows.length === 0) {
      itemResults.push({
        ...item,
        passed: false,
        blocked_reason: 'missing_simulation: no eval gate approval found; run simulation before promoting',
      });
      continue;
    }

    const evalRow = rows[0]!;
    const delta = evalRow.attestation?.outcome_delta;
    const approveExceeds = delta && Math.abs(delta.approve_pct_delta) > BLAST_RADIUS_THRESHOLD.approve_pct_delta;
    const denyExceeds = delta && Math.abs(delta.deny_pct_delta) > BLAST_RADIUS_THRESHOLD.deny_pct_delta;

    if (approveExceeds || denyExceeds) {
      itemResults.push({
        ...item,
        passed: false,
        blocked_reason: `blast_radius: outcome delta exceeds threshold (approve: ${delta?.approve_pct_delta}, deny: ${delta?.deny_pct_delta}). Requires clinical-override approval gate.`,
      });
      continue;
    }

    itemResults.push({ ...item, passed: true });
  }

  return { passed: itemResults.every(r => r.passed), items: itemResults };
}

export async function applyPromotion(
  set: PromotionSet,
  pool: Queryable,
): Promise<DiffItem[]> {
  const diffs: DiffItem[] = [];

  for (const item of set.items) {
    const { rows: current } = await pool.query<{ content: unknown }>(
      `SELECT content FROM vkas.artifact
       WHERE canonical_url = $1 AND status = 'active'
       ORDER BY version DESC LIMIT 1`,
      [item.canonical_url],
    );

    const { rows: newRows } = await pool.query<{ content: unknown }>(
      `SELECT content FROM vkas.artifact
       WHERE canonical_url = $1 AND version = $2`,
      [item.canonical_url, item.version],
    );

    const newContent = newRows[0]?.content;

    const changes: PathDiff[] =
      current.length > 0 && newContent !== undefined
        ? jsonDiff(current[0]!.content, newContent)
        : [];

    await pool.query(
      `UPDATE vkas.artifact
       SET status = 'active', effective_from = CURRENT_DATE
       WHERE canonical_url = $1 AND version = $2`,
      [item.canonical_url, item.version],
    );

    diffs.push({
      canonical_url: item.canonical_url,
      version: item.version,
      has_content_diff: changes.length > 0,
      changes,
    });
  }

  return diffs;
}
