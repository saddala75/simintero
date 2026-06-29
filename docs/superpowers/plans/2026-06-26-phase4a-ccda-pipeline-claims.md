# Phase 4A — C-CDA Pipeline + Claims State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add C-CDA ingestion to the Revital pipeline and wire the claims service with a documentation-request flow, internal attachment callbacks, and an evidence endpoint — the C-CDA extraction side of CMS-0053-F.

**Architecture:** A new `parseCcda` Temporal activity fetches raw C-CDA XML from the document service's existing `/documents/:id/span` endpoint, parses it with `fast-xml-parser`, and emits a `SpanMap` identical in shape to `parseSegment`'s output. The `RevitalAnalyzeCase` workflow routes to `parseCcda` vs `parseSegment` based on a new `document_format` field. The claims service grows three new route files: a `documentation-request` route that emits a `claims.attachment.requested` outbox event, `internal` callback routes called by the Phase 4B interop hub when a 275 attachment arrives or is rejected, and an `evidence` route that queries `revital.analysis` to surface the Revital advisory to the reviewer.

**Tech Stack:** TypeScript, Vitest, Temporal, `fast-xml-parser`, PostgreSQL (Flyway migrations), Express, `supertest`

## Global Constraints

- All migrations go in `platform/services/db-migrations/migrations/` with naming `Vxxx__name.sql`; next available is V033 and V034.
- `revital.analysis` INSERT column list must match V033 migration exactly — include `advisory_type` in both the column list and the `$N` values.
- The `parseCcda` activity must export both `parseCcda` (the Temporal-wired version) and `parseCcdaImpl` (the testable pure function), following the pattern in `fetchDocuments.ts` and `parseSegment.ts`.
- Document service raw bytes are at `GET /documents/:docId/span` (returns `application/octet-stream`) — NOT `/raw`.
- `source_channel` for a C-CDA attachment from interop will be `'x12_275'` or `'fhir_document_reference'`; the document service already accepts both.
- `documentation_status` valid values: `'not_requested' | 'requested' | 'received' | 'rejected'`.
- `advisory_type` valid values: `'pa' | 'claims_attachment'`.
- Internal callback routes use no auth — they are only reachable from within the cluster. Mount at `/v1/internal/...`.
- Revital pipeline runs at `REVITAL_SERVICE_URL` (env var, default `http://localhost:3050`).
- Test runner: `vitest run` in each package directory. Never skip tests.
- `fast-xml-parser` version `^4.4.0` (matches the version in `platform/services/document/package.json`).
- Commit every task separately with message ending `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: `parseCcda` activity

**Files:**
- Create: `modules/revital/pipeline/src/activities/parseCcda.ts`
- Create: `modules/revital/pipeline/src/activities/__tests__/parseCcda.test.ts`
- Modify: `modules/revital/pipeline/package.json` (add `fast-xml-parser`)

**Interfaces:**
- Consumes: `DocMeta` from `./fetchDocuments.js` — `{ doc_id: string, virus_scan_status: string, text_key: string | null, object_key: string }`
- Consumes: `SpanMap`, `Span` from `./parseSegment.js` — `SpanMap = Record<string, Span[]>`, `Span = { page: number, region: [number, number, number, number], text: string, hash: string }`
- Produces: `parseCcdaImpl(docs, docServiceUrl, tenantId): Promise<SpanMap>` and `parseCcda(docs, tenantId): Promise<SpanMap>`

- [ ] **Step 1: Add `fast-xml-parser` to revital pipeline**

Edit `modules/revital/pipeline/package.json` — add to `"dependencies"`:
```json
"fast-xml-parser": "^4.4.0"
```

Run:
```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
pnpm install
```
Expected: `fast-xml-parser` resolved under `modules/revital/pipeline/node_modules`.

- [ ] **Step 2: Write the failing test**

Create `modules/revital/pipeline/src/activities/__tests__/parseCcda.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseCcdaImpl } from '../parseCcda.js';
import type { DocMeta } from '../fetchDocuments.js';

afterEach(() => vi.restoreAllMocks());

const SAMPLE_CCDA = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <component>
    <structuredBody>
      <component>
        <section>
          <code code="11506-3" displayName="Progress Notes"/>
          <text>Patient presented with knee pain.</text>
          <entry>
            <observation>
              <code displayName="Knee Pain"/>
              <value>#text="Severe bilateral knee pain, onset 3 months ago"</value>
            </observation>
          </entry>
          <entry>
            <observation>
              <code displayName="Vital Signs"/>
              <value>#text="BP 120/80, HR 72"</value>
            </observation>
          </entry>
        </section>
      </component>
    </structuredBody>
  </component>
