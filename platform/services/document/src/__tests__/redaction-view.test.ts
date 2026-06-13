import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createRedactionViewRouter } from '../routes/redaction-view.js';

const FAKE_VIEW_ID = '11111111-1111-1111-1111-111111111111';
const FAKE_DOC_ID = '22222222-2222-2222-2222-222222222222';

function makePoolWithView(): Pool {
  return {
    query: vi.fn().mockResolvedValue({
      rows: [{
        view_id: FAKE_VIEW_ID,
        doc_id: FAKE_DOC_ID,
        redacted_text: 'Patient [REDACTED:PERSON] DOB [REDACTED:DATE]',
        redaction_map: { PERSON: [{ start: 8, end: 24 }], DATE_TIME: [{ start: 29, end: 43 }] },
        created_at: '2026-06-13T00:00:00Z',
        created_by: { user_id: 'u_test_user' },
      }],
    }),
  } as unknown as Pool;
}

function makePoolEmpty(): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  } as unknown as Pool;
}

describe('GET /documents/:docId/redactions/:viewId', () => {
  describe('when view does not exist', () => {
    let app: ReturnType<typeof express>;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(createRedactionViewRouter(makePoolEmpty()));
    });

    it('returns 404', async () => {
      const res = await request(app)
        .get(`/documents/${FAKE_DOC_ID}/redactions/${FAKE_VIEW_ID}`);
      expect(res.status).toBe(404);
    });
  });

  describe('when view exists', () => {
    beforeEach(() => {
      const app = express();
      app.use(express.json());
      app.use(createRedactionViewRouter(makePoolWithView()));
      (globalThis as Record<string, unknown>)['__testApp'] = app;
    });

    it('returns 200 with redacted_text and redaction_map', async () => {
      const app = express();
      app.use(express.json());
      app.use(createRedactionViewRouter(makePoolWithView()));

      const res = await request(app)
        .get(`/documents/${FAKE_DOC_ID}/redactions/${FAKE_VIEW_ID}`);
      expect(res.status).toBe(200);
      expect(res.body.view_id).toBe(FAKE_VIEW_ID);
      expect(res.body.doc_id).toBe(FAKE_DOC_ID);
      expect(res.body.redacted_text).toContain('[REDACTED:PERSON]');
      expect(res.body.redaction_map).toHaveProperty('PERSON');
    });

    it('queries by both view_id AND doc_id', async () => {
      const pool = makePoolWithView();
      const localApp = express();
      localApp.use(express.json());
      localApp.use(createRedactionViewRouter(pool));

      await request(localApp)
        .get(`/documents/${FAKE_DOC_ID}/redactions/${FAKE_VIEW_ID}`);

      const queryCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
      const params = queryCall[1] as string[];
      expect(params).toContain(FAKE_VIEW_ID);
      expect(params).toContain(FAKE_DOC_ID);
    });
  });
});
