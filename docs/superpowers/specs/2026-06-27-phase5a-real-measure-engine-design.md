# Phase 5A — Real Measure Engine Design

**Date:** 2026-06-27  
**Phase:** 5A (Quality & Standards Conformance — Measure Engine)  
**Depends on:** Phase 1 (Digicore real CQL engine), Phase 2 (Revital evidence + EvidenceIndexed events)  
**Roadmap section:** Phase 5 — Quality & standards conformance

---

## Goal

Replace Qualitron's hand-rolled SQL measure evaluator with real CQL-against-FHIR evaluation via Digicore's `CqfEvaluator`, generate FHIR R4 `MeasureReport` resources (Individual + Summary, DEQM-profiled), mount the already-built reporting and aggregation services, wire a dual-path re-evaluation loop (event-driven + nightly batch), and close the gap→Enstellar outbox notification chain.

**Exit criteria:** a BCS-E measure run triggers Digicore CQL evaluation for each cohort member; individual FHIR `MeasureReport` resources are generated and stored per member; a DEQM Summary `MeasureReport` is produced at run completion; the reporting service serves the submission-ready summary; new Revital evidence closes a gap within seconds via the event-driven path; a nightly batch reconciles the full cohort; a closed gap emits `QualGapClosed` and Enstellar marks the outreach task resolved.

---

## Architecture

```
[Digicore runtime]        POST /v1/runtime/measure-evaluate  (new)
       ↑
[Qualitron execution]     evaluateWithDigicore activity  (replaces SQL evaluator)
       ↓
[buildMeasureReport.ts]   Individual + Summary FHIR MeasureReport  (new utility)
       ↓
[qual.measure_report]     report_fhir JSONB column  (V036 migration)
       ↓
[Qualitron reporting svc] mount + submission output endpoint  (new service)
[Qualitron aggregation svc] mount + EvidenceIndexed consumer + nightly cron  (new service)
       ↓
[Outbox → Kafka]          QualGapClosed event  (new event type)
       ↓
[Enstellar consumer]      marks outreach task resolved  (new consumer)
```

---

## Global Constraints

- All new TypeScript code targets Node.js 20, ESM, strict TypeScript, Vitest for tests.
- All new Java code targets Java 21, Spring Boot 3.x, Mockito + JUnit 5 for tests.
- Tenant isolation: all DB queries use `withTenant` (TypeScript) or set `sim.tenant_id` GUC (Java JDBC) before accessing `qual.*`, `fabric.*`, or `ens.*` tables.
- FHIR version: R4 (`4.0.1`). MeasureReport profiles: DEQM Individual (`http://hl7.org/fhir/us/davinci-deqm/StructureDefinition/indv-measurereport-deqm`) and DEQM Summary (`http://hl7.org/fhir/us/davinci-deqm/StructureDefinition/summary-measurereport-deqm`).
- CQL population expression names: exactly `Denominator`, `Numerator`, `Exclusion`, `Exception` (case-sensitive). Missing expressions default to `false`.
- Outbox pattern: gap closure writes to `shared.outbox` in the same transaction as the `qual.gap` UPDATE; the relay delivers to Kafka topic `qual.gap.closed`.
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- No new external dependencies unless the existing lockfile already carries them.

---

## Database Migrations

### V035 — `qual.measure_definition` Digicore ref
```sql
ALTER TABLE qual.measure_definition
  ADD COLUMN digicore_library_ref TEXT;

-- Update BCS-E demo seed to carry the Digicore library ref
UPDATE qual.measure_definition
SET digicore_library_ref = 'bcs-e-v1'
WHERE measure_ref = 'bcs-e';
```

### V036 — `qual.measure_report` FHIR columns
```sql
ALTER TABLE qual.measure_report
  ADD COLUMN report_fhir   JSONB,
  ADD COLUMN report_type   TEXT NOT NULL DEFAULT 'individual'
    CHECK (report_type IN ('individual', 'summary'));

CREATE INDEX qual_measure_report_type_idx
  ON qual.measure_report (tenant_id, run_id, report_type);
```

### V037 — BCS-E CQL Library governance seed

Seeds BCS-E as a governed CQL Library in Digicore. **The implementer must verify the actual Digicore library storage table/mechanism from the Digicore schema (it may be `digicore.library`, `digicore.governance_entry`, or loaded via VKAS) before writing this migration.**

