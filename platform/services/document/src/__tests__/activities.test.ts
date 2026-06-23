import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { makeActivities } from '../pipeline/activities.js';
import type { ActivityDeps } from '../pipeline/activities.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', '..', 'tests', 'fixtures');
const fixture = (name: string) => readFileSync(join(fixtures, name));

/**
 * Build a fake `deps` whose `pool.connect()` returns a single recording client
 * (shared across all connect() calls so the activity's statements are inspectable
 * in order). The client records every `query(text, params)` so we can assert that
 * withTenant issued BEGIN → set_config('sim.tenant_id', tenantId) → the statement
 * → COMMIT, and has a `release()`.
 */
function makeFakeDeps(opts?: {
  selectRows?: unknown[];
  getBytes?: Buffer;
  ocrEndpoint?: string;
}) {
  const clientQuery = vi.fn().mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.includes('SELECT object_key')) {
      return Promise.resolve({ rows: opts?.selectRows ?? [{ object_key: 'tenant/docs/d1/raw' }] });
    }
    return Promise.resolve({ rows: [] });
  });
  const release = vi.fn();
  const client = { query: clientQuery, release };
  const connect = vi.fn().mockResolvedValue(client);

  const store = {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(opts?.getBytes ?? Buffer.from('raw content')),
    delete: vi.fn(),
  };

  const deps = {
    pool: { connect } as unknown as import('pg').Pool,
    store,
    ocrEndpoint: opts?.ocrEndpoint ?? 'http://ocr-mock',
  } satisfies ActivityDeps;

  return { deps, clientQuery, release, connect, store };
}

function clientSql(clientQuery: ReturnType<typeof vi.fn>): string[] {
  return clientQuery.mock.calls.map((c) => c[0] as string);
}

const FHIR_BYTES = Buffer.from('{"resourceType":"Patient","id":"p1"}');