</ClinicalDocument>`;

function makeFetch(body: string, ok = true) {
  return vi.fn(async (_url: string, _opts: unknown) => ({
    ok,
    text: async () => body,
    status: ok ? 200 : 500,
  }));
}

describe('parseCcdaImpl', () => {
  it('returns spans from C-CDA entry elements', async () => {
    vi.stubGlobal('fetch', makeFetch(SAMPLE_CCDA));
    const doc: DocMeta = { doc_id: 'd1', virus_scan_status: 'clean', text_key: null, object_key: 'k1' };
    const result = await parseCcdaImpl([doc], 'http://doc:4070', 'tenant-dev');
    expect(result['d1']).toBeDefined();
    expect(result['d1']!.length).toBeGreaterThan(0);
    result['d1']!.forEach(span => {
      expect(span).toHaveProperty('page', 0);
      expect(span).toHaveProperty('region');
      expect(span.region).toHaveLength(4);
      expect(typeof span.text).toBe('string');
      expect(span.text.length).toBeGreaterThan(0);
      expect(typeof span.hash).toBe('string');
      expect(span.hash).toHaveLength(64); // sha256 hex
    });
  });

  it('sends x-sim-tenant-id header to document service', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: { headers: Record<string, string> }) => {
      calls.push({ url, headers: opts?.headers ?? {} });
      return { ok: true, text: async () => SAMPLE_CCDA };
    }));
    const doc: DocMeta = { doc_id: 'doc-x', virus_scan_status: 'clean', text_key: null, object_key: 'k' };
    await parseCcdaImpl([doc], 'http://doc:4070', 'tenant-abc');
    expect(calls[0]?.url).toBe('http://doc:4070/documents/doc-x/span');
    expect(calls[0]?.headers['x-sim-tenant-id']).toBe('tenant-abc');
  });

  it('returns empty spans on non-ok response', async () => {
    vi.stubGlobal('fetch', makeFetch('', false));
    const doc: DocMeta = { doc_id: 'd2', virus_scan_status: 'clean', text_key: null, object_key: 'k2' };
    const result = await parseCcdaImpl([doc], 'http://doc:4070', 'tenant-dev');
    expect(result['d2']).toEqual([]);
  });

  it('returns empty spans on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network error'); }));
    const doc: DocMeta = { doc_id: 'd3', virus_scan_status: 'clean', text_key: null, object_key: 'k3' };
    const result = await parseCcdaImpl([doc], 'http://doc:4070', 'tenant-dev');
    expect(result['d3']).toEqual([]);
  });

  it('hash is deterministic for the same text', async () => {
    vi.stubGlobal('fetch', makeFetch(SAMPLE_CCDA));
    const doc: DocMeta = { doc_id: 'd4', virus_scan_status: 'clean', text_key: null, object_key: 'k4' };
    const r1 = await parseCcdaImpl([doc], 'http://doc:4070', 'tenant-dev');
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', makeFetch(SAMPLE_CCDA));
    const r2 = await parseCcdaImpl([{ ...doc, doc_id: 'd4' }], 'http://doc:4070', 'tenant-dev');
    expect(r1['d4']!.map(s => s.hash)).toEqual(r2['d4']!.map(s => s.hash));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/modules/revital/pipeline
pnpm test -- --reporter=verbose 2>&1 | grep -E "parseCcda|FAIL|Cannot find"
```
Expected: FAIL with "Cannot find module '../parseCcda.js'"

- [ ] **Step 4: Implement `parseCcda.ts`**