The CQL content to seed (adapt the INSERT to match the actual schema):

```
library BcsE version '1.0.0'

using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'

codesystem LOINC: 'http://loinc.org'
code "Mammogram": '24604-1' from LOINC

parameter "Measurement Period" Interval<DateTime>

context Patient

define "Denominator":
  AgeInYearsAt(end of "Measurement Period") in Interval[52, 74]

define "Exclusion":
  exists (
    [Condition: code ~ "hospice"] C
      where C.clinicalStatus ~ 'active'
  )

define "Numerator":
  exists (
    [Observation: code ~ "Mammogram"] O
      where O.status in { 'final', 'amended' }
        and O.effective in "Measurement Period"
  )

define "Exception":
  false
```

The library must be addressable by `library_ref = 'bcs-e-v1'` so that `MeasureEvaluateController` can resolve it via `LibrarySourceProvider`.

---

## Component 1: Digicore `POST /v1/runtime/measure-evaluate` (Java)

**Files:**
- Create: `modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/api/MeasureEvaluateController.java`
- Create: `modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/engine/MeasureEvaluateRequest.java`
- Create: `modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/engine/MeasureEvaluateResponse.java`
- Create: `modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/engine/MemberEvaluationResult.java`
- Create: `modules/digicore/runtime/src/test/java/io/simintero/digicore/runtime/api/MeasureEvaluateControllerTest.java`

**Request/response:**
```java
// MeasureEvaluateRequest.java
public record MeasureEvaluateRequest(
    String tenantId,
    String measureRef,
    String libraryRef,
    List<String> memberRefs,
    String periodStart,   // ISO-8601 date e.g. "2025-01-01"
    String periodEnd      // ISO-8601 date e.g. "2025-12-31"
) {}

// MemberEvaluationResult.java
public record MemberEvaluationResult(
    String memberRef,
    boolean denominator,
    boolean numerator,
    boolean exclusion,
    boolean exception,
    String traceRef
) {}

// MeasureEvaluateResponse.java
public record MeasureEvaluateResponse(
    List<MemberEvaluationResult> results
) {}
```

**Controller logic:**
- `POST /v1/runtime/measure-evaluate` — `@RequestBody MeasureEvaluateRequest`
- For each `memberRef` in `request.memberRefs()`:
  - Build `EvaluationRequest` with `tenantId`, `memberRef`, parameters `measurementPeriodStart` + `measurementPeriodEnd`
  - Call `cqfEvaluator.evaluate(evalRequest)` (the existing evaluator, already wired to `FabricRetrieveProvider` + `VkasTerminologyProvider`)
  - Extract boolean values for expressions `Denominator`, `Numerator`, `Exclusion`, `Exception` from the result map; missing expression → `false`
  - Collect `MemberEvaluationResult`
- Return `MeasureEvaluateResponse(results)`
- 400 on missing/invalid fields; 500 on evaluator error (do NOT swallow — let Spring's default error handler return 500 so Qualitron can retry)

**Tests (Mockito + `@WebMvcTest`):**
- Mock `CqfEvaluator`; return map with all four expressions set
- Assert response contains correct member results
- Assert missing expression defaults to `false`
- Assert 400 on empty `memberRefs`
- Assert 500 propagates (do not catch evaluator exception)

---

## Component 2: Qualitron CQL bridge (TypeScript — execution module)

**Files:**
- Create: `modules/qualitron/execution/src/activities/evaluateWithDigicore.ts`
- Create: `modules/qualitron/execution/src/activities/__tests__/evaluateWithDigicore.test.ts`
- Modify: `modules/qualitron/execution/src/workflows/QualitronRunMeasure.ts`
- Modify: `modules/qualitron/execution/src/activities/index.ts`

**`evaluateWithDigicore.ts`:**
```typescript
import { Context } from '@temporalio/activity'

export interface MemberResult {
  memberRef: string
  denominator: boolean
  numerator: boolean
  exclusion: boolean
  exception: boolean
  traceRef: string
}

export interface DigicoreMeasureInput {
  tenantId: string
  measureRef: string
  libraryRef: string
  memberRefs: string[]
  periodStart: string
  periodEnd: string
}

const DIGICORE_URL = process.env.DIGICORE_SERVICE_URL ?? 'http://localhost:4010'

export async function evaluateWithDigicore(
  input: DigicoreMeasureInput
): Promise<MemberResult[]> {
  const res = await fetch(`${DIGICORE_URL}/v1/runtime/measure-evaluate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sim-tenant-id': input.tenantId,
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    throw new Error(`Digicore measure-evaluate ${res.status}: ${await res.text()}`)
  }
  const body = await res.json() as { results: MemberResult[] }
  return body.results
}
```

**`QualitronRunMeasure.ts` workflow routing:**

After fetching the measure definition, check `digicore_library_ref`:
```typescript
const memberResults = measureDef.digicore_library_ref
  ? await evaluateWithDigicore({
      tenantId: input.tenantId,
      measureRef: input.measureRef,
      libraryRef: measureDef.digicore_library_ref,
      memberRefs: eligibleMembers,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    })
  : await evaluateMeasureLegacy(eligibleMembers, measureDef, input)  // existing SQL path renamed
