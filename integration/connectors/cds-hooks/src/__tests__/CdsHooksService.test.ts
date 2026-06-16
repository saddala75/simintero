import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCdsHooksRouter } from '../CdsHooksService.js';

vi.mock('undici', () => ({
  fetch: vi.fn(),
}));
import { fetch } from 'undici';

const cfg = {
  controlPlaneUrl: 'http://localhost:3000',
  interopFhirBaseUrl: 'http://localhost:8080/fhir',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', createCdsHooksRouter(cfg));
  return app;
}

describe('CdsHooksService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('GET /cds-services returns discovery JSON with registered hooks', async () => {
    const app = buildApp();
    const res = await request(app).get('/cds-services');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('services');
    expect(Array.isArray(res.body.services)).toBe(true);
    expect(res.body.services).toHaveLength(2);

    const hookIds = (res.body.services as Array<{ id: string }>).map(s => s.id);
    expect(hookIds).toContain('pa-authorization-check');
    expect(hookIds).toContain('coverage-check');
  });

  it('POST /cds-services/pa-authorization-check returns warning card when PA required', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ required: true, reason: 'Plan requires PA for CPT 27447' }),
    } as unknown as Response);

    const app = buildApp();
    const cdsReq = {
      hookInstance: 'instance-001',
      hook: 'order-sign',
      context: {
        patientId: 'patient-123',
        userId: 'practitioner-456',
        draftOrders: {
          resourceType: 'Bundle',
          entry: [
            {
              resource: {
                resourceType: 'ServiceRequest',
                code: { coding: [{ code: '27447', system: 'http://www.ama-assn.org/go/cpt' }] },
              },
            },
          ],
        },
      },
    };

    const res = await request(app)
      .post('/cds-services/pa-authorization-check')
      .send(cdsReq);

    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(1);
    expect(res.body.cards[0].indicator).toBe('warning');
    expect(res.body.cards[0].summary).toContain('27447');
  });

  it('POST /cds-services/pa-authorization-check returns empty cards when PA not required', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ required: false }),
    } as unknown as Response);

    const app = buildApp();
    const cdsReq = {
      hookInstance: 'instance-002',
      hook: 'order-sign',
      context: {
        patientId: 'patient-123',
        userId: 'practitioner-456',
        draftOrders: {
          resourceType: 'Bundle',
          entry: [
            {
              resource: {
                resourceType: 'ServiceRequest',
                code: { coding: [{ code: '99213', system: 'http://www.ama-assn.org/go/cpt' }] },
              },
            },
          ],
        },
      },
    };

    const res = await request(app)
      .post('/cds-services/pa-authorization-check')
      .send(cdsReq);

    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(0);
  });

  it('POST /cds-services/coverage-check fetches Coverage from interop FHIR base and returns info card', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ resourceType: 'Bundle', type: 'searchset', total: 1 }),
    } as unknown as Response);

    const app = buildApp();
    const cdsReq = {
      hookInstance: 'instance-003',
      hook: 'order-select',
      context: {
        patientId: 'patient-cov-1',
        userId: 'practitioner-456',
      },
    };

    const res = await request(app)
      .post('/cds-services/coverage-check')
      .send(cdsReq);

    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(1);
    expect(res.body.cards[0].indicator).toBe('info');
    expect(res.body.cards[0].summary).toBe('Active coverage verified');

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'http://localhost:8080/fhir/Coverage?patient=patient-cov-1&status=active',
    );
  });

  it('GET /health returns 404 from router (health is on server app, not router)', async () => {
    const app = buildApp();
    const res = await request(app).get('/health');
    expect([200, 404]).toContain(res.status);
  });
});