Create `modules/revital/pipeline/src/activities/parseCcda.ts`:
```typescript
import { XMLParser } from 'fast-xml-parser'
import crypto from 'node:crypto'
import type { DocMeta } from './fetchDocuments.js'
import type { SpanMap, Span } from './parseSegment.js'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (_name, _jpath, _isLeafNode, isAttribute) => !isAttribute,
})

function extractText(node: unknown): string {
  if (typeof node === 'string') return node.trim()
  if (typeof node !== 'object' || node === null) return ''
  const n = node as Record<string, unknown>
  const obs = n['observation'] ?? n['act'] ?? n['procedure'] ?? n['substanceAdministration']
  if (obs) {
    const inner = Array.isArray(obs) ? obs[0] : obs
    if (typeof inner === 'object' && inner !== null) {
      const o = inner as Record<string, unknown>
      const codeDisplay = (o['code'] as Record<string, string> | undefined)?.['@_displayName'] ?? ''
      const valueArr = o['value']
      const valueEl = Array.isArray(valueArr) ? valueArr[0] : valueArr
      const valueText = (valueEl as Record<string, string> | undefined)?.['#text'] ?? ''
      return [codeDisplay, valueText].filter(Boolean).join(': ')
    }
  }
  const textField = n['#text']
  if (typeof textField === 'string') return textField.trim()
  return ''
}

function toSpan(text: string): Span {
  return {
    page: 0,
    region: [0, 0, 0, 0],
    text,
    hash: crypto.createHash('sha256').update(text).digest('hex'),
  }
}

export async function parseCcdaImpl(
  docs: DocMeta[],
  docServiceUrl: string,
  tenantId: string,
): Promise<SpanMap> {
  const spanMap: SpanMap = {}

  for (const doc of docs) {
    try {
      const res = await fetch(`${docServiceUrl}/documents/${doc.doc_id}/span`, {
        headers: { 'x-sim-tenant-id': tenantId },
      })
      if (!res.ok) { spanMap[doc.doc_id] = []; continue }
      const xml = await res.text()
      spanMap[doc.doc_id] = extractSpans(xml)
    } catch {
      spanMap[doc.doc_id] = []
    }
  }
  return spanMap
}

function extractSpans(xml: string): Span[] {
  let root: unknown
  try {
    root = xmlParser.parse(xml)
  } catch {
    return []
  }

  const spans: Span[] = []
  const body = (root as Record<string, unknown>)?.['ClinicalDocument']
  if (!body) return spans

  // Walk all component/section/entry elements regardless of namespace nesting
  const docEl = body as Record<string, unknown>
  const topComponent = docEl['component']
  if (!topComponent) return spans

  const topArr = Array.isArray(topComponent) ? topComponent : [topComponent]
  for (const top of topArr) {
    const structuredBody = (top as Record<string, unknown>)['structuredBody']
    if (!structuredBody) continue
    const sb = structuredBody as Record<string, unknown>
    const sectionComponents = sb['component']
    if (!sectionComponents) continue
    const comps = Array.isArray(sectionComponents) ? sectionComponents : [sectionComponents]
    for (const comp of comps) {
      const section = (comp as Record<string, unknown>)['section']
      if (!section) continue
      const s = (Array.isArray(section) ? section[0] : section) as Record<string, unknown>

      // Include section narrative text
      const narrative = s['text']
      const narrativeText = Array.isArray(narrative)
        ? (narrative[0] as Record<string, string>)?.['#text'] ?? ''
        : typeof narrative === 'string' ? narrative : ''
      if (narrativeText.trim()) spans.push(toSpan(narrativeText.trim()))

      // Include individual entries
      const entries = s['entry']
      if (!entries) continue
      const entryArr = Array.isArray(entries) ? entries : [entries]
      for (const entry of entryArr) {
        const text = extractText(entry)
        if (text) spans.push(toSpan(text))
      }
    }
  }
  return spans
}

const DOC_SERVICE_URL = process.env['DOCUMENT_SERVICE_URL'] ?? 'http://localhost:4070'

export async function parseCcda(docs: DocMeta[], tenantId: string): Promise<SpanMap> {
  return parseCcdaImpl(docs, DOC_SERVICE_URL, tenantId)
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/modules/revital/pipeline
pnpm test -- --reporter=verbose 2>&1 | grep -E "parseCcda|PASS|FAIL|✓|×"
```
Expected: 5 tests passing for `parseCcda`, all other existing tests still green.

- [ ] **Step 6: Commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
git add modules/revital/pipeline/src/activities/parseCcda.ts \
        modules/revital/pipeline/src/activities/__tests__/parseCcda.test.ts \
        modules/revital/pipeline/package.json \
        pnpm-lock.yaml
git commit -m "feat(revital): add parseCcda activity for C-CDA XML ingestion

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Workflow routing + `advisory_type` + V033 migration

**Files:**
- Modify: `modules/revital/pipeline/src/workflows/RevitalAnalyzeCase.ts`
- Modify: `modules/revital/pipeline/src/activities/persistAdvisory.ts`
- Modify: `modules/revital/pipeline/src/activities/index.ts`
- Modify: `modules/revital/pipeline/src/routes/analyses.ts`
- Create: `platform/services/db-migrations/migrations/V033__revital_advisory_type.sql`

**Interfaces:**
- Consumes: `parseCcda(docs, tenantId): Promise<SpanMap>` from Task 1
- Produces:
  - `AnalysisInput` extended with `document_format?: 'pdf' | 'ccda'`
  - `PersistInput` extended with `advisory_type: 'pa' | 'claims_attachment'`
  - `POST /v1/assist/analyses` body now accepts `document_format?: 'pdf' | 'ccda'`

- [ ] **Step 1: Write the failing test for analyses route `document_format` pass-through**

Add test to `modules/revital/pipeline/src/routes/__tests__/analyses.test.ts` (create if not exists):
```typescript
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
```

Run: `cd modules/revital/pipeline && pnpm test 2>&1 | grep -E "document_format|FAIL"`
Expected: FAIL — `temporal.start` called without `document_format` in current code.

- [ ] **Step 2: Create V033 migration**

Create `platform/services/db-migrations/migrations/V033__revital_advisory_type.sql`:
```sql
-- V033: Add advisory_type to revital.analysis to distinguish PA vs claims-attachment advisories
ALTER TABLE revital.analysis
  ADD COLUMN advisory_type TEXT NOT NULL DEFAULT 'pa'
    CHECK (advisory_type IN ('pa', 'claims_attachment'));

CREATE INDEX revital_analysis_advisory_type_idx ON revital.analysis (tenant_id, advisory_type, case_ref);
```

- [ ] **Step 3: Update `persistAdvisory.ts` — add `advisory_type` to PersistInput and INSERT**