```

After evaluation, call `buildMeasureReport` (Component 3) to generate FHIR resources before persisting.

**Tests (`evaluateWithDigicore.test.ts`):**
- Mock `fetch`; assert correct URL, headers, body
- Returns parsed `MemberResult[]` on 200
- Throws on non-200 response
- Throws on network error

---

## Component 3: FHIR MeasureReport builder (TypeScript — execution module)

**Files:**
- Create: `modules/qualitron/execution/src/fhir/buildMeasureReport.ts`
- Create: `modules/qualitron/execution/src/fhir/__tests__/buildMeasureReport.test.ts`

**`buildMeasureReport.ts`:**

```typescript
import { randomUUID } from 'crypto'

export interface MeasureRunContext {
  runId: string
  measureRef: string
  measureUrl: string   // e.g. "http://sim.internal/Measure/bcs-e"
  periodStart: string
  periodEnd: string
  tenantId: string
}

export interface MemberResult {
  memberRef: string
  denominator: boolean
  numerator: boolean
  exclusion: boolean
  exception: boolean
  traceRef: string
  evidenceRefs?: string[]
}

// DEQM population system
const DEQM_POPULATION_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/measure-population'

function populationCode(code: string) {
  return { coding: [{ system: DEQM_POPULATION_SYSTEM, code }] }
}

export function buildIndividualMeasureReport(
  ctx: MeasureRunContext,
  member: MemberResult
): object {
  return {
    resourceType: 'MeasureReport',
    id: randomUUID(),
    meta: {
      profile: [
        'http://hl7.org/fhir/us/davinci-deqm/StructureDefinition/indv-measurereport-deqm',
      ],
    },
    status: 'complete',
    type: 'individual',
    measure: ctx.measureUrl,
    subject: { reference: `Patient/${member.memberRef}` },
    date: new Date().toISOString(),
    period: { start: ctx.periodStart, end: ctx.periodEnd },
    group: [
      {
        population: [
          { code: populationCode('denominator'), count: member.denominator ? 1 : 0 },
          { code: populationCode('numerator'),   count: member.numerator   ? 1 : 0 },
          { code: populationCode('exclusion'),   count: member.exclusion   ? 1 : 0 },
          { code: populationCode('exception'),   count: member.exception   ? 1 : 0 },
        ],
      },
    ],
    evaluatedResource: (member.evidenceRefs ?? []).map(ref => ({ reference: ref })),
    extension: [
      {
        url: 'http://sim.internal/fhir/StructureDefinition/trace-ref',
        valueString: member.traceRef,
      },
    ],
  }
}

