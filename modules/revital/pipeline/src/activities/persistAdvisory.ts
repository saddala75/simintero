import type { Pool } from 'pg';
import { monotonicFactory } from 'ulid';
import { withTenant } from '../db/withTenant.js';
import { writeAiEvidence } from '../fabric/writeAiEvidence.js';
import type { SummaryBlock } from './summarizeGrounded.js';
import type { ExtractionBlock } from './extractEntities.js';
import type { CompletenessBlock } from './mapEvidenceToCriteria.js';
import type { TriageBlock } from './triageAdvise.js';

const ulid = monotonicFactory();

export interface PersistInput {
  analysis_id: string;
  tenant_id: string;
  case_ref: string;
  document_refs: string[];
  member_ref?: string | undefined;
  model_binding_ref?: string | undefined;
  model_binding_version?: string | undefined;
  prompt_ref?: string | undefined;
  prompt_version?: string | undefined;
  status: 'complete' | 'partial' | 'failed';
  summary: SummaryBlock | null;
  extraction: ExtractionBlock | null;
  completeness: CompletenessBlock | null;
  triage: TriageBlock | null;
  unprocessed: Array<{ ref: string; reason: string }>;
}

export async function persistAdvisoryImpl(input: PersistInput, pool: Pool): Promise<void> {
  const completedAt = new Date().toISOString();
  await withTenant(pool, input.tenant_id, async (client) => {
    await client.query(
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
        JSON.stringify({
          model_binding: { canonical_url: input.model_binding_ref, version: input.model_binding_version },
          prompt: { canonical_url: input.prompt_ref, version: input.prompt_version },
          started_at: completedAt,
          completed_at: completedAt,
        }),
        JSON.stringify(input.summary),
        JSON.stringify(input.extraction),
        JSON.stringify(input.completeness),
        JSON.stringify(input.triage),
        JSON.stringify([]),
        JSON.stringify(input.unprocessed),
        completedAt,
      ],
    );

    const eventId = `evt_${ulid()}`;
    const envelope = {
      event_id: eventId,
      schema_ref: 'sim.ai.interaction/AnalysisCompleted/v1',
      occurred_at: completedAt,
      tenant: { tenant_id: input.tenant_id },
      correlation_id: input.case_ref,
      payload: {
        analysis_id: input.analysis_id,
        case_ref: input.case_ref,
        status: input.status,
      },
    };
    await client.query(
      `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
       VALUES ($1, $2, $3, $4::jsonb, current_setting('sim.tenant_id', true))`,
      [eventId, 'sim.ai.interaction', input.case_ref, JSON.stringify(envelope)],
    );

    const written = input.extraction
      ? await writeAiEvidence(client, {
          analysis_id: input.analysis_id,
          member_ref: input.member_ref,
          document_refs: input.document_refs,
          model_binding_ref: input.model_binding_ref,
          model_binding_version: input.model_binding_version,
          extraction: input.extraction,
        })
      : [];

    for (const w of written) {
      const evId = `evt_${ulid()}`;
      const evEnvelope = {
        event_id: evId,
        schema_ref: 'sim.evidence.added/v1',
        occurred_at: completedAt,
        tenant: { tenant_id: input.tenant_id },
        correlation_id: input.case_ref,
        payload: {
          fabric_ref: w.fabric_ref,
          resource_type: w.resource_type,
          member_ref: w.member_ref,
          source: 'revital_extraction',
          provenance_ref: w.provenance_ref,
          classification: 'non_standard',
          clinical_context: { codes: w.codes },
          case_ref: input.case_ref,
        },
      };
      await client.query(
        `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
         VALUES ($1, $2, $3, $4::jsonb, current_setting('sim.tenant_id', true))`,
        [evId, 'sim.evidence', w.member_ref, JSON.stringify(evEnvelope)],
      );
    }
  });
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