Replace the `PersistInput` interface and INSERT query in `modules/revital/pipeline/src/activities/persistAdvisory.ts`:

Change `PersistInput` — add field after `unprocessed`:
```typescript
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
  advisory_type: 'pa' | 'claims_attachment';
}
```

Change the INSERT statement in `persistAdvisoryImpl` — add `advisory_type` to column list and values:
```typescript
    await client.query(
      `INSERT INTO revital.analysis
         (analysis_id, tenant_id, case_ref, status, interaction, summary, extraction,
          completeness, triage, abstentions, unprocessed_inputs, completed_at, advisory_type)
       VALUES ($1, current_setting('sim.tenant_id', true), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (analysis_id) DO UPDATE SET
         status = EXCLUDED.status,
         summary = EXCLUDED.summary,
         extraction = EXCLUDED.extraction,
         completeness = EXCLUDED.completeness,
         triage = EXCLUDED.triage,
         abstentions = EXCLUDED.abstentions,
         unprocessed_inputs = EXCLUDED.unprocessed_inputs,
         completed_at = EXCLUDED.completed_at,
         advisory_type = EXCLUDED.advisory_type`,
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
        input.advisory_type,
      ],
    );
```

- [ ] **Step 4: Update `RevitalAnalyzeCase.ts` — add `document_format` routing and `advisory_type` in persistAdvisory call**

Full replacement of `modules/revital/pipeline/src/workflows/RevitalAnalyzeCase.ts`:
```typescript
import {
  proxyActivities,
  defineSignal,
  setHandler,
} from '@temporalio/workflow';
import type * as activities from '../activities/index.js';

export interface AnalysisInput {
  analysis_id: string;
  tenant_id: string;
  case_ref: string;
  document_refs: string[];
  member_ref?: string | undefined;
  service_code?: string | undefined;
  model_binding_ref: string;
  model_binding_version: string;
  prompt_ref: string;
  prompt_version: string;
  cell_boundary: 'pooled' | 'dedicated' | 'enclave';
  document_format?: 'pdf' | 'ccda';
}

export interface AnalysisOutput {
  analysis_id: string;
  status: 'complete' | 'partial' | 'failed';
}

const {
  fetchDocuments,
  parseSegment,
  parseCcda,
  extractEntities,
  fetchEvidenceRequirements,
  mapEvidenceToCriteria,
  summarizeGrounded,
  triageAdvise,
  persistAdvisory,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3 },
});

export const analysisCompleteSignal = defineSignal<[{ analysis_id: string }]>(
  'analysis_complete',
);

export async function revitalAnalyzeCase(input: AnalysisInput): Promise<AnalysisOutput> {
  const unprocessed: Array<{ ref: string; reason: string }> = [];
  let status: 'complete' | 'partial' | 'failed' = 'complete';

  const docs = await fetchDocuments(input.document_refs, unprocessed, input.tenant_id).catch(
    () => { status = 'partial'; return []; }
  );

  const parseActivity = input.document_format === 'ccda' ? parseCcda : parseSegment;

  const spans = docs.length > 0
    ? await parseActivity(docs, input.tenant_id).catch(() => { status = 'partial'; return {}; })
    : {};

  const extracted = await extractEntities(spans, input).catch(
    () => { status = 'partial'; return null; }
  );

  const requirements = input.service_code
    ? await fetchEvidenceRequirements(input.service_code).catch(() => null)
    : null;

  const completenessResult = extracted && requirements
    ? await mapEvidenceToCriteria(extracted, requirements).catch(
        () => { status = 'partial'; return null; }
      )
    : null;

  const summaryResult = Object.keys(spans as object).length > 0
    ? await summarizeGrounded(spans, completenessResult, input).catch(
        () => { status = 'partial'; return null; }
      )
    : null;

  const triageResult = summaryResult
    ? await triageAdvise(summaryResult, completenessResult, input).catch(
        () => { status = 'partial'; return null; }
      )
    : null;

  await persistAdvisory({
    analysis_id: input.analysis_id,
    tenant_id: input.tenant_id,
    case_ref: input.case_ref,
    document_refs: input.document_refs,
    member_ref: input.member_ref,
    model_binding_ref: input.model_binding_ref,
    model_binding_version: input.model_binding_version,
    prompt_ref: input.prompt_ref,
    prompt_version: input.prompt_version,
    status,
    summary: summaryResult,
    extraction: extracted,
    completeness: completenessResult,
    triage: triageResult,
    unprocessed,
    advisory_type: input.document_format === 'ccda' ? 'claims_attachment' : 'pa',
  });

  return { analysis_id: input.analysis_id, status };
}
```

- [ ] **Step 5: Update `activities/index.ts` — export `parseCcda`**

Replace `modules/revital/pipeline/src/activities/index.ts`:
```typescript
export { fetchDocuments } from './fetchDocuments.js';
export { parseSegment } from './parseSegment.js';
export { parseCcda } from './parseCcda.js';
export { extractEntities } from './extractEntities.js';
export { fetchEvidenceRequirements } from './fetchEvidenceRequirements.js';
export { mapEvidenceToCriteria } from './mapEvidenceToCriteria.js';
export { summarizeGrounded } from './summarizeGrounded.js';
export { triageAdvise } from './triageAdvise.js';
export { persistAdvisory } from './persistAdvisory.js';
```

- [ ] **Step 6: Update `analyses.ts` route — accept and pass `document_format`**

In `modules/revital/pipeline/src/routes/analyses.ts`, change the `router.post('/v1/assist/analyses', ...)` handler:

After the existing destructuring of `req.body`:
```typescript
      const { case_ref, inputs, analysis_kinds, document_format } = req.body as {
        case_ref: string;
        analysis_kinds: string[];
        inputs: { document_refs: string[]; case_context: Record<string, unknown> };
        document_format?: 'pdf' | 'ccda';
      };
```

And in the Temporal `start` call args, add `document_format`:
```typescript
        args: [{
          analysis_id: analysisId,
          tenant_id: tenantId,
          case_ref,
          document_refs: inputs.document_refs,
          member_ref,
          service_code,
          model_binding_ref: process.env['DEFAULT_MODEL_BINDING'] ?? 'https://artifacts.simintero.io/shared/model_binding/claude-pa',
          model_binding_version: process.env['DEFAULT_MODEL_BINDING_VERSION'] ?? '1.0.0',
          prompt_ref: process.env['DEFAULT_PROMPT'] ?? 'https://artifacts.simintero.io/shared/prompt/pa-review',
          prompt_version: '1.0.0',
          cell_boundary: 'pooled',
          document_format: document_format ?? 'pdf',
        }],
```

- [ ] **Step 7: Run all tests**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/modules/revital/pipeline
pnpm test -- --reporter=verbose 2>&1 | tail -20
```
Expected: All tests green including the 2 new `document_format` tests.

- [ ] **Step 8: Typecheck**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/modules/revital/pipeline
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
git add modules/revital/pipeline/src/workflows/RevitalAnalyzeCase.ts \
        modules/revital/pipeline/src/activities/persistAdvisory.ts \
        modules/revital/pipeline/src/activities/index.ts \
        modules/revital/pipeline/src/routes/analyses.ts \
        modules/revital/pipeline/src/routes/__tests__/analyses.test.ts \
        platform/services/db-migrations/migrations/V033__revital_advisory_type.sql
git commit -m "feat(revital): add document_format routing and advisory_type classification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Claims V034 migration + documentation-request route

**Files:**
- Create: `platform/services/db-migrations/migrations/V034__claims_documentation_status.sql`
- Create: `modules/claims/service/src/routes/documentationRequest.ts`
- Create: `modules/claims/service/src/__tests__/documentationRequest.test.ts`

**Interfaces:**
- Produces:
  - `POST /v1/claims/:caseRef/documentation-request` body: `{ loinc_codes: string[] }`
  - Response 200: `{ claim_id: string, documentation_status: 'requested' }`
  - Emits outbox event `topic: 'claims.attachment.requested'`

- [ ] **Step 1: Create V034 migration**

Create `platform/services/db-migrations/migrations/V034__claims_documentation_status.sql`:
```sql
-- V034: Add documentation tracking columns to claims.claim for CMS-0053-F attachment workflow
ALTER TABLE claims.claim
  ADD COLUMN documentation_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (documentation_status IN ('not_requested', 'requested', 'received', 'rejected')),
  ADD COLUMN rfai_doc_id TEXT;
```

- [ ] **Step 2: Write the failing test**

Create `modules/claims/service/src/__tests__/documentationRequest.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildDocumentationRequestRouter } from '../routes/documentationRequest.js';