export function buildSummaryMeasureReport(
  ctx: MeasureRunContext,
  members: MemberResult[]
): object {
  const sum = (fn: (m: MemberResult) => boolean) =>
    members.filter(fn).length

  return {
    resourceType: 'MeasureReport',
    id: randomUUID(),
    meta: {
      profile: [
        'http://hl7.org/fhir/us/davinci-deqm/StructureDefinition/summary-measurereport-deqm',
      ],
    },
    status: 'complete',
    type: 'summary',
    measure: ctx.measureUrl,
    date: new Date().toISOString(),
    period: { start: ctx.periodStart, end: ctx.periodEnd },
    group: [
      {
        population: [
          { code: populationCode('denominator'), count: sum(m => m.denominator) },
          { code: populationCode('numerator'),   count: sum(m => m.numerator)   },
          { code: populationCode('exclusion'),   count: sum(m => m.exclusion)   },
          { code: populationCode('exception'),   count: sum(m => m.exception)   },
        ],
        measureScore: {
          value:
            sum(m => m.denominator) > 0
              ? sum(m => m.numerator) / sum(m => m.denominator)
              : 0,
        },
      },
    ],
  }
}
```

**Tests:**
- `buildIndividualMeasureReport`: assert `resourceType`, `type: 'individual'`, all four population counts, `evaluatedResource` refs, `traceRef` extension
- `buildSummaryMeasureReport`: assert `type: 'summary'`, aggregate counts, `measureScore.value` = numerator/denominator ratio
- `measureScore.value` = 0 when denominator count is 0 (no division by zero)

**`persistMeasureReport.ts` (modify):** After calling `buildMeasureReport`, write `report_fhir` JSONB for both individual and summary rows. Summary row uses `report_type = 'summary'` and `member_id = null`.

---

## Component 4: Reporting service mount

**Files:**
- Create: `services/qualitron-reporting/Dockerfile`
- Modify: `infra/compose/docker-compose.yml` (add `qualitron-reporting` service)
- Modify: `modules/qualitron/reporting/src/routes/measures.ts` (add submission output endpoint)

**Dockerfile:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY modules/qualitron/reporting/package.json ./
RUN npm install --production
COPY modules/qualitron/reporting/dist ./dist
CMD ["node", "dist/server.js"]
```

**New submission endpoint** in `modules/qualitron/reporting/src/routes/measures.ts`:
```
GET /v1/measures/:ref/runs/:runId/report
```
Queries `qual.measure_report WHERE run_id = :runId AND report_type = 'summary'`, returns `report_fhir` JSONB with `Content-Type: application/fhir+json`. 404 if run not found or summary not yet generated.

**Compose entry:**
```yaml
qualitron-reporting:
  build:
    context: .
    dockerfile: services/qualitron-reporting/Dockerfile
  environment:
    DATABASE_URL: ${DATABASE_URL}
    PORT: 4080
  ports:
    - "4080:4080"
  depends_on: [postgres]
```

---

## Component 5: Aggregation service mount + re-evaluation loop

**Files:**
- Create: `services/qualitron-aggregation/Dockerfile`
- Modify: `infra/compose/docker-compose.yml` (add `qualitron-aggregation` service)
- Create: `modules/qualitron/aggregation/src/consumers/EvidenceIndexedConsumer.ts`
- Create: `modules/qualitron/aggregation/src/consumers/__tests__/EvidenceIndexedConsumer.test.ts`
- Create: `modules/qualitron/aggregation/src/schedules/MeasureBatchSchedule.ts`

**`EvidenceIndexedConsumer.ts`:**

Subscribes to Kafka topic `sim.qual.evidence` (event type `EvidenceIndexed`). On receipt:
1. Extract `tenantId`, `memberRef` from event payload
2. `withTenant(pool, tenantId)`: query `qual.measure_definition` for all active measure defs with `digicore_library_ref IS NOT NULL`
3. For each active measure def, call `POST /v1/runtime/measure-evaluate` on Digicore directly (same HTTP pattern as `evaluateWithDigicore.ts` in the execution module — duplicated locally to avoid a cross-package dependency between `@sim/qualitron-aggregation` and `@sim/qualitron-execution`)
4. Call `buildIndividualMeasureReport` (also duplicated or extracted to a minimal inline helper) → upsert `qual.measure_report` (`ON CONFLICT (tenant_id, run_id, member_id) DO UPDATE SET report_fhir = EXCLUDED.report_fhir`)
5. Check gap transition: if previous `qual.gap.status = 'open'` and new result has `numerator = true` → UPDATE gap to `closed` + INSERT outbox event `QualGapClosed`
6. Ack message

```typescript
// Event shape (from shared event contracts)
interface EvidenceIndexed {
  event_type: 'EvidenceIndexed'
  tenant_id: string
  member_ref: string
  evidence_refs: string[]
  measure_ref?: string  // optional: if present, only re-evaluate this measure
}
```

**`MeasureBatchSchedule.ts`:**

Temporal `Schedule` definition — cron `0 2 * * *` (2am UTC nightly). Triggers `QualitronRunMeasure` workflow for each active `(tenant_id, measure_ref)` pair in `qual.measure_definition` where `digicore_library_ref IS NOT NULL`. The batch uses the current calendar year as the measurement period.

