import type { Pool } from 'pg';
import type { SummaryBlock } from './summarizeGrounded.js';
import type { ExtractionBlock } from './extractEntities.js';
import type { CompletenessBlock } from './mapEvidenceToCriteria.js';
import type { TriageBlock } from './triageAdvise.js';

export interface PersistInput {
  analysis_id: string;
  case_ref: string;
  status: 'complete' | 'partial' | 'failed';
  summary: SummaryBlock | null;
  extraction: ExtractionBlock | null;
  completeness: CompletenessBlock | null;
  triage: TriageBlock | null;
  unprocessed: Array<{ ref: string; reason: string }>;
}

export async function persistAdvisoryImpl(
  input: PersistInput,
  pool: Pool,
): Promise<void> {
  const completedAt = new Date().toISOString();

  await pool.query(
    `INSERT INTO revital.analysis
       (analysis_id, tenant_id, case_ref, status, interaction, summary, extraction,
        completeness, triage, abstentions, unprocessed_inputs, completed_at)
     VALUES ($1, current_setting('sim.tenant_id', true), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (analysis_id) DO UPDATE SET
       status = EXCLUDED.status,
       summary = EXCLUDED.summary,
       extraction = EXCLUDED.extraction,
       completeness = EXCLUDED.completeness,
       triage = EXCLUDED.triage,
       abstentions = EXCLUDED.abstentions,
       unprocessed_inputs = EXCLUDED.unprocessed_inputs,
       completed_at = EXCLUDED.completed_at`,
    [
      input.analysis_id,
      input.case_ref,
      input.status,
      JSON.stringify({ started_at: new Date().toISOString(), completed_at: completedAt }),
      JSON.stringify(input.summary),
      JSON.stringify(input.extraction),
      JSON.stringify(input.completeness),
      JSON.stringify(input.triage),
      JSON.stringify([]),
      JSON.stringify(input.unprocessed),
      completedAt,
    ],
  );

  await pool.query(
    `INSERT INTO shared.outbox (tenant_id, topic, payload)
     VALUES (current_setting('sim.tenant_id', true), $1, $2)`,
    [
      'sim.ai.interaction',
      JSON.stringify({
        event_type: 'AnalysisCompleted',
        analysis_id: input.analysis_id,
        case_ref: input.case_ref,
        status: input.status,
        occurred_at: completedAt,
      }),
    ],
  );
}

export async function persistAdvisory(input: PersistInput): Promise<void> {
  const { Pool: PgPool } = await import('pg');
  const pool = new PgPool({ connectionString: process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero' });
  try {
    await persistAdvisoryImpl(input, pool);
  } finally {
    await pool.end();
  }
}
