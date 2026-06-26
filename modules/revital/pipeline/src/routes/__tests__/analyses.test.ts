import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { createAnalysesRouter } from '../analyses.js';

function makePool() {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue(client),
  } as any;
}

function makeTemporal() {
  return { start: vi.fn().mockResolvedValue({ workflowId: 'test-id' }) } as any;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  const pool = makePool();
  const temporal = makeTemporal();
  app.use(createAnalysesRouter(pool, temporal));
  return { app, temporal };
}

describe('POST /v1/assist/analyses', () => {
  it('passes document_format ccda to temporal workflow args', async () => {
    const { app, temporal } = makeApp();
    await supertest(app)
      .post('/v1/assist/analyses')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({
        case_ref: 'case-123',
        inputs: { document_refs: ['doc-1'], case_context: {} },
        analysis_kinds: ['claims_attachment'],
        document_format: 'ccda',
      });
    expect(temporal.start).toHaveBeenCalledWith(
      'revitalAnalyzeCase',
      expect.objectContaining({
        args: [expect.objectContaining({ document_format: 'ccda' })],
      }),
    );
  });

  it('defaults document_format to pdf when not provided', async () => {
    const { app, temporal } = makeApp();
    await supertest(app)
      .post('/v1/assist/analyses')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({
        case_ref: 'case-123',
        inputs: { document_refs: ['doc-1'], case_context: {} },
        analysis_kinds: ['pa'],
      });
    expect(temporal.start).toHaveBeenCalledWith(
      'revitalAnalyzeCase',
      expect.objectContaining({
        args: [expect.objectContaining({ document_format: 'pdf' })],
      }),
    );
  });
});