**Tests (`EvidenceIndexedConsumer.test.ts`):**
- Happy path: `evaluateWithDigicore` returns `numerator: true` for previously open gap → gap closed + outbox event emitted
- No gap transition when `numerator: false`
- No gap event when gap was already `closed`
- Ack called even on evaluator error (log + ack; don't poison the topic for a single bad member)

---

## Component 6: `QualGapClosed` outbox event + Enstellar consumer

**Files:**
- Modify: `modules/qualitron/gaps/src/GapDetector.ts` (emit outbox event on gap closure)
- Create: `modules/enstellar-workflow/src/consumers/QualGapClosedConsumer.ts` (or Python equivalent in `enstellar_workflow/consumers/`)
- Create: matching test file

**Outbox event schema:**
```json
{
  "event_type": "QualGapClosed",
  "tenant_id": "string",
  "gap_id": "string",
  "member_id": "string",
  "measure_ref": "string",
  "closed_at": "ISO-8601"
}
```

Published to Kafka topic `qual.gap.closed`.

**`GapDetector.ts` change:** The existing `closeGap(gapId)` method runs inside a `withTenant` transaction. Add an outbox INSERT after the `UPDATE qual.gap SET status = 'closed'`:
```typescript
await client.query(
  `INSERT INTO shared.outbox (tenant_id, event_type, payload)
   VALUES ($1, 'QualGapClosed', $2)`,
  [tenantId, JSON.stringify({ gap_id: gapId, member_id, measure_ref, closed_at: new Date().toISOString() })]
)
```

**Enstellar consumer:** Subscribes to `qual.gap.closed`. On receipt, queries `qual.outreach_task_ref` for the `gap_id`, calls the Task Service to mark the outreach task resolved. If no outreach task exists for the gap, logs and acks (gap may have been detected but no outreach task was created — valid state).

**Tests:**
- Gap closure emits outbox payload with correct fields
- Consumer resolves outreach task when one exists
- Consumer acks without error when no outreach task exists

---

## Data Flow Summary

```
Measure run triggered (manual or nightly cron)
  → QualitronRunMeasure Temporal workflow
  → fetchEligibleMembers (existing)
  → evaluateWithDigicore → POST /v1/runtime/measure-evaluate (Digicore)
      → CqfEvaluator evaluates Denominator/Numerator/Exclusion/Exception CQL per member
      → returns MemberEvaluationResult[]
  → buildIndividualMeasureReport per member → qual.measure_report (report_fhir)
  → buildSummaryMeasureReport → qual.measure_report (report_type='summary')
  → GapDetector: open gaps where denom && !excl && !num (existing logic, unchanged)
  → run complete

New evidence arrives (Revital emits EvidenceIndexed)
  → EvidenceIndexedConsumer (aggregation service)
  → evaluateWithDigicore for single member
  → upsert individual MeasureReport
  → if numerator flipped true + gap was open → closeGap + outbox QualGapClosed
  → QualGapClosedConsumer (Enstellar) → resolve outreach task

Submission query
  → GET /v1/measures/bcs-e/runs/:runId/report
  → returns FHIR Summary MeasureReport (report_fhir JSONB, Content-Type: application/fhir+json)
```

---

## File Map

| Component | Files |
|-----------|-------|
| DB migrations | `V035__qual_digicore_ref.sql`, `V036__qual_measure_report_fhir.sql`, `V037__bcs_e_cql_library_seed.sql` |
| Digicore endpoint | `MeasureEvaluateController.java`, `MeasureEvaluateRequest.java`, `MeasureEvaluateResponse.java`, `MemberEvaluationResult.java` + test |
| Qualitron CQL bridge | `evaluateWithDigicore.ts` + test; `QualitronRunMeasure.ts` modified |
| FHIR builder | `fhir/buildMeasureReport.ts` + test; `persistMeasureReport.ts` modified |
| Reporting service | `services/qualitron-reporting/Dockerfile`; `measures.ts` modified (submission endpoint) |
| Aggregation service | `services/qualitron-aggregation/Dockerfile`; `EvidenceIndexedConsumer.ts` + test; `MeasureBatchSchedule.ts` |
| Gap→Enstellar | `GapDetector.ts` modified; `QualGapClosedConsumer.ts` + test |
| Compose | `docker-compose.yml` modified (2 new services) |