function makePool(responses: Array<{ rows: unknown[] }> = []) {
  let i = 0;
  const client = {
    query: vi.fn().mockImplementation(() => Promise.resolve({ rows: [] })),
    release: vi.fn(),
  };
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })),
    connect: vi.fn().mockResolvedValue(client),
    _client: client,
  } as any;
}

function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/', buildDocumentationRequestRouter(pool));
  return app;
}

describe('POST /:caseRef/documentation-request', () => {
  it('returns 401 when x-sim-tenant-id header is missing', async () => {
    const pool = makePool();
    const res = await supertest(makeApp(pool))
      .post('/case-001/documentation-request')
      .send({ loinc_codes: ['11506-3'] });
    expect(res.status).toBe(401);
  });

  it('returns 400 when loinc_codes is missing or empty', async () => {
    const pool = makePool();
    const res = await supertest(makeApp(pool))
      .post('/case-001/documentation-request')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/loinc_codes/);
  });

  it('returns 404 when claim is not found for the tenant', async () => {
    const pool = makePool([{ rows: [] }]); // UPDATE returns 0 rows
    const res = await supertest(makeApp(pool))
      .post('/case-001/documentation-request')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ loinc_codes: ['11506-3'] });
    expect(res.status).toBe(404);
  });

  it('returns 200 and emits outbox event on valid request', async () => {
    const pool = makePool([
      { rows: [{ claim_id: 'CLM_001', documentation_status: 'requested' }] }, // UPDATE RETURNING
    ]);
    const res = await supertest(makeApp(pool))
      .post('/case-001/documentation-request')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ loinc_codes: ['11506-3', '18842-5'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ claim_id: 'CLM_001', documentation_status: 'requested' });
    // Verify outbox INSERT was called via pooled client
    expect(pool.connect).toHaveBeenCalled();
    const sqls = pool._client.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls.some((s: string) => s.includes('shared.outbox'))).toBe(true);
  });
});
```

Run: `cd modules/claims/service && pnpm test 2>&1 | grep -E "documentationRequest|FAIL|Cannot find"`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `documentationRequest.ts`**

Create `modules/claims/service/src/routes/documentationRequest.ts`:
```typescript
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

    const { rows } = await pool.query<{ claim_id: string; documentation_status: string }>(
      `UPDATE claims.claim
         SET documentation_status = 'requested'
       WHERE case_id = $1::uuid
         AND tenant_id = $2
         AND documentation_status = 'not_requested'
       RETURNING claim_id, documentation_status`,
      [caseRef, tenantId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Claim not found or documentation already requested' });
    }

    const { claim_id } = rows[0]!;

    await withTenant(pool, tenantId, (client) =>
      appendEvent(client, {
        topic: 'claims.attachment.requested',
        schemaRef: 'claims.attachment.requested/v1',
        tenantId,
        payload: {
          claim_id,
          case_ref: caseRef,
          loinc_codes,
        },
        correlationId: claim_id,
      }),
    );

    return res.status(200).json({ claim_id, documentation_status: 'requested' });
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/modules/claims/service
pnpm test -- --reporter=verbose 2>&1 | tail -20
```
Expected: 4 new tests passing, all existing tests still green.

- [ ] **Step 5: Commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
git add platform/services/db-migrations/migrations/V034__claims_documentation_status.sql \
        modules/claims/service/src/routes/documentationRequest.ts \
        modules/claims/service/src/__tests__/documentationRequest.test.ts
git commit -m "feat(claims): add documentation-request route and V034 migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Claims internal callback routes

**Files:**
- Create: `modules/claims/service/src/routes/internal.ts`
- Create: `modules/claims/service/src/__tests__/internal.test.ts`

**Interfaces:**
- Produces:
  - `POST /v1/internal/attachment-received` body: `{ claim_id: string, case_ref: string, doc_id: string, tenant_id: string, loinc_codes: string[] }` → 200 `{ ok: true }`
  - `POST /v1/internal/attachment-rejected` body: `{ claim_id: string, tenant_id: string, reason: string }` → 200 `{ ok: true }`
- These routes call Revital `POST /v1/assist/analyses` on `attachment-received`.

- [ ] **Step 1: Write the failing tests**

Create `modules/claims/service/src/__tests__/internal.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildInternalRouter } from '../routes/internal.js';

