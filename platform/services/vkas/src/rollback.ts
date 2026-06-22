import type pg from 'pg';
import { appendEvent } from '@sim/outbox-ts/append';

/**
 * Mirrors the generated `ArtifactRecord` schema
 * (platform/libs/generated/platform-vkas/types.ts → components.schemas.ArtifactRecord),
 * defined locally because that generated file lives outside this service's tsconfig
 * rootDir. The fields/columns are kept 1:1 with the OpenAPI contract.
 */
export interface ArtifactRecord {
  canonical_url: string;
  version: string;
  artifact_type:
    | 'coverage_criteria'
    | 'clock_profile'
    | 'workflow_definition'
    | 'value_set'
    | 'questionnaire'
    | 'supplemental_guideline';
  status: 'draft' | 'in_review' | 'approved' | 'active' | 'retired' | 'rolled_back';
  content?: Record<string, unknown> | undefined;
  applicability?: unknown;
  metadata?: unknown;
  created_at: string;
  activated_at?: string | null | undefined;
  retired_at?: string | null | undefined;
}

// C-3 event catalog (contracts/asyncapi/c3-event-catalog.yaml → channel `artifact`,
// address `sim.artifact`). Schema-ref convention follows the governance 0.3 precedent
// (PgGovernanceStore: topic 'sim.artifact', schemaRef 'sim.artifact/<Name>/v1').
const ARTIFACT_TOPIC = 'sim.artifact';
const ROLLED_BACK_SCHEMA_REF = 'sim.artifact/ArtifactRolledBack/v1';
const ACTIVATED_SCHEMA_REF = 'sim.artifact/ArtifactActivated/v1';

export type RollbackResult =
  | { status: 'ok'; rolledBack: ArtifactRecord; restored: ArtifactRecord }
  | { status: 'not_found' }
  | { status: 'not_active' }
  | { status: 'no_prior' };

export interface RollbackArgs {
  canonicalUrl: string;
  version: string;
  reason: string;
  incidentRef: string | null;
  tenantId: string;
}

// Note: vkas.artifact has no activated_at/retired_at columns — the ArtifactRecord's
// activated_at/retired_at map to effective_from/effective_to (the activation/retirement dates).
const SELECT_COLUMNS =
  'canonical_url, version, artifact_type, status, content, applicability, metadata, created_at, effective_from, effective_to';

function toArtifactRecord(row: Record<string, unknown>): ArtifactRecord {
  return {
    canonical_url: row['canonical_url'] as string,
    version: row['version'] as string,
    artifact_type: row['artifact_type'] as ArtifactRecord['artifact_type'],
    status: row['status'] as ArtifactRecord['status'],
    content: (row['content'] as Record<string, unknown> | undefined) ?? undefined,
    applicability: row['applicability'],
    metadata: row['metadata'],
    created_at: row['created_at'] as string,
    activated_at: (row['effective_from'] as string | null | undefined) ?? null,
    retired_at: (row['effective_to'] as string | null | undefined) ?? null,
  };
}

/**
 * Transitions the target `active` artifact → `rolled_back`, restores the most-recent
 * `superseded` prior version → `active`, and appends the first-ever VKAS outbox events
 * (ArtifactRolledBack then ArtifactActivated). Caller must wrap this in `withTenant` so
 * all writes share one tenant-scoped transaction. Touches only status/effective_from —
 * never content — so the V019 immutability trigger never fires.
 */
export async function rollbackArtifact(
  client: pg.PoolClient,
  args: RollbackArgs,
): Promise<RollbackResult> {
  const target = await client.query(
    `SELECT ${SELECT_COLUMNS} FROM vkas.artifact WHERE canonical_url=$1 AND version=$2`,
    [args.canonicalUrl, args.version],
  );
  if (target.rows.length === 0) return { status: 'not_found' };
  if ((target.rows[0] as Record<string, unknown>)['status'] !== 'active') {
    return { status: 'not_active' };
  }

  const prior = await client.query(
    `SELECT ${SELECT_COLUMNS} FROM vkas.artifact
     WHERE canonical_url=$1 AND status='superseded'
     ORDER BY effective_from DESC, version DESC LIMIT 1`,
    [args.canonicalUrl],
  );
  if (prior.rows.length === 0) return { status: 'no_prior' };
  const restoreVersion = (prior.rows[0] as Record<string, unknown>)['version'] as string;

  // Demote the target. Status-only write → immutability trigger does not fire.
  await client.query(
    `UPDATE vkas.artifact SET status='rolled_back' WHERE canonical_url=$1 AND version=$2`,
    [args.canonicalUrl, args.version],
  );
  // Restore the prior. Touches status + effective_from only (never content).
  await client.query(
    `UPDATE vkas.artifact SET status='active', effective_from=CURRENT_DATE
     WHERE canonical_url=$1 AND version=$2`,
    [args.canonicalUrl, restoreVersion],
  );

  await appendEvent(client, {
    topic: ARTIFACT_TOPIC,
    schemaRef: ROLLED_BACK_SCHEMA_REF,
    tenantId: args.tenantId,
    payload: {
      canonical_url: args.canonicalUrl,
      version: args.version,
      reason: args.reason,
      incident_ref: args.incidentRef,
    },
    correlationId: args.canonicalUrl,
  });
  await appendEvent(client, {
    topic: ARTIFACT_TOPIC,
    schemaRef: ACTIVATED_SCHEMA_REF,
    tenantId: args.tenantId,
    payload: {
      canonical_url: args.canonicalUrl,
      version: restoreVersion,
    },
    correlationId: args.canonicalUrl,
  });

  const rolledBackRow = (
    await client.query(
      `SELECT ${SELECT_COLUMNS} FROM vkas.artifact WHERE canonical_url=$1 AND version=$2`,
      [args.canonicalUrl, args.version],
    )
  ).rows[0] as Record<string, unknown>;
  const restoredRow = (
    await client.query(
      `SELECT ${SELECT_COLUMNS} FROM vkas.artifact WHERE canonical_url=$1 AND version=$2`,
      [args.canonicalUrl, restoreVersion],
    )
  ).rows[0] as Record<string, unknown>;

  return {
    status: 'ok',
    rolledBack: toArtifactRecord(rolledBackRow),
    restored: toArtifactRecord(restoredRow),
  };
}
