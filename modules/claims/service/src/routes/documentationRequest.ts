import express from 'express';
import type { Pool } from 'pg';
import { appendEvent } from '@sim/outbox-ts/append';
import { withTenant } from '../db/withTenant.js';

export function buildDocumentationRequestRouter(pool: Pool): express.Router {
  const router = express.Router();

  router.post('/:caseRef/documentation-request', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ error: 'Missing x-sim-tenant-id header' });

    const { loinc_codes } = req.body as { loinc_codes?: string[] };
    if (!Array.isArray(loinc_codes) || loinc_codes.length === 0) {
      return res.status(400).json({ error: 'loinc_codes must be a non-empty array' });
    }

    const { caseRef } = req.params;

    // UPDATE and outbox INSERT run in the same tenant-scoped transaction so RLS
    // applies to the UPDATE and the outbox write is atomic with it.
    const result = await withTenant(pool, tenantId, async (client) => {
      const { rows } = await client.query<{ claim_id: string; documentation_status: string }>(
        `UPDATE claims.claim
           SET documentation_status = 'requested'
         WHERE case_id = $1::uuid
           AND tenant_id = $2
           AND documentation_status = 'not_requested'
         RETURNING claim_id, documentation_status`,
        [caseRef, tenantId],
      );

      if (rows.length === 0) {
        return null;
      }

      const { claim_id } = rows[0]!;

      await appendEvent(client, {
        topic: 'claims.attachment.requested',
        schemaRef: 'claims.attachment.requested/v1',
        tenantId,
        payload: {
          claim_id,
          case_ref: caseRef,
          loinc_codes,
        },
        correlationId: claim_id,
      });

      return { claim_id, documentation_status: rows[0]!.documentation_status };
    });

    if (result === null) {
      return res.status(404).json({ error: 'Claim not found or documentation already requested' });
    }

    return res.status(200).json(result);
  });

  return router;
}