function makePool(responses: Array<{ rows: unknown[] }> = []) {
  let i = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })),
  } as any;
}

function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/v1/internal', buildInternalRouter(pool));
  return app;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ analysis_id: 'ana_001', operation: '/v1/operations/ana_001' }),
    status: 202,
  })));
});

afterEach(() => vi.restoreAllMocks());

describe('POST /v1/internal/attachment-received', () => {
  it('returns 400 when required fields are missing', async () => {
    const pool = makePool();
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/attachment-received')
      .send({ claim_id: 'CLM_001' }); // missing case_ref, doc_id, tenant_id
    expect(res.status).toBe(400);
  });

  it('updates documentation_status to received and triggers Revital', async () => {
    const pool = makePool([{ rows: [{ claim_id: 'CLM_001' }] }]);
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/attachment-received')
      .send({
        claim_id: 'CLM_001',
        case_ref: 'case-uuid-001',
        doc_id: 'doc-uuid-001',
        tenant_id: 'tenant-dev',
        loinc_codes: ['11506-3'],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Verify fetch was called to Revital
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/v1/assist/analyses'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns 404 when claim not found', async () => {
    const pool = makePool([{ rows: [] }]);
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/attachment-received')
      .send({
        claim_id: 'CLM_MISSING',
        case_ref: 'case-uuid-001',
        doc_id: 'doc-uuid-001',
        tenant_id: 'tenant-dev',
        loinc_codes: ['11506-3'],
      });
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/internal/attachment-rejected', () => {
  it('returns 400 when required fields are missing', async () => {
    const pool = makePool();
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/attachment-rejected')
      .send({ claim_id: 'CLM_001' }); // missing tenant_id, reason
    expect(res.status).toBe(400);
  });

  it('updates documentation_status to rejected', async () => {
    const pool = makePool([{ rows: [{ claim_id: 'CLM_001' }] }]);
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/attachment-rejected')
      .send({
        claim_id: 'CLM_001',
        tenant_id: 'tenant-dev',
        reason: 'SIG_INVALID',
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("documentation_status = 'rejected'"),
      expect.arrayContaining(['CLM_001', 'tenant-dev']),
    );
  });
});
```

Run: `cd modules/claims/service && pnpm test 2>&1 | grep -E "internal|Cannot find|FAIL"`
Expected: FAIL with "Cannot find module"

- [ ] **Step 2: Implement `internal.ts`**

Create `modules/claims/service/src/routes/internal.ts`:
```typescript
import express from 'express';
import type { Pool } from 'pg';

const REVITAL_SERVICE_URL = process.env['REVITAL_SERVICE_URL'] ?? 'http://localhost:3050';

export function buildInternalRouter(pool: Pool): express.Router {
  const router = express.Router();

  router.post('/attachment-received', async (req, res) => {
    const { claim_id, case_ref, doc_id, tenant_id, loinc_codes } =
      req.body as Record<string, unknown>;

    if (!claim_id || !case_ref || !doc_id || !tenant_id || !Array.isArray(loinc_codes)) {
      return res.status(400).json({
        error: 'Required: claim_id, case_ref, doc_id, tenant_id, loinc_codes[]',
      });
    }

    const { rows } = await pool.query<{ claim_id: string }>(
      `UPDATE claims.claim
         SET documentation_status = 'received', rfai_doc_id = $1
       WHERE claim_id = $2
         AND tenant_id = $3
       RETURNING claim_id`,
      [doc_id, claim_id, tenant_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    // Trigger Revital extraction — fire and forget; caller does not wait for completion
    fetch(`${REVITAL_SERVICE_URL}/v1/assist/analyses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sim-tenant-id': tenant_id as string,
      },
      body: JSON.stringify({
        case_ref,
        inputs: {
          document_refs: [doc_id],
          case_context: { loinc_codes },
        },
        analysis_kinds: ['claims_attachment'],
        document_format: 'ccda',
      }),
    }).catch((err: unknown) => {
      console.error('[claims/internal] revital trigger failed', err);
    });

    return res.status(200).json({ ok: true });
  });

  router.post('/attachment-rejected', async (req, res) => {
    const { claim_id, tenant_id, reason } = req.body as Record<string, unknown>;

    if (!claim_id || !tenant_id || !reason) {
      return res.status(400).json({ error: 'Required: claim_id, tenant_id, reason' });
    }

    const { rows } = await pool.query<{ claim_id: string }>(
      `UPDATE claims.claim
         SET documentation_status = 'rejected'
       WHERE claim_id = $1
         AND tenant_id = $2
       RETURNING claim_id`,
      [claim_id, tenant_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    return res.status(200).json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/modules/claims/service
pnpm test -- --reporter=verbose 2>&1 | tail -20
```
Expected: All internal tests green, all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
git add modules/claims/service/src/routes/internal.ts \
        modules/claims/service/src/__tests__/internal.test.ts
git commit -m "feat(claims): add internal attachment-received and attachment-rejected routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Claims evidence route + app.ts wiring

**Files:**
- Create: `modules/claims/service/src/routes/evidence.ts`
- Create: `modules/claims/service/src/__tests__/evidence.test.ts`
- Modify: `modules/claims/service/src/app.ts`

**Interfaces:**
- Consumes:
  - `buildDocumentationRequestRouter(pool): Router` from Task 3
  - `buildInternalRouter(pool): Router` from Task 4
- Produces:
  - `GET /v1/claims/:caseRef/evidence` — response shape:
    ```typescript
    {
      claim_id: string;
      documentation_status: string;
      rfai_doc_id: string | null;
      advisory: {
        analysis_id: string;
        advisory_type: string;
        status: string;
        summary: unknown;
        extraction: unknown;
        completeness: unknown;
        triage: unknown;
      } | null;
    }
    ```

- [ ] **Step 1: Write the failing test**

Create `modules/claims/service/src/__tests__/evidence.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildEvidenceRouter } from '../routes/evidence.js';

function makePool(responses: Array<{ rows: unknown[] }>) {
  let i = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })),
  } as any;
}

function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/', buildEvidenceRouter(pool));
  return app;
}

describe('GET /:caseRef/evidence', () => {
  it('returns 401 when x-sim-tenant-id is missing', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool)).get('/case-001/evidence');
    expect(res.status).toBe(401);
  });

  it('returns 404 when claim is not found', async () => {
    const pool = makePool([{ rows: [] }]);
    const res = await supertest(makeApp(pool))
      .get('/case-001/evidence')
      .set('x-sim-tenant-id', 'tenant-dev');
    expect(res.status).toBe(404);
  });

  it('returns evidence with null advisory when extraction not yet complete', async () => {
    const pool = makePool([
      {
        rows: [{
          claim_id: 'CLM_001',
          documentation_status: 'received',
          rfai_doc_id: 'doc-001',
        }],
      },
      { rows: [] }, // no advisory yet
    ]);
    const res = await supertest(makeApp(pool))
      .get('/case-001/evidence')
      .set('x-sim-tenant-id', 'tenant-dev');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      claim_id: 'CLM_001',
      documentation_status: 'received',
      rfai_doc_id: 'doc-001',
      advisory: null,
    });
  });

  it('returns evidence with advisory when extraction is complete', async () => {
    const pool = makePool([
      {
        rows: [{
          claim_id: 'CLM_001',
          documentation_status: 'extraction_complete',
          rfai_doc_id: 'doc-001',
        }],
      },
      {
        rows: [{
          analysis_id: 'ana_001',
          advisory_type: 'claims_attachment',
          status: 'complete',
          summary: { text: 'Patient has knee pain' },
          extraction: { entities: [] },
          completeness: null,
          triage: null,
        }],
      },
    ]);
    const res = await supertest(makeApp(pool))
      .get('/case-001/evidence')
      .set('x-sim-tenant-id', 'tenant-dev');
    expect(res.status).toBe(200);
    expect(res.body.advisory).toMatchObject({
      analysis_id: 'ana_001',
      advisory_type: 'claims_attachment',
      status: 'complete',
    });
  });
});
```

Run: `cd modules/claims/service && pnpm test 2>&1 | grep -E "evidence|Cannot find|FAIL"`
Expected: FAIL with "Cannot find module"

- [ ] **Step 2: Implement `evidence.ts`**

Create `modules/claims/service/src/routes/evidence.ts`:
```typescript
import express from 'express';
import type { Pool } from 'pg';

export function buildEvidenceRouter(pool: Pool): express.Router {
  const router = express.Router();

  router.get('/:caseRef/evidence', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ error: 'Missing x-sim-tenant-id header' });

    const { caseRef } = req.params;

    const { rows: claimRows } = await pool.query<{
      claim_id: string;
      documentation_status: string;
      rfai_doc_id: string | null;
    }>(
      `SELECT cl.claim_id, cl.documentation_status, cl.rfai_doc_id
       FROM claims.claim cl
       JOIN ens.case c ON c.case_id = cl.case_id AND c.tenant_id = cl.tenant_id
       WHERE c.case_id = $1::uuid AND cl.tenant_id = $2`,
      [caseRef, tenantId],
    );

    if (claimRows.length === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    const claim = claimRows[0]!;

    const { rows: advisoryRows } = await pool.query<{
      analysis_id: string;
      advisory_type: string;
      status: string;
      summary: unknown;
      extraction: unknown;
      completeness: unknown;
      triage: unknown;
    }>(
      `SELECT analysis_id, advisory_type, status, summary, extraction, completeness, triage
       FROM revital.analysis
       WHERE case_ref = $1
         AND tenant_id = $2
         AND advisory_type = 'claims_attachment'
       ORDER BY created_at DESC
       LIMIT 1`,
      [caseRef, tenantId],
    );

    return res.status(200).json({
      claim_id: claim.claim_id,
      documentation_status: claim.documentation_status,
      rfai_doc_id: claim.rfai_doc_id,
      advisory: advisoryRows[0] ?? null,
    });
  });

  return router;
}
```

- [ ] **Step 3: Wire all new routes in `app.ts`**

Replace `modules/claims/service/src/app.ts`:
```typescript
import '@sim/otel'
import { enrichSpan } from '@sim/otel'
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'pg';
import { buildClaimsRouter } from './routes/claims.js';
import { buildAppealsRouter } from './routes/appeals.js';
import { buildIRORouter } from './routes/iro.js';
import { buildDocumentationRequestRouter } from './routes/documentationRequest.js';
import { buildInternalRouter } from './routes/internal.js';
import { buildEvidenceRouter } from './routes/evidence.js';

/** Build the claims-service Express app (no listen — testable). */
export function buildApp(pool: Pool): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const tenantId = (req as any).tenantId ?? (req.headers['x-tenant-id'] as string | undefined)
    const sub = (req as any).sub as string | undefined
    if (tenantId) enrichSpan({ tenant_id: tenantId })
    if (sub) enrichSpan({ 'user.sub': sub })
    next()
  })
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/v1/claims', buildClaimsRouter(pool));
  app.use('/v1/claims', buildDocumentationRequestRouter(pool));
  app.use('/v1/claims', buildEvidenceRouter(pool));
  app.use('/v1/appeals', buildAppealsRouter(pool));
  app.use('/v1/iro', buildIRORouter(pool));
  app.use('/v1/internal', buildInternalRouter(pool));
  return app;
}
```

- [ ] **Step 4: Run all tests**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/modules/claims/service
pnpm test -- --reporter=verbose 2>&1 | tail -20
```
Expected: All tests green (original claims/appeals/iro tests + 4 documentation + 5 internal + 4 evidence).

- [ ] **Step 5: Typecheck**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/modules/claims/service
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
git add modules/claims/service/src/routes/evidence.ts \
        modules/claims/service/src/__tests__/evidence.test.ts \
        modules/claims/service/src/app.ts
git commit -m "feat(claims): add evidence route and wire all Phase 4A routes into app

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
