import type { Pool } from 'pg'
import { ulid } from 'ulid'
import { withTenant } from '../db/withTenant.js'

export interface EvidenceIndexedPayload {
  event_type: 'EvidenceIndexed'
  source_event_id: string
  doc_id: string
  case_ref: string
}

const DIGICORE_URL =
  process.env['DIGICORE_SERVICE_URL'] ?? 'http://localhost:4010'

export async function handleEvidenceIndexed(
  payload: EvidenceIndexedPayload,
  tenantId: string,
  pool: Pool,
): Promise<void> {
  await withTenant(pool, tenantId, async (client) => {
    // 1. Find active CQL-backed measure definitions for this tenant
    const { rows: defs } = await client.query<{
      measure_ref: string
      measure_version: string
      digicore_library_ref: string
      tenant_id: string
    }>(
      `SELECT measure_ref, version AS measure_version, digicore_library_ref, tenant_id
       FROM qual.measure_definition
       WHERE digicore_library_ref IS NOT NULL
         AND tenant_id = current_setting('sim.tenant_id', true)`,
    )
    if (defs.length === 0) return

    // 2. Resolve member_ref from ens.case using case_ref
    const { rows: caseRows } = await client.query<{ member_ref: string }>(
      `SELECT member_ref FROM ens.case
       WHERE case_ref = $1
         AND tenant_id = current_setting('sim.tenant_id', true)
       LIMIT 1`,
      [payload.case_ref],
    )
    if (!caseRows[0]) {
      // Evidence not tied to a known case — cannot map to a member; skip silently
      return
    }
    const memberRef = caseRows[0].member_ref

    for (const def of defs) {
      try {
        // 3. Evaluate the single member via Digicore
        const evalRes = await fetch(
          `${DIGICORE_URL}/v1/runtime/measure-evaluate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-sim-tenant-id': tenantId,
            },
            body: JSON.stringify({
              tenantId,
              libraryRef: def.digicore_library_ref,
              memberRefs: [memberRef],
              periodStart: `${new Date().getFullYear()}-01-01`,
              periodEnd: new Date().toISOString().split('T')[0],
            }),
          },
        )
        if (!evalRes.ok) {
          console.warn(
            `EvidenceIndexedConsumer: Digicore ${evalRes.status} for member ${memberRef} measure ${def.measure_ref}`,
          )
          continue
        }
        const { results } = (await evalRes.json()) as {
          results: Array<{
            memberRef: string
            denominator: boolean
            numerator: boolean
            exclusion: boolean
            exception: boolean
            traceRef: string
          }>
        }
        const result = results[0]
        if (!result) continue

        // 4. If numerator flipped true, close any open gap + emit outbox event
        if (result.numerator) {
          const { rows: openGaps } = await client.query<{
            gap_id: string
            member_id: string
            measure_ref: string
            period_start: string
            period_end: string
          }>(
            `SELECT gap_id, member_id, measure_ref, period_start::text, period_end::text
             FROM qual.gap
             WHERE tenant_id = current_setting('sim.tenant_id', true)
               AND member_id = $1 AND measure_ref = $2 AND status = 'open'`,
            [memberRef, def.measure_ref],
          )

          for (const gap of openGaps) {
            await client.query(
              `UPDATE qual.gap
               SET status = 'closed', closed_at = NOW(), closure_reason = 'numerator_met'
               WHERE gap_id = $1`,
              [gap.gap_id],
            )

            const eventId = 'evt_' + ulid()
            const closedAt = new Date().toISOString()
            await client.query(
              `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
               VALUES ($1, 'qual.gap.closed', $2, $3::jsonb, $4)`,
              [
                eventId,
                gap.gap_id,
                JSON.stringify({
                  event_id: eventId,
                  schema_ref: 'sim.qual.gap/QualGapClosed/v1',
                  occurred_at: closedAt,
                  tenant: { tenant_id: tenantId },
                  correlation_id: gap.gap_id,
                  payload: {
                    event_type: 'QualGapClosed',
                    gap_id: gap.gap_id,
                    member_id: gap.member_id,
                    measure_ref: gap.measure_ref,
                    closed_at: closedAt,
                  },
                }),
                tenantId,
              ],
            )
          }
        }
      } catch (err) {
        // Log and continue — don't poison the topic for a single member/measure failure
        console.error(
          `EvidenceIndexedConsumer: error processing member ${memberRef} measure ${def.measure_ref}:`,
          err,
        )
      }
    }
  })
}
