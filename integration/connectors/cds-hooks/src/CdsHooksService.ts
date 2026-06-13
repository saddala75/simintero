import { Router, type Request, type Response } from 'express';
import { fetch } from 'undici';
import type { CdsHook, CdsRequest, CdsResponse, CdsCard, CdsHooksConfig } from './types.js';

const REGISTERED_HOOKS: CdsHook[] = [
  {
    id: 'pa-authorization-check',
    hook: 'order-sign',
    title: 'Prior Authorization Check',
    description: 'Checks whether the ordered procedure requires prior authorization for the patient\'s plan.',
    prefetch: {
      patient: 'Patient/{{context.patientId}}',
      coverage: 'Coverage?patient={{context.patientId}}&status=active',
    },
  },
  {
    id: 'coverage-check',
    hook: 'order-select',
    title: 'Coverage Eligibility Check',
    description: 'Confirms whether the ordered service is covered under the member\'s active benefit plan.',
    prefetch: {
      patient: 'Patient/{{context.patientId}}',
    },
  },
];

export function createCdsHooksRouter(cfg: CdsHooksConfig): Router {
  const router = Router();

  router.get('/cds-services', (_req: Request, res: Response) => {
    res.json({ services: REGISTERED_HOOKS });
  });

  router.post('/cds-services/pa-authorization-check', async (req: Request, res: Response) => {
    try {
      const cdsReq = req.body as CdsRequest;
      const { patientId } = cdsReq.context;

      const procedureCode = extractFirstProcedureCode(cdsReq);

      if (!procedureCode) {
        return res.json({ cards: [] } satisfies CdsResponse);
      }

      const paRes = await fetch(
        `${cfg.controlPlaneUrl}/v1/entitlements/pa-required?patient_id=${encodeURIComponent(patientId)}&procedure_code=${encodeURIComponent(procedureCode)}`,
      );

      if (!paRes.ok) {
        return res.json({ cards: [] } satisfies CdsResponse);
      }

      const paData = await paRes.json() as { required: boolean; reason?: string };

      if (!paData.required) {
        return res.json({ cards: [] } satisfies CdsResponse);
      }

      const card: CdsCard = {
        summary: `Prior Authorization Required for procedure ${procedureCode}`,
        detail: paData.reason ?? 'This procedure requires prior authorization before service can be rendered.',
        indicator: 'warning',
        source: {
          label: 'Simintero PA Engine',
          url: `${cfg.controlPlaneUrl}/portal/pa`,
        },
        suggestions: [
          {
            label: 'Submit PA Request',
            uuid: crypto.randomUUID(),
          },
        ],
      };

      return res.json({ cards: [card] } satisfies CdsResponse);
    } catch (err) {
      console.error('[cds-hooks] pa-authorization-check error:', err);
      return res.json({ cards: [] } satisfies CdsResponse);
    }
  });

  router.post('/cds-services/coverage-check', async (req: Request, res: Response) => {
    try {
      const cdsReq = req.body as CdsRequest;
      const { patientId } = cdsReq.context;

      const coverageRes = await fetch(
        `${cfg.fhirFacadeUrl}/fhir/R4/Coverage?patient=${encodeURIComponent(patientId)}&status=active`,
        { headers: { 'Accept': 'application/fhir+json' } },
      );

      if (!coverageRes.ok || coverageRes.status === 404) {
        const card: CdsCard = {
          summary: 'No active coverage found for patient',
          indicator: 'critical',
          source: { label: 'Simintero Coverage' },
        };
        return res.json({ cards: [card] } satisfies CdsResponse);
      }

      const bundle = await coverageRes.json() as { total?: number };
      if ((bundle.total ?? 0) === 0) {
        const card: CdsCard = {
          summary: 'No active coverage found for patient',
          indicator: 'critical',
          source: { label: 'Simintero Coverage' },
        };
        return res.json({ cards: [card] } satisfies CdsResponse);
      }

      const card: CdsCard = {
        summary: 'Active coverage verified',
        indicator: 'info',
        source: { label: 'Simintero Coverage' },
      };
      return res.json({ cards: [card] } satisfies CdsResponse);
    } catch (err) {
      console.error('[cds-hooks] coverage-check error:', err);
      return res.json({ cards: [] } satisfies CdsResponse);
    }
  });

  return router;
}

function extractFirstProcedureCode(req: CdsRequest): string | null {
  const entries = req.context.draftOrders?.entry ?? [];
  for (const entry of entries) {
    const codings = entry.resource?.code?.coding ?? [];
    for (const coding of codings) {
      if (coding.code) return coding.code;
    }
  }
  return null;
}