describe('Document pipeline activities (factory)', () => {
  it('virusScan marks the document clean under withTenant', async () => {
    const { deps, clientQuery } = makeFakeDeps();
    const acts = makeActivities(deps);
    await acts.virusScan('doc-1', 'tenant-dev');

    const sqls = clientSql(clientQuery);
    const gucIdx = sqls.findIndex((s) => s.includes('set_config'));
    const updateIdx = sqls.findIndex((s) => s.includes("virus_scan_status = 'clean'"));
    expect(gucIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(gucIdx);
    // set_config carries the tenant id before the UPDATE runs.
    expect((clientQuery.mock.calls[gucIdx] as unknown[])[1]).toEqual(['tenant-dev']);
    // UPDATE ran on the withTenant client.
    expect((clientQuery.mock.calls[updateIdx] as unknown[])[1]).toEqual(['doc-1']);
  });

  describe('classifyDocument detects format from the stored bytes', () => {
    it('loads object_key (SELECT under withTenant), fetches bytes, and writes format=pdf', async () => {
      const { deps, clientQuery, store } = makeFakeDeps({ getBytes: fixture('sample.pdf') });
      const acts = makeActivities(deps);
      await acts.classifyDocument('doc-1', 'tenant-dev');

      const sqls = clientSql(clientQuery);
      const gucIdx = sqls.findIndex((s) => s.includes('set_config'));
      const selectIdx = sqls.findIndex((s) => s.includes('SELECT object_key'));
      const updateIdx = sqls.findIndex((s) => s.includes('classification'));
      expect(gucIdx).toBeGreaterThanOrEqual(0);
      expect(selectIdx).toBeGreaterThan(gucIdx);
      expect(updateIdx).toBeGreaterThan(selectIdx);
      expect(store.get).toHaveBeenCalledWith('tenant/docs/d1/raw');

      const classificationParam = JSON.parse(
        ((clientQuery.mock.calls[updateIdx] as unknown[])[1] as unknown[])[0] as string,
      ) as { format: string };
      expect(classificationParam.format).toBe('pdf');
    });

    it('writes format=c-cda for a C-CDA document', async () => {
      const { deps, clientQuery } = makeFakeDeps({ getBytes: fixture('sample-ccda.xml') });
      const acts = makeActivities(deps);
      await acts.classifyDocument('doc-1', 'tenant-dev');

      const sqls = clientSql(clientQuery);
      const updateIdx = sqls.findIndex((s) => s.includes('classification'));
      const classificationParam = JSON.parse(
        ((clientQuery.mock.calls[updateIdx] as unknown[])[1] as unknown[])[0] as string,
      ) as { format: string };
      expect(classificationParam.format).toBe('c-cda');
    });

    it('writes format=fhir-json for a FHIR JSON document', async () => {
      const { deps, clientQuery } = makeFakeDeps({ getBytes: FHIR_BYTES });
      const acts = makeActivities(deps);
      await acts.classifyDocument('doc-1', 'tenant-dev');

      const sqls = clientSql(clientQuery);
      const updateIdx = sqls.findIndex((s) => s.includes('classification'));
      const classificationParam = JSON.parse(
        ((clientQuery.mock.calls[updateIdx] as unknown[])[1] as unknown[])[0] as string,
      ) as { format: string };
      expect(classificationParam.format).toBe('fhir-json');
    });
  });

  describe('extractTextLayer persists real text + structured spans', () => {
    it('puts the EXTRACTED text (not raw bytes) and INSERTs ≥2 spans + UPDATE text_key', async () => {
      const pdfBytes = fixture('sample.pdf');
      const { deps, clientQuery, store } = makeFakeDeps({ getBytes: pdfBytes });
      const acts = makeActivities(deps);
      await acts.extractTextLayer('doc-1', 'tenant-dev');

      const sqls = clientSql(clientQuery);

      // SELECT object_key ran under a set_config.
      const selectIdx = sqls.findIndex((s) => s.includes('SELECT object_key'));
      const firstGucIdx = sqls.findIndex((s) => s.includes('set_config'));
      expect(firstGucIdx).toBeGreaterThanOrEqual(0);
      expect(selectIdx).toBeGreaterThan(firstGucIdx);

      // store.put received the EXTRACTED text — NOT the raw bytes.
      expect(store.put).toHaveBeenCalledTimes(1);
      const [putKey, putBuf] = store.put.mock.calls[0] as [string, Buffer];
      expect(putKey).toBe('tenant/docs/d1/raw/text');
      expect(putBuf.equals(pdfBytes)).toBe(false);
      // The extracted text is real page text, not the PDF magic bytes.
      expect(putBuf.subarray(0, 5).toString('latin1')).not.toBe('%PDF-');
      expect(putBuf.length).toBeGreaterThan(0);

      // ≥2 span INSERTs with page/text/excerpt_hash params.
      const insertCalls = clientQuery.mock.calls.filter((c) =>
        (c[0] as string).includes('INSERT INTO docs.document_span'),
      );
      expect(insertCalls.length).toBeGreaterThanOrEqual(2);
      for (const c of insertCalls) {
        const params = c[1] as unknown[];
        // (doc_id, tenant_id, seq, page, region, text, excerpt_hash)
        expect(params[0]).toBe('doc-1');
        expect(params[1]).toBe('tenant-dev');
        expect(typeof params[3]).toBe('number'); // page
        expect(typeof params[5]).toBe('string'); // text
        expect(String(params[6])).toMatch(/^sha256:/); // excerpt_hash
      }

      // idempotent re-extraction: DELETE before the INSERTs.
      const deleteIdx = sqls.findIndex((s) => s.includes('DELETE FROM docs.document_span'));
      const firstInsertIdx = sqls.findIndex((s) =>
        s.includes('INSERT INTO docs.document_span'),
      );
      expect(deleteIdx).toBeGreaterThanOrEqual(0);
      expect(firstInsertIdx).toBeGreaterThan(deleteIdx);

      // UPDATE text_key with the extraction_status.
      const updateIdx = sqls.findIndex((s) => s.includes('text_key'));
      expect(updateIdx).toBeGreaterThan(firstInsertIdx);
      const updateParams = clientQuery.mock.calls[updateIdx]![1] as unknown[];
      expect(updateParams[0]).toBe('tenant/docs/d1/raw/text');
      expect(updateParams[1]).toBe('extracted');
      expect(updateParams[2]).toBe('doc-1');
    });

    it('image-only PDF with no ocrEndpoint → needs_ocr, ZERO span INSERTs', async () => {
      const { deps, clientQuery, store } = makeFakeDeps({
        getBytes: fixture('image-only.pdf'),
        ocrEndpoint: '',
      });
      const acts = makeActivities(deps);
      await acts.extractTextLayer('doc-1', 'tenant-dev');

      const sqls = clientSql(clientQuery);

      // No span INSERTs at all.
      const insertCalls = clientQuery.mock.calls.filter((c) =>
        (c[0] as string).includes('INSERT INTO docs.document_span'),
      );
      expect(insertCalls.length).toBe(0);

      // store.put still ran (empty text is fine).
      expect(store.put).toHaveBeenCalledTimes(1);

      // The doc's extraction_status reflects needs_ocr.
      const updateIdx = sqls.findIndex((s) => s.includes('text_key'));
      const updateParams = clientQuery.mock.calls[updateIdx]![1] as unknown[];
      expect(updateParams[1]).toBe('needs_ocr');
    });

    it('does not throw on extraction failure (completes the activity)', async () => {
      // "other" / unsupported bytes -> extractSpans returns unsupported, no throw.
      const { deps, clientQuery } = makeFakeDeps({
        getBytes: Buffer.from('hello world, not a known format'),
        ocrEndpoint: '',
      });
      const acts = makeActivities(deps);
      await expect(acts.extractTextLayer('doc-1', 'tenant-dev')).resolves.toBeUndefined();

      const insertCalls = clientQuery.mock.calls.filter((c) =>
        (c[0] as string).includes('INSERT INTO docs.document_span'),
      );
      expect(insertCalls.length).toBe(0);
      const sqls = clientSql(clientQuery);
      const updateIdx = sqls.findIndex((s) => s.includes('text_key'));
      const updateParams = clientQuery.mock.calls[updateIdx]![1] as unknown[];
      expect(updateParams[1]).toBe('unsupported');
    });
  });

  it('extractTextLayer throws when the document is not found', async () => {
    const { deps } = makeFakeDeps({ selectRows: [] });
    const acts = makeActivities(deps);
    await expect(acts.extractTextLayer('missing', 'tenant-dev')).rejects.toThrow(
      'Document not found: missing',
    );
  });

  it('emitDocumentReady writes the canonical 5-column envelope inside withTenant — no bare lookup, no payload column', async () => {
    const { deps, clientQuery, release } = makeFakeDeps();
    const acts = makeActivities(deps);
    await acts.emitDocumentReady('doc-1', 'tenant-dev');

    const sqls = clientSql(clientQuery);

    // The bare `SELECT tenant_id` lookup is gone.
    expect(sqls.some((s) => s.includes('SELECT tenant_id'))).toBe(false);

    // GUC (set_config) is set before any INSERT.
    const gucIdx = sqls.findIndex((s) => s.includes('set_config'));
    const insertIdx = sqls.findIndex((s) => s.includes('INSERT INTO shared.outbox'));
    expect(gucIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(gucIdx);
    // set_config carries the tenant id threaded as the activity arg.
    expect((clientQuery.mock.calls[gucIdx] as unknown[])[1]).toEqual(['tenant-dev']);

    const insertCall = clientQuery.mock.calls[insertIdx] as unknown[];
    const insertSql = insertCall[0] as string;
    // canonical 5-column shape, no phantom payload column.
    expect(insertSql).toContain('(event_id, topic, key, envelope, tenant_id)');
    expect(insertSql).not.toMatch(/\bpayload\b/);

    const params = insertCall[1] as unknown[];
    expect(params[1]).toBe('sim.evidence'); // topic
    expect(params[4]).toBe('tenant-dev'); // tenant_id
    const envelope = JSON.parse(params[3] as string) as Record<string, unknown>;
    expect(envelope['schema_ref']).toBe('sim.evidence/DocumentReady/v1');
    expect(envelope['payload']).toEqual({ kind: 'document', doc_id: 'doc-1' });
    expect(release).toHaveBeenCalled();
  });
});
