# Phase 5A — Real Measure Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Qualitron's hand-rolled SQL measure evaluator with real CQL-against-FHIR evaluation via Digicore's `CqfEvaluator`, generate FHIR R4 DEQM-profiled `MeasureReport` resources, mount reporting and aggregation services, wire a dual-path re-evaluation loop (event-driven + nightly batch), and close the gap→Enstellar outbox notification chain.

**Architecture:** A new `POST /v1/runtime/measure-evaluate` endpoint in Digicore accepts a batch of member refs and evaluates them against a named CQL library stored in VKAS, returning per-member population booleans. Qualitron's workflow routes to this endpoint when `digicore_library_ref` is set on the measure definition (legacy SQL path still works when null). After evaluation, `buildMeasureReport.ts` produces FHIR R4 Individual and Summary MeasureReport resources that are persisted alongside the existing internal format. The already-built reporting and aggregation modules are mounted as services; the aggregation service subscribes to `sim.qual.evidence` for event-driven re-evaluation and schedules nightly batch runs. Gap closure emits a `QualGapClosed` outbox event consumed by Enstellar to resolve outreach tasks.

**Tech Stack:** TypeScript/Node 20/ESM/Vitest (Qualitron modules), Java 21/Spring Boot 3.x/Mockito+JUnit5 (Digicore), pnpm workspaces, PostgreSQL (FORCE RLS), Kafka/Redpanda, FHIR R4 DEQM profiles, VKAS artifact store.

## Global Constraints

- All new TypeScript: Node.js 20, ESM, strict TypeScript, Vitest for tests.
- All new Java: Java 21, Spring Boot 3.x, Mockito + JUnit 5 for tests.
- Tenant isolation: all DB queries use `withTenant` (TypeScript) or `set_config('sim.tenant_id', ...)` via JDBC (Java) before accessing `qual.*`, `fabric.*`, or `ens.*` tables.
- FHIR version: R4 (`4.0.1`). DEQM Individual profile: `http://hl7.org/fhir/us/davinci-deqm/StructureDefinition/indv-measurereport-deqm`. DEQM Summary profile: `http://hl7.org/fhir/us/davinci-deqm/StructureDefinition/summary-measurereport-deqm`.
- CQL population expression names: exactly `Denominator`, `Numerator`, `Exclusion`, `Exception`, `Meets All Criteria` (case-sensitive). Missing expressions default to `false`. `Meets All Criteria` must be present or `CqfEvaluator` returns `indeterminate`.
- Outbox pattern: gap closure writes to `shared.outbox` in the same transaction as the `qual.gap` UPDATE; the relay delivers to Kafka topic `qual.gap.closed`.
- No new external dependencies unless the existing lockfile already carries them (`ulid`, `pg`, `express`, `kafkajs`, `crypto` are already present).
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Dockerfile pattern: multi-stage pnpm build — copy `package.json` files, `pnpm install --frozen-lockfile --filter <pkg>...`, copy source, build, `pnpm deploy --legacy --prod /deploy`, runtime stage copies `/deploy`.

---

### Task 1: DB Migrations (V035, V036, V037)

**Files:**
- Create: `platform/services/db-migrations/migrations/V035__qual_digicore_ref.sql`
- Create: `platform/services/db-migrations/migrations/V036__qual_measure_report_fhir.sql`
- Create: `platform/services/db-migrations/migrations/V037__bcs_e_cql_library_seed.sql`

**Interfaces:**
- Consumes: nothing (pure SQL, no code dependencies)
- Produces:
  - `qual.measure_definition.digicore_library_ref TEXT` — URL of the VKAS `cql_library` artifact; null means use legacy SQL evaluator
  - `qual.measure_report.report_fhir JSONB` — serialized FHIR MeasureReport JSON (null until Task 4 writes it)
  - `qual.measure_report.report_type TEXT` — `'individual'` (default) or `'summary'`
  - `vkas.artifact` row for BCS-E CQL library, addressable at `https://artifacts.simintero.io/shared/cql_library/bcs-e`

- [ ] **Step 1: Write V035**

```sql
-- platform/services/db-migrations/migrations/V035__qual_digicore_ref.sql
ALTER TABLE qual.measure_definition
  ADD COLUMN digicore_library_ref TEXT;

-- Point the BCS-E demo measure at its VKAS cql_library artifact.
-- measure_ref = 'hedis:BCS-E' matches the V020 seed exactly.
UPDATE qual.measure_definition
SET digicore_library_ref = 'https://artifacts.simintero.io/shared/cql_library/bcs-e'
WHERE measure_ref = 'hedis:BCS-E';
```

- [ ] **Step 2: Write V036**

```sql
-- platform/services/db-migrations/migrations/V036__qual_measure_report_fhir.sql
ALTER TABLE qual.measure_report
  ADD COLUMN report_fhir   JSONB,
  ADD COLUMN report_type   TEXT NOT NULL DEFAULT 'individual'
    CHECK (report_type IN ('individual', 'summary'));

CREATE INDEX qual_measure_report_type_idx
  ON qual.measure_report (tenant_id, run_id, report_type);
```

- [ ] **Step 3: Write V037**

The BCS-E CQL library must define `Meets All Criteria` (required by `CqfEvaluator` — without it the engine returns `indeterminate` and the logicPath is empty). `Denominator = true` because eligible members are pre-filtered by `fetchEligibleMembers` (all Patients in `fabric.resource`). No measurement-period CQL parameter is needed — `FabricRetrieveProvider` returns all member resources and the SQL evaluator handles period filtering separately.

```sql
-- platform/services/db-migrations/migrations/V037__bcs_e_cql_library_seed.sql
-- Seeds BCS-E as a VKAS cql_library artifact so Digicore CqfEvaluator can resolve it.
-- The CQL is minimal on purpose: FabricRetrieveProvider returns all member resources;
-- the legacy SQL path handles period filtering. This layer proves CQL → FHIR → populationBooleans.
INSERT INTO vkas.artifact (
  canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by
) VALUES (
  'https://artifacts.simintero.io/shared/cql_library/bcs-e',
  '1.0.0',
  'shared',
  'cql_library',
  'active',
  jsonb_build_object('cql', $cql$library BcsE version '1.0.0'

using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'

codesystem LOINC: 'http://loinc.org'

code "Mammogram": '24604-1' from LOINC
code "HospiceCode": 'hospice' from LOINC

context Patient

define "Denominator":
  true

define "Exclusion":
  exists (
    [Condition] C
      where exists (
        C.code.coding C2
          where C2.system = 'http://loinc.org' and C2.code = 'hospice'
      )
  )

define "Numerator":
  exists (
    [Observation] O
      where exists (
        O.code.coding C2
          where C2.system = 'http://loinc.org' and C2.code = '24604-1'
      )
  )

define "Exception":
  false

define "Meets All Criteria":
  "Denominator" and "Numerator" and not "Exclusion" and not "Exception"
$cql$),
  md5(jsonb_build_object('cql', 'bcs-e-v1-placeholder')::text),
  'seed'
)
ON CONFLICT (canonical_url, version) DO NOTHING;
```

- [ ] **Step 4: Verify migration file ordering**

Run: `ls platform/services/db-migrations/migrations/ | grep -E "V03[0-9]"`
Expected: V030, V031, V032, V033, V034, V035, V036, V037 with no gaps and no duplicate numbers.

- [ ] **Step 5: Commit**

```bash
git add platform/services/db-migrations/migrations/V035__qual_digicore_ref.sql \
        platform/services/db-migrations/migrations/V036__qual_measure_report_fhir.sql \
        platform/services/db-migrations/migrations/V037__bcs_e_cql_library_seed.sql
git commit -m "feat(qual): add digicore_library_ref + report_fhir columns + BCS-E VKAS seed (V035-V037)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Digicore `POST /v1/runtime/measure-evaluate` (Java)

**Files:**
- Create: `modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/engine/MeasureEvaluateRequest.java`
- Create: `modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/engine/MemberEvaluationResult.java`
- Create: `modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/engine/MeasureEvaluateResponse.java`
- Create: `modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/api/MeasureEvaluateController.java`
- Create: `modules/digicore/runtime/src/test/java/io/simintero/digicore/runtime/api/MeasureEvaluateControllerTest.java`

**Interfaces:**
- Consumes:
  - `CqfEvaluator.evaluate(cqlText, evidence, tenantId, memberRef, null)` → `ElmEvaluator.ElmResult` with `logicPath: List<Map<String, Object>>` where each entry is `{step: expressionName, result: "true"/"false"}`
  - `RuleResolver.resolveCql(libraryRef, null, RuleContext.empty())` → `Optional<String>` CQL text
- Produces:
  - `POST /v1/runtime/measure-evaluate` returning `{ results: [{ memberRef, denominator, numerator, exclusion, exception, traceRef }] }`

**Context:** `CqfEvaluator` is already `@Component`-injected in `EvaluateController`. Use the same injection pattern. `RuleResolver` is also a `@Component`. The `logicPath` from `ElmResult` contains ALL defined expressions; extract the four population booleans from it. If `CqfEvaluator` returns `indeterminate` (e.g. VKAS unreachable), treat all populations as `false` for that member and log a warning — do NOT throw, so the batch continues.

- [ ] **Step 1: Write the three record types**

```java
// modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/engine/MeasureEvaluateRequest.java
package io.simintero.digicore.runtime.engine;

import java.util.List;

public record MeasureEvaluateRequest(
    String tenantId,
    String libraryRef,
    List<String> memberRefs,
    String periodStart,
    String periodEnd
) {}
```

```java
// modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/engine/MemberEvaluationResult.java
package io.simintero.digicore.runtime.engine;

public record MemberEvaluationResult(
    String memberRef,
    boolean denominator,
    boolean numerator,
    boolean exclusion,
    boolean exception,
    String traceRef
) {}
```

```java
// modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/engine/MeasureEvaluateResponse.java
package io.simintero.digicore.runtime.engine;

import java.util.List;

public record MeasureEvaluateResponse(
    List<MemberEvaluationResult> results
) {}
```

- [ ] **Step 2: Write the failing test first**

```java
// modules/digicore/runtime/src/test/java/io/simintero/digicore/runtime/api/MeasureEvaluateControllerTest.java
package io.simintero.digicore.runtime.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.simintero.digicore.runtime.engine.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(MeasureEvaluateController.class)
class MeasureEvaluateControllerTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @MockBean CqfEvaluator cqfEvaluator;
    @MockBean RuleResolver ruleResolver;

    private static final String CQL = "library BcsE version '1.0.0' define \"Meets All Criteria\": true";

    @Test
    void returnsBooleanPopulationsForEachMember() throws Exception {
        when(ruleResolver.resolveCql(anyString(), isNull(), any()))
            .thenReturn(Optional.of(CQL));
        when(cqfEvaluator.evaluate(eq(CQL), any(), eq("t1"), eq("m1"), isNull()))
            .thenReturn(new ElmEvaluator.ElmResult("meets_all", List.of(), List.of(
                Map.of("step", "Denominator", "result", "true"),
                Map.of("step", "Numerator",   "result", "true"),
                Map.of("step", "Exclusion",   "result", "false"),
                Map.of("step", "Exception",   "result", "false"),
                Map.of("step", "Meets All Criteria", "result", "true")
            )));
        when(cqfEvaluator.evaluate(eq(CQL), any(), eq("t1"), eq("m2"), isNull()))
            .thenReturn(new ElmEvaluator.ElmResult("not_met", List.of(), List.of(
                Map.of("step", "Denominator", "result", "true"),
                Map.of("step", "Numerator",   "result", "false"),
                Map.of("step", "Exclusion",   "result", "false"),
                Map.of("step", "Exception",   "result", "false"),
                Map.of("step", "Meets All Criteria", "result", "false")
            )));

        var req = Map.of(
            "tenantId", "t1",
            "libraryRef", "https://artifacts.simintero.io/shared/cql_library/bcs-e",
            "memberRefs", List.of("m1", "m2"),
            "periodStart", "2025-01-01",
            "periodEnd", "2025-12-31"
        );

        mvc.perform(post("/v1/runtime/measure-evaluate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(req)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].memberRef").value("m1"))
            .andExpect(jsonPath("$.results[0].numerator").value(true))
            .andExpect(jsonPath("$.results[1].memberRef").value("m2"))
            .andExpect(jsonPath("$.results[1].numerator").value(false));
    }

    @Test
    void missingExpressionDefaultsToFalse() throws Exception {
        when(ruleResolver.resolveCql(anyString(), isNull(), any()))
            .thenReturn(Optional.of(CQL));
        // Only "Meets All Criteria" in logicPath — no Denominator/Numerator/etc
        when(cqfEvaluator.evaluate(eq(CQL), any(), anyString(), anyString(), isNull()))
            .thenReturn(new ElmEvaluator.ElmResult("meets_all", List.of(), List.of(
                Map.of("step", "Meets All Criteria", "result", "true")
            )));

        var req = Map.of("tenantId", "t1", "libraryRef", "url",
            "memberRefs", List.of("m1"), "periodStart", "2025-01-01", "periodEnd", "2025-12-31");

        mvc.perform(post("/v1/runtime/measure-evaluate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(req)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].denominator").value(false))
            .andExpect(jsonPath("$.results[0].numerator").value(false));
    }

    @Test
    void returns404WhenLibraryNotFound() throws Exception {
        when(ruleResolver.resolveCql(anyString(), isNull(), any()))
            .thenReturn(Optional.empty());

        var req = Map.of("tenantId", "t1", "libraryRef", "url",
            "memberRefs", List.of("m1"), "periodStart", "2025-01-01", "periodEnd", "2025-12-31");

        mvc.perform(post("/v1/runtime/measure-evaluate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(req)))
            .andExpect(status().isNotFound());
    }

    @Test
    void returns400WhenMemberRefsEmpty() throws Exception {
        when(ruleResolver.resolveCql(anyString(), isNull(), any()))
            .thenReturn(Optional.of(CQL));

        var req = Map.of("tenantId", "t1", "libraryRef", "url",
            "memberRefs", List.of(), "periodStart", "2025-01-01", "periodEnd", "2025-12-31");

        mvc.perform(post("/v1/runtime/measure-evaluate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(req)))
            .andExpect(status().isBadRequest());
    }

    @Test
    void indeterminateResultAllFalse() throws Exception {
        when(ruleResolver.resolveCql(anyString(), isNull(), any()))
            .thenReturn(Optional.of(CQL));
        when(cqfEvaluator.evaluate(any(), any(), anyString(), anyString(), isNull()))
            .thenReturn(new ElmEvaluator.ElmResult("indeterminate", List.of(), List.of()));

        var req = Map.of("tenantId", "t1", "libraryRef", "url",
            "memberRefs", List.of("m1"), "periodStart", "2025-01-01", "periodEnd", "2025-12-31");

        mvc.perform(post("/v1/runtime/measure-evaluate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(req)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].denominator").value(false))
            .andExpect(jsonPath("$.results[0].numerator").value(false));
    }
}
```

- [ ] **Step 3: Run the test, confirm it fails**

```bash
cd modules/digicore/runtime
./gradlew test --tests "io.simintero.digicore.runtime.api.MeasureEvaluateControllerTest" 2>&1 | tail -20
```

Expected: compilation error — `MeasureEvaluateController` not found.

- [ ] **Step 4: Write the controller**

```java
// modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/api/MeasureEvaluateController.java
package io.simintero.digicore.runtime.api;

import io.simintero.digicore.runtime.engine.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/v1/runtime")
public class MeasureEvaluateController {

    private static final Logger log = LoggerFactory.getLogger(MeasureEvaluateController.class);
    private static final Set<String> POPULATION_EXPRESSIONS =
        Set.of("Denominator", "Numerator", "Exclusion", "Exception");

    private final CqfEvaluator cqfEvaluator;
    private final RuleResolver ruleResolver;

    public MeasureEvaluateController(CqfEvaluator cqfEvaluator, RuleResolver ruleResolver) {
        this.cqfEvaluator = cqfEvaluator;
        this.ruleResolver = ruleResolver;
    }

    @PostMapping("/measure-evaluate")
    public ResponseEntity<MeasureEvaluateResponse> measureEvaluate(
            @RequestBody MeasureEvaluateRequest request) {

        if (request.memberRefs() == null || request.memberRefs().isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        Optional<String> cqlOpt = ruleResolver.resolveCql(
            request.libraryRef(), null, RuleContext.empty());
        if (cqlOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        String cqlText = cqlOpt.get();

        List<MemberEvaluationResult> results = new ArrayList<>();
        for (String memberRef : request.memberRefs()) {
            ElmEvaluator.ElmResult elm = cqfEvaluator.evaluate(
                cqlText, Map.of(), request.tenantId(), memberRef, null);

            // Extract population booleans from logicPath.
            // Each entry: {step: expressionName, result: "true"/"false"}
            Map<String, Boolean> pop = new HashMap<>();
            for (Map<String, Object> step : elm.logicPath()) {
                String name = String.valueOf(step.get("step"));
                if (POPULATION_EXPRESSIONS.contains(name)) {
                    pop.put(name, "true".equals(String.valueOf(step.get("result"))));
                }
            }

            if ("indeterminate".equals(elm.outcome())) {
                log.warn("CQL evaluation indeterminate for member {} in library {}",
                    memberRef, request.libraryRef());
            }

            results.add(new MemberEvaluationResult(
                memberRef,
                pop.getOrDefault("Denominator", false),
                pop.getOrDefault("Numerator",   false),
                pop.getOrDefault("Exclusion",   false),
                pop.getOrDefault("Exception",   false),
                "qual-trace:" + java.util.UUID.randomUUID()
            ));
        }

        return ResponseEntity.ok(new MeasureEvaluateResponse(results));
    }
}
```

- [ ] **Step 5: Run the tests, confirm all 5 pass**

```bash
cd modules/digicore/runtime
./gradlew test --tests "io.simintero.digicore.runtime.api.MeasureEvaluateControllerTest" 2>&1 | tail -10
```

Expected: `BUILD SUCCESSFUL`, 5 tests passed.

- [ ] **Step 6: Run the full Digicore test suite to verify no regressions**

```bash
./gradlew test 2>&1 | tail -10
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 7: Commit**

```bash
git add modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/engine/MeasureEvaluateRequest.java \
        modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/engine/MemberEvaluationResult.java \
        modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/engine/MeasureEvaluateResponse.java \
        modules/digicore/runtime/src/main/java/io/simintero/digicore/runtime/api/MeasureEvaluateController.java \
        modules/digicore/runtime/src/test/java/io/simintero/digicore/runtime/api/MeasureEvaluateControllerTest.java
git commit -m "feat(digicore): add POST /v1/runtime/measure-evaluate for batch CQL population evaluation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `evaluateWithDigicore` activity + workflow routing (TypeScript)

**Files:**
- Create: `modules/qualitron/execution/src/activities/evaluateWithDigicore.ts`
- Create: `modules/qualitron/execution/src/activities/__tests__/evaluateWithDigicore.test.ts`
- Modify: `modules/qualitron/execution/src/workflows/QualitronRunMeasure.ts`

**Interfaces:**
- Consumes (from Task 2): `POST /v1/runtime/measure-evaluate` → `{ results: MemberEvaluationResult[] }`
- Consumes (existing): `QualitronRunMeasure.ts` uses `evaluateMeasure`, `persistMeasureReport`, `fetchEligibleMembers`, `handleMeasureReportCompleted`
- Produces:
  - `evaluateWithDigicore(input: DigicoreMeasureInput): Promise<MemberResult[]>` — used by `QualitronRunMeasure` and later by `EvidenceIndexedConsumer`
  - `MemberResult` interface — consumed by Task 4's `buildMeasureReport` functions
  - `RunMeasureInput` extended with `measureUrl?: string` — Task 4 adds this field to the call site

**Context:** The `qual.measure_definition` SELECT in `QualitronRunMeasure.ts` (line 40) currently fetches only `spec`. After this task it also fetches `digicore_library_ref`. When `digicore_library_ref` is non-null, the workflow calls `evaluateWithDigicore` once (batch, all members) instead of `evaluateMeasure` per-member. The result shape is adapted to `MeasureResult` (the existing type) so `persistMeasureReport` and `handleMeasureReportCompleted` need no changes yet. `DIGICORE_SERVICE_URL` env var defaults to `http://localhost:4010`.

- [ ] **Step 1: Write the failing test**

```typescript
// modules/qualitron/execution/src/activities/__tests__/evaluateWithDigicore.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { DigicoreMeasureInput } from '../evaluateWithDigicore.js'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => vi.resetAllMocks())

const INPUT: DigicoreMeasureInput = {
  tenantId: 'tenant-test',
  libraryRef: 'https://artifacts.simintero.io/shared/cql_library/bcs-e',
  memberRefs: ['m1', 'm2'],
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
}

const RESULTS = [
  { memberRef: 'm1', denominator: true, numerator: true, exclusion: false, exception: false, traceRef: 'trace-1' },
  { memberRef: 'm2', denominator: true, numerator: false, exclusion: false, exception: false, traceRef: 'trace-2' },
]

describe('evaluateWithDigicore', () => {
  it('POSTs to Digicore and returns MemberResult[]', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: RESULTS }),
    })

    const { evaluateWithDigicore } = await import('../evaluateWithDigicore.js')
    const result = await evaluateWithDigicore(INPUT)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/runtime/measure-evaluate'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-sim-tenant-id': 'tenant-test' }),
      }),
    )
    expect(result).toHaveLength(2)
    expect(result[0]!.memberRef).toBe('m1')
    expect(result[0]!.numerator).toBe(true)
    expect(result[1]!.numerator).toBe(false)
  })

  it('throws on non-200 response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })
    const { evaluateWithDigicore } = await import('../evaluateWithDigicore.js')
    await expect(evaluateWithDigicore(INPUT)).rejects.toThrow('404')
  })

  it('throws on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'))
    const { evaluateWithDigicore } = await import('../evaluateWithDigicore.js')
    await expect(evaluateWithDigicore(INPUT)).rejects.toThrow('connection refused')
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd modules/qualitron/execution
npx vitest run src/activities/__tests__/evaluateWithDigicore.test.ts 2>&1 | tail -10
```

Expected: FAIL — cannot find module `../evaluateWithDigicore.js`.

- [ ] **Step 3: Write `evaluateWithDigicore.ts`**

```typescript
// modules/qualitron/execution/src/activities/evaluateWithDigicore.ts

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
  libraryRef: string
  memberRefs: string[]
  periodStart: string
  periodEnd: string
}

const DIGICORE_URL =
  process.env['DIGICORE_SERVICE_URL'] ?? 'http://localhost:4010'

export async function evaluateWithDigicore(
  input: DigicoreMeasureInput,
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
    throw new Error(
      `Digicore measure-evaluate ${res.status}: ${await res.text()}`,
    )
  }
  const body = (await res.json()) as { results: MemberResult[] }
  return body.results
}
```

- [ ] **Step 4: Run the test, confirm all 3 pass**

```bash
npx vitest run src/activities/__tests__/evaluateWithDigicore.test.ts 2>&1 | tail -10
```

Expected: 3/3 tests PASS.

- [ ] **Step 5: Modify `QualitronRunMeasure.ts` to route via Digicore when `digicore_library_ref` is set**

Read the current file at `modules/qualitron/execution/src/workflows/QualitronRunMeasure.ts` before editing. Replace the full file with:

```typescript
// modules/qualitron/execution/src/workflows/QualitronRunMeasure.ts
import {
  evaluateMeasure,
  type MeasureResult,
  type MeasureSpec,
} from '../activities/evaluateMeasure.js'
import { evaluateWithDigicore } from '../activities/evaluateWithDigicore.js'
import { persistMeasureReport } from '../activities/persistMeasureReport.js'
import { fetchEligibleMembers } from '../activities/fetchEligibleMembers.js'
import { withTenant } from '../db/withTenant.js'
import { handleMeasureReportCompleted } from '@sim/qualitron-gaps'
import type { Pool } from 'pg'

export interface RunMeasureInput {
  run_id: string
  tenant_id: string
  measure_ref: string
  measure_version: string
  period_start: string
  period_end: string
}

export interface RunMeasureResult {
  run_id: string
  total: number
  failed: number
}

export async function qualitronRunMeasure(
  input: RunMeasureInput,
  pool: Pool,
  taskServiceUrl: string,
): Promise<RunMeasureResult> {
  return withTenant(pool, input.tenant_id, async (client) => {
    await client.query(
      `UPDATE qual.measure_run SET status = 'running', started_at = NOW() WHERE run_id = $1`,
      [input.run_id],
    )

    const { rows: defRows } = await client.query<{
      spec: MeasureSpec
      digicore_library_ref: string | null
    }>(
      `SELECT spec, digicore_library_ref FROM qual.measure_definition WHERE measure_ref = $1 AND version = $2`,
      [input.measure_ref, input.measure_version],
    )
    if (!defRows[0]) {
      await client.query(
        `UPDATE qual.measure_run SET status = 'failed', completed_at = NOW() WHERE run_id = $1`,
        [input.run_id],
      )
      return { run_id: input.run_id, total: 0, failed: 0 }
    }

    const { spec, digicore_library_ref } = defRows[0]
    const members = await fetchEligibleMembers(client)
    let failed = 0

    if (digicore_library_ref) {
      // Digicore CQL path: batch evaluate all members in one HTTP call
      const digiResults = await evaluateWithDigicore({
        tenantId: input.tenant_id,
        libraryRef: digicore_library_ref,
        memberRefs: members,
        periodStart: input.period_start,
        periodEnd: input.period_end,
      })

      for (const dr of digiResults) {
        try {
          const result: MeasureResult = {
            member_id: dr.memberRef,
            measure_ref: input.measure_ref,
            numerator: dr.numerator,
            denominator: dr.denominator,
            exclusion: dr.exclusion,
            evidence_refs: [],
            trace_ref: dr.traceRef,
          }
          await persistMeasureReport(
            client,
            input.run_id,
            input.tenant_id,
            result,
            input.period_start,
            input.period_end,
          )
          await handleMeasureReportCompleted(
            {
              event_type: 'MeasureReportCompleted',
              run_id: input.run_id,
              member_id: result.member_id,
              measure_ref: result.measure_ref,
              numerator: result.numerator,
              denominator: result.denominator,
              exclusion: result.exclusion,
            },
            input.tenant_id,
            input.period_start,
            input.period_end,
            client as unknown as Pool,
            taskServiceUrl,
          )
        } catch {
          failed++
        }
      }
    } else {
      // Legacy SQL path — unchanged
      for (const member of members) {
        try {
          const result = await evaluateMeasure(
            client,
            member,
            input.measure_ref,
            spec,
            input.period_start,
            input.period_end,
          )
          await persistMeasureReport(
            client,
            input.run_id,
            input.tenant_id,
            result,
            input.period_start,
            input.period_end,
          )
          await handleMeasureReportCompleted(
            {
              event_type: 'MeasureReportCompleted',
              run_id: input.run_id,
              member_id: result.member_id,
              measure_ref: result.measure_ref,
              numerator: result.numerator,
              denominator: result.denominator,
              exclusion: result.exclusion,
            },
            input.tenant_id,
            input.period_start,
            input.period_end,
            client as unknown as Pool,
            taskServiceUrl,
          )
        } catch {
          failed++
        }
      }
    }

    await client.query(
      `UPDATE qual.measure_run SET status = 'complete', completed_at = NOW() WHERE run_id = $1`,
      [input.run_id],
    )

    return { run_id: input.run_id, total: members.length, failed }
  })
}
```

- [ ] **Step 6: Run the full execution test suite**

```bash
npx vitest run 2>&1 | tail -15
```

Expected: all tests pass (the workflow test mocks `evaluateWithDigicore` the same way it mocks `evaluateMeasure` — see existing `QualitronRunMeasure.test.ts` for the mock pattern to extend if the test imports `evaluateWithDigicore`).

**If the workflow test fails because `evaluateWithDigicore` is not mocked:** Open `modules/qualitron/execution/src/__tests__/QualitronRunMeasure.test.ts` and add `evaluateWithDigicore: vi.fn()` to the `vi.hoisted` block and `vi.mock('../activities/evaluateWithDigicore.js', () => ({ evaluateWithDigicore }))` alongside the other mocks.

- [ ] **Step 7: Commit**

```bash
git add modules/qualitron/execution/src/activities/evaluateWithDigicore.ts \
        modules/qualitron/execution/src/activities/__tests__/evaluateWithDigicore.test.ts \
        modules/qualitron/execution/src/workflows/QualitronRunMeasure.ts \
        modules/qualitron/execution/src/__tests__/QualitronRunMeasure.test.ts
git commit -m "feat(qualitron): add evaluateWithDigicore activity + route workflow via Digicore CQL when library ref set

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: FHIR MeasureReport builder + persist update (TypeScript)

**Files:**
- Create: `modules/qualitron/execution/src/fhir/buildMeasureReport.ts`
- Create: `modules/qualitron/execution/src/fhir/__tests__/buildMeasureReport.test.ts`
- Modify: `modules/qualitron/execution/src/activities/persistMeasureReport.ts`
- Modify: `modules/qualitron/execution/src/workflows/QualitronRunMeasure.ts`

**Interfaces:**
- Consumes: `MemberResult` from Task 3; `MeasureResult` from existing `evaluateMeasure.ts`
- Produces:
  - `buildIndividualMeasureReport(ctx: MeasureRunContext, member: MemberResult | MeasureResult): object` — FHIR R4 Individual MeasureReport
  - `buildSummaryMeasureReport(ctx: MeasureRunContext, members: Array<MemberResult | MeasureResult>): object` — FHIR R4 Summary MeasureReport
  - `persistMeasureReport` extended with optional `measureUrl?: string` parameter — when provided, writes `report_fhir`
  - New `persistSummaryMeasureReport(client, runId, tenantId, allResults, periodStart, periodEnd, measureUrl)` function at end of run

**Context:** `randomUUID` is available from Node built-in `crypto`. The `measureUrl` for BCS-E is `http://sim.internal/Measure/hedis:BCS-E`. The DEQM population system URL is `http://terminology.hl7.org/CodeSystem/measure-population`. The summary row is written with `member_id = '__summary__'` (sentinel) and `report_type = 'summary'`.

- [ ] **Step 1: Write the failing tests for `buildMeasureReport`**

```typescript
// modules/qualitron/execution/src/fhir/__tests__/buildMeasureReport.test.ts
import { describe, it, expect } from 'vitest'
import {
  buildIndividualMeasureReport,
  buildSummaryMeasureReport,
  type MeasureRunContext,
} from '../buildMeasureReport.js'

const CTX: MeasureRunContext = {
  runId: 'run_01',
  measureRef: 'hedis:BCS-E',
  measureUrl: 'http://sim.internal/Measure/hedis:BCS-E',
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
  tenantId: 'tenant-dev',
}

const MEMBER_IN_NUM = {
  memberRef: 'member-001',
  denominator: true,
  numerator: true,
  exclusion: false,
  exception: false,
  traceRef: 'trace-abc',
  evidenceRefs: ['obs-001'],
}

const MEMBER_NOT_NUM = {
  memberRef: 'member-002',
  denominator: true,
  numerator: false,
  exclusion: false,
  exception: false,
  traceRef: 'trace-def',
}

const DEQM_POP = 'http://terminology.hl7.org/CodeSystem/measure-population'

describe('buildIndividualMeasureReport', () => {
  it('sets resourceType, type, measure, subject correctly', () => {
    const report = buildIndividualMeasureReport(CTX, MEMBER_IN_NUM) as Record<string, unknown>
    expect(report['resourceType']).toBe('MeasureReport')
    expect(report['type']).toBe('individual')
    expect(report['measure']).toBe(CTX.measureUrl)
    expect((report['subject'] as { reference: string })['reference']).toBe('Patient/member-001')
  })

  it('sets population counts for numerator-positive member', () => {
    const report = buildIndividualMeasureReport(CTX, MEMBER_IN_NUM) as any
    const pops: Array<{ code: { coding: [{ code: string }] }; count: number }> =
      report['group'][0]['population']
    const byCode = Object.fromEntries(pops.map(p => [p.code.coding[0]!.code, p.count]))
    expect(byCode['denominator']).toBe(1)
    expect(byCode['numerator']).toBe(1)
    expect(byCode['exclusion']).toBe(0)
    expect(byCode['exception']).toBe(0)
  })

  it('sets evaluatedResource from evidenceRefs', () => {
    const report = buildIndividualMeasureReport(CTX, MEMBER_IN_NUM) as any
    expect(report['evaluatedResource']).toEqual([{ reference: 'obs-001' }])
  })

  it('sets traceRef extension', () => {
    const report = buildIndividualMeasureReport(CTX, MEMBER_IN_NUM) as any
    const ext = report['extension'].find(
      (e: { url: string }) => e.url.includes('trace-ref'),
    )
    expect(ext['valueString']).toBe('trace-abc')
  })

  it('includes DEQM Individual profile in meta', () => {
    const report = buildIndividualMeasureReport(CTX, MEMBER_IN_NUM) as any
    expect(report['meta']['profile'][0]).toContain('indv-measurereport-deqm')
  })
})

describe('buildSummaryMeasureReport', () => {
  it('aggregates population counts across members', () => {
    const report = buildSummaryMeasureReport(CTX, [MEMBER_IN_NUM, MEMBER_NOT_NUM]) as any
    const pops: Array<{ code: { coding: [{ code: string }] }; count: number }> =
      report['group'][0]['population']
    const byCode = Object.fromEntries(pops.map(p => [p.code.coding[0]!.code, p.count]))
    expect(byCode['denominator']).toBe(2)
    expect(byCode['numerator']).toBe(1)
    expect(byCode['exclusion']).toBe(0)
  })

  it('computes measureScore as numerator / denominator', () => {
    const report = buildSummaryMeasureReport(CTX, [MEMBER_IN_NUM, MEMBER_NOT_NUM]) as any
    expect(report['group'][0]['measureScore']['value']).toBe(0.5)
  })

  it('measureScore is 0 when denominator is 0 (no division by zero)', () => {
    const report = buildSummaryMeasureReport(CTX, []) as any
    expect(report['group'][0]['measureScore']['value']).toBe(0)
  })

  it('has type summary and DEQM Summary profile', () => {
    const report = buildSummaryMeasureReport(CTX, []) as any
    expect(report['type']).toBe('summary')
    expect(report['meta']['profile'][0]).toContain('summary-measurereport-deqm')
  })
})
```

- [ ] **Step 2: Run the tests, confirm they fail**

```bash
cd modules/qualitron/execution
npx vitest run src/fhir/__tests__/buildMeasureReport.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `buildMeasureReport.ts`**

```typescript
// modules/qualitron/execution/src/fhir/buildMeasureReport.ts
import { randomUUID } from 'crypto'

export interface MeasureRunContext {
  runId: string
  measureRef: string
  measureUrl: string
  periodStart: string
  periodEnd: string
  tenantId: string
}

// Accepts either MemberResult (from evaluateWithDigicore) or MeasureResult (legacy SQL)
export interface PopulationInput {
  memberRef?: string
  member_id?: string
  denominator: boolean
  numerator: boolean
  exclusion: boolean
  exception?: boolean
  traceRef?: string
  trace_ref?: string | null
  evidenceRefs?: string[]
  evidence_refs?: string[]
}

const DEQM_POP_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/measure-population'

function popCode(code: string) {
  return { coding: [{ system: DEQM_POP_SYSTEM, code }] }
}

function memberId(m: PopulationInput): string {
  return (m.memberRef ?? m.member_id) || 'unknown'
}

function traceRef(m: PopulationInput): string | null {
  return m.traceRef ?? m.trace_ref ?? null
}

function evidenceRefs(m: PopulationInput): string[] {
  return m.evidenceRefs ?? m.evidence_refs ?? []
}

export function buildIndividualMeasureReport(
  ctx: MeasureRunContext,
  member: PopulationInput,
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
    subject: { reference: `Patient/${memberId(member)}` },
    date: new Date().toISOString(),
    period: { start: ctx.periodStart, end: ctx.periodEnd },
    group: [
      {
        population: [
          { code: popCode('denominator'), count: member.denominator ? 1 : 0 },
          { code: popCode('numerator'),   count: member.numerator   ? 1 : 0 },
          { code: popCode('exclusion'),   count: member.exclusion   ? 1 : 0 },
          { code: popCode('exception'),   count: (member.exception ?? false) ? 1 : 0 },
        ],
      },
    ],
    evaluatedResource: evidenceRefs(member).map(ref => ({ reference: ref })),
    extension: [
      {
        url: 'http://sim.internal/fhir/StructureDefinition/trace-ref',
        valueString: traceRef(member) ?? '',
      },
    ],
  }
}

export function buildSummaryMeasureReport(
  ctx: MeasureRunContext,
  members: PopulationInput[],
): object {
  const sum = (fn: (m: PopulationInput) => boolean) =>
    members.filter(fn).length

  const denomCount = sum(m => m.denominator)
  const numCount   = sum(m => m.numerator)

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
          { code: popCode('denominator'), count: denomCount },
          { code: popCode('numerator'),   count: numCount },
          { code: popCode('exclusion'),   count: sum(m => m.exclusion) },
          { code: popCode('exception'),   count: sum(m => m.exception ?? false) },
        ],
        measureScore: {
          value: denomCount > 0 ? numCount / denomCount : 0,
        },
      },
    ],
  }
}
```

- [ ] **Step 4: Run the FHIR builder tests, confirm all 9 pass**

```bash
npx vitest run src/fhir/__tests__/buildMeasureReport.test.ts 2>&1 | tail -10
```

Expected: 9/9 PASS.

- [ ] **Step 5: Modify `persistMeasureReport.ts` to write `report_fhir` when `measureUrl` provided**

Read `modules/qualitron/execution/src/activities/persistMeasureReport.ts` then replace with:

```typescript
// modules/qualitron/execution/src/activities/persistMeasureReport.ts
import type { PoolClient } from 'pg'
import { ulid } from 'ulid'
import type { MeasureResult } from './evaluateMeasure.js'
import {
  buildIndividualMeasureReport,
  type MeasureRunContext,
} from '../fhir/buildMeasureReport.js'

export async function persistMeasureReport(
  client: PoolClient,
  runId: string,
  tenantId: string,
  result: MeasureResult,
  periodStart: string,
  periodEnd: string,
  measureUrl?: string,
): Promise<void> {
  const reportId = ulid()

  const fhirCtx: MeasureRunContext | undefined = measureUrl
    ? { runId, measureRef: result.measure_ref, measureUrl, periodStart, periodEnd, tenantId }
    : undefined

  const reportFhir = fhirCtx
    ? buildIndividualMeasureReport(fhirCtx, {
        member_id: result.member_id,
        denominator: result.denominator,
        numerator: result.numerator,
        exclusion: result.exclusion,
        evidence_refs: result.evidence_refs,
        trace_ref: result.trace_ref,
      })
    : null

  await client.query(
    `INSERT INTO qual.measure_report
       (report_id, tenant_id, run_id, member_id, measure_ref,
        period_start, period_end, numerator, denominator, exclusion,
        report, evidence_refs, trace_ref, report_fhir, report_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15)`,
    [
      reportId,
      tenantId,
      runId,
      result.member_id,
      result.measure_ref,
      periodStart,
      periodEnd,
      result.numerator,
      result.denominator,
      result.exclusion,
      JSON.stringify(result),
      JSON.stringify(result.evidence_refs),
      result.trace_ref,
      reportFhir ? JSON.stringify(reportFhir) : null,
      'individual',
    ],
  )

  const eventId = 'evt_' + ulid()
  const envelope = {
    event_id: eventId,
    schema_ref: 'sim.qual.measure/MeasureReportCompleted/v1',
    occurred_at: new Date().toISOString(),
    tenant: { tenant_id: tenantId },
    correlation_id: runId,
    payload: {
      event_type: 'MeasureReportCompleted',
      run_id: runId,
      member_id: result.member_id,
      measure_ref: result.measure_ref,
      numerator: result.numerator,
      denominator: result.denominator,
      exclusion: result.exclusion,
    },
  }

  await client.query(
    `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
     VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [
      eventId,
      'sim.qual.measure',
      result.member_id,
      JSON.stringify(envelope),
      tenantId,
    ],
  )
}

export async function persistSummaryMeasureReport(
  client: PoolClient,
  runId: string,
  tenantId: string,
  measureRef: string,
  measureUrl: string,
  allResults: MeasureResult[],
  periodStart: string,
  periodEnd: string,
): Promise<void> {
  const ctx: MeasureRunContext = {
    runId,
    measureRef,
    measureUrl,
    periodStart,
    periodEnd,
    tenantId,
  }
  const { buildSummaryMeasureReport } = await import('../fhir/buildMeasureReport.js')
  const summaryFhir = buildSummaryMeasureReport(ctx, allResults)

  // Compute aggregate booleans for the summary row's boolean columns
  const hasDenom = allResults.some(r => r.denominator)
  const hasNum   = allResults.some(r => r.numerator)
  const hasExcl  = allResults.some(r => r.exclusion)

  await client.query(
    `INSERT INTO qual.measure_report
       (report_id, tenant_id, run_id, member_id, measure_ref,
        period_start, period_end, numerator, denominator, exclusion,
        report, evidence_refs, trace_ref, report_fhir, report_type)
     VALUES ($1,$2,$3,'__summary__',$4,$5,$6,$7,$8,$9,$10::jsonb,'[]'::jsonb,NULL,$11::jsonb,'summary')`,
    [
      ulid(),
      tenantId,
      runId,
      measureRef,
      periodStart,
      periodEnd,
      hasNum,
      hasDenom,
      hasExcl,
      JSON.stringify({ summary: true }),
      JSON.stringify(summaryFhir),
    ],
  )
}
```

- [ ] **Step 6: Update `QualitronRunMeasure.ts` to pass `measureUrl` + call `persistSummaryMeasureReport` at run end**

In the Digicore CQL path block of `QualitronRunMeasure.ts`, change the `persistMeasureReport` call to pass `measureUrl`, and add a summary persist after the loop. Also collect results for the summary:

```typescript
// At the top of the file, add import:
import {
  persistMeasureReport,
  persistSummaryMeasureReport,
} from '../activities/persistMeasureReport.js'

// In the digicore_library_ref branch, after `const digiResults = await evaluateWithDigicore({...})`:
const measureUrl = `http://sim.internal/Measure/${input.measure_ref}`
const allResults: MeasureResult[] = []

for (const dr of digiResults) {
  try {
    const result: MeasureResult = {
      member_id: dr.memberRef,
      measure_ref: input.measure_ref,
      numerator: dr.numerator,
      denominator: dr.denominator,
      exclusion: dr.exclusion,
      evidence_refs: [],
      trace_ref: dr.traceRef,
    }
    await persistMeasureReport(
      client,
      input.run_id,
      input.tenant_id,
      result,
      input.period_start,
      input.period_end,
      measureUrl,          // <-- NEW: triggers FHIR individual report
    )
    allResults.push(result)
    await handleMeasureReportCompleted(...)
  } catch {
    failed++
  }
}

// After the member loop, before the final UPDATE:
if (allResults.length > 0) {
  await persistSummaryMeasureReport(
    client,
    input.run_id,
    input.tenant_id,
    input.measure_ref,
    measureUrl,
    allResults,
    input.period_start,
    input.period_end,
  )
}
```

- [ ] **Step 7: Run the full execution module tests**

```bash
npx vitest run 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add modules/qualitron/execution/src/fhir/buildMeasureReport.ts \
        modules/qualitron/execution/src/fhir/__tests__/buildMeasureReport.test.ts \
        modules/qualitron/execution/src/activities/persistMeasureReport.ts \
        modules/qualitron/execution/src/workflows/QualitronRunMeasure.ts
git commit -m "feat(qualitron): FHIR R4 DEQM MeasureReport generation (individual + summary) per run

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Reporting service mount + submission endpoint

**Files:**
- Create: `services/qualitron-reporting/Dockerfile`
- Create: `services/qualitron-reporting/src/server.ts`
- Modify: `modules/qualitron/reporting/src/routes/measures.ts` (add FHIR report endpoint)
- Create: `modules/qualitron/reporting/src/routes/__tests__/fhirReport.test.ts`
- Modify: `infra/compose/docker-compose.yml` (add `qualitron-reporting` service)

**Interfaces:**
- Consumes: `qual.measure_report WHERE report_type = 'summary'` and `report_fhir JSONB` (from Task 4)
- Produces:
  - `GET /v1/quality/measures/:ref/runs/:runId/report` → FHIR Summary MeasureReport JSON (`Content-Type: application/fhir+json`)
  - Reporting service running on port `4080`

**Context:** The existing `createMeasuresRouter(pool)` in `measures.ts` exports routes at `/v1/quality/measures/...`. Add the new FHIR report endpoint to the same router. The `server.ts` creates an Express app, mounts the router, and listens on `PORT` env var. Pattern: follow `modules/claims/service/Dockerfile` exactly (multi-stage pnpm build). The `report_fhir` column may be `null` for runs that predate Task 4 — return 404 in that case.

- [ ] **Step 1: Write the failing test for the FHIR report endpoint**

```typescript
// modules/qualitron/reporting/src/routes/__tests__/fhirReport.test.ts
import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { Pool } from 'pg'

// We test only the new endpoint added to createMeasuresRouter
const FHIR_REPORT = {
  resourceType: 'MeasureReport',
  type: 'summary',
  status: 'complete',
}

function makePool(reportFhir: object | null) {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('report_type')) {
        return Promise.resolve({
          rows: reportFhir ? [{ report_fhir: reportFhir }] : [],
        })
      }
      return Promise.resolve({ rows: [] })
    }),
  } as unknown as Pool
}

async function buildApp(pool: Pool) {
  const { createMeasuresRouter } = await import('../measures.js')
  const app = express()
  app.use(express.json())
  app.use(createMeasuresRouter(pool))
  return app
}

describe('GET /v1/quality/measures/:ref/runs/:runId/report', () => {
  it('returns FHIR summary MeasureReport as application/fhir+json', async () => {
    const app = await buildApp(makePool(FHIR_REPORT))
    const res = await request(app)
      .get('/v1/quality/measures/hedis:BCS-E/runs/run-01/report')
      .set('x-sim-tenant-id', 'tenant-dev')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/fhir\+json/)
    expect(res.body['resourceType']).toBe('MeasureReport')
    expect(res.body['type']).toBe('summary')
  })

  it('returns 404 when no summary report exists', async () => {
    const app = await buildApp(makePool(null))
    const res = await request(app)
      .get('/v1/quality/measures/hedis:BCS-E/runs/run-99/report')
      .set('x-sim-tenant-id', 'tenant-dev')
    expect(res.status).toBe(404)
  })

  it('returns 401 when tenant header is missing', async () => {
    const app = await buildApp(makePool(FHIR_REPORT))
    const res = await request(app)
      .get('/v1/quality/measures/hedis:BCS-E/runs/run-01/report')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd modules/qualitron/reporting
npx vitest run src/routes/__tests__/fhirReport.test.ts 2>&1 | tail -10
```

Expected: FAIL — endpoint not found (404 for all).

- [ ] **Step 3: Add the FHIR report endpoint to `measures.ts`**

At the end of `createMeasuresRouter`, before `return router`, add:

```typescript
// GET /v1/quality/measures/:ref/runs/:runId/report — FHIR submission-ready Summary MeasureReport
router.get('/v1/quality/measures/:ref/runs/:runId/report', async (req, res, next) => {
  try {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined
    if (!tenantId) {
      res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' })
      return
    }
    const { runId } = req.params as { runId: string }
    const { rows } = await pool.query<{ report_fhir: object }>(
      `SELECT report_fhir FROM qual.measure_report
       WHERE run_id = $1 AND tenant_id = $2 AND report_type = 'summary'
       LIMIT 1`,
      [runId, tenantId],
    )
    if (!rows[0] || !rows[0].report_fhir) {
      res.status(404).json({ code: 'NOT_FOUND', detail: 'No summary report for this run' })
      return
    }
    res.status(200)
      .header('Content-Type', 'application/fhir+json')
      .json(rows[0].report_fhir)
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 4: Run the tests, confirm all 3 pass**

```bash
npx vitest run src/routes/__tests__/fhirReport.test.ts 2>&1 | tail -10
```

Expected: 3/3 PASS.

- [ ] **Step 5: Run the full reporting module tests**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 6: Create `services/qualitron-reporting/src/server.ts`**

```typescript
// services/qualitron-reporting/src/server.ts
import express from 'express'
import pg from 'pg'
import { createMeasuresRouter } from '@sim/qualitron-reporting'

const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] })
const app = express()
app.use(express.json())
app.use(createMeasuresRouter(pool))
app.get('/health', (_req, res) => res.json({ ok: true }))

const port = parseInt(process.env['PORT'] ?? '4080', 10)
app.listen(port, () => console.log(`qualitron-reporting listening on ${port}`))
```

- [ ] **Step 7: Create `services/qualitron-reporting/Dockerfile`**

Follow `modules/claims/service/Dockerfile` exactly:

```dockerfile
# services/qualitron-reporting/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY modules/qualitron/reporting/package.json ./modules/qualitron/reporting/

RUN pnpm install --frozen-lockfile --filter @sim/qualitron-reporting...

COPY modules/qualitron/reporting/ ./modules/qualitron/reporting/
COPY services/qualitron-reporting/  ./services/qualitron-reporting/

RUN pnpm --filter @sim/qualitron-reporting run build
RUN pnpm --filter @sim/qualitron-reporting-service run build

RUN pnpm --filter @sim/qualitron-reporting-service deploy --legacy --prod /deploy

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /deploy .
ENV NODE_ENV=production
ENV PORT=4080
EXPOSE 4080
CMD ["node", "dist/server.js"]
```

**Note:** The `services/qualitron-reporting` directory needs its own `package.json` with `name: "@sim/qualitron-reporting-service"`, `main: "dist/server.js"`, and a dependency on `@sim/qualitron-reporting`. Create it:

```json
{
  "name": "@sim/qualitron-reporting-service",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@sim/qualitron-reporting": "workspace:*",
    "express": "^4.18.0",
    "pg": "^8.11.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

Also create `services/qualitron-reporting/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 8: Add `qualitron-reporting` to `docker-compose.yml`**

Find the `infra/compose/docker-compose.yml` file. Locate the `services:` block. Add:

```yaml
  qualitron-reporting:
    build:
      context: ../../
      dockerfile: services/qualitron-reporting/Dockerfile
    environment:
      DATABASE_URL: ${DATABASE_URL:-postgresql://sim_app:sim_app_password@postgres:5432/simintero}
      PORT: "4080"
    ports:
      - "4080:4080"
    depends_on:
      - postgres
    restart: unless-stopped
```

- [ ] **Step 9: Commit**

```bash
git add modules/qualitron/reporting/src/routes/measures.ts \
        modules/qualitron/reporting/src/routes/__tests__/fhirReport.test.ts \
        services/qualitron-reporting/ \
        infra/compose/docker-compose.yml
git commit -m "feat(qualitron): mount reporting service + add FHIR submission output endpoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Aggregation service + `EvidenceIndexedConsumer` + batch schedule

**Files:**
- Create: `modules/qualitron/aggregation/src/consumers/EvidenceIndexedConsumer.ts`
- Create: `modules/qualitron/aggregation/src/consumers/__tests__/EvidenceIndexedConsumer.test.ts`
- Create: `modules/qualitron/aggregation/src/schedules/MeasureBatchSchedule.ts`
- Create: `services/qualitron-aggregation/src/server.ts`
- Create: `services/qualitron-aggregation/package.json`
- Create: `services/qualitron-aggregation/tsconfig.json`
- Create: `services/qualitron-aggregation/Dockerfile`
- Modify: `infra/compose/docker-compose.yml`

**Interfaces:**
- Consumes:
  - Kafka topic `sim.qual.evidence`, event type `EvidenceIndexed` — payload has `{ event_type, source_event_id, doc_id, case_ref }` and envelope has `tenant_id`
  - `qual.measure_definition WHERE digicore_library_ref IS NOT NULL` (active CQL-backed measures)
  - `ens.case WHERE case_ref = $1` — to resolve `member_ref` from case
  - `POST /v1/runtime/measure-evaluate` on Digicore (same pattern as Task 3)
  - `qual.gap WHERE member_id = $1 AND measure_ref = $2 AND status = 'open'` — gap to close
  - `POST /v1/quality/runs` on `QUALITRON_EXECUTION_URL` — for nightly batch trigger
- Produces:
  - Upserts `qual.measure_report` with new `report_fhir`
  - Closes `qual.gap` rows and emits `QualGapClosed` outbox events (to be consumed in Task 7)
  - Triggers nightly batch runs via HTTP to qualitron-execution

**Context:** The aggregation module already has `withTenant` at `src/db/withTenant.ts`. The Kafka consumer uses the project's Kafka client pattern — look at how the Enstellar Python consumers do it; in TypeScript we use `kafkajs`. The `EvidenceIndexedConsumer` acks even on evaluator error (log + ack) to avoid poisoning the topic for transient per-member failures. The `MeasureBatchSchedule` uses `setInterval` (no new deps) to call `triggerBatchRuns` every 24 hours.

- [ ] **Step 1: Write the failing test**

```typescript
// modules/qualitron/aggregation/src/consumers/__tests__/EvidenceIndexedConsumer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function makePool(queryResponses: Array<{ rows: unknown[] }> = []) {
  let idx = 0
  const client = {
    query: vi.fn().mockImplementation(() =>
      Promise.resolve(queryResponses[idx++] ?? { rows: [] }),
    ),
    release: vi.fn(),
  }
  return {
    pool: { connect: vi.fn().mockResolvedValue(client) } as any,
    client,
  }
}

describe('handleEvidenceIndexed', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls Digicore and closes gap when numerator flips true', async () => {
    const { pool, client } = makePool([
      { rows: [] },                                              // BEGIN (implicit in withTenant)
      { rows: [{ measure_ref: 'hedis:BCS-E', measure_version: '1.0.0', digicore_library_ref: 'url', tenant_id: 'tenant-dev' }] }, // measure_definitions
      { rows: [{ member_ref: 'member-001' }] },                  // ens.case lookup
      { rows: [{ gap_id: 'gap-01', member_id: 'member-001', measure_ref: 'hedis:BCS-E', period_start: '2025-01-01', period_end: '2025-12-31' }] }, // open gaps
      { rows: [] },                                              // UPDATE qual.gap
      { rows: [] },                                              // INSERT shared.outbox
    ])

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ memberRef: 'member-001', denominator: true, numerator: true, exclusion: false, exception: false, traceRef: 'trace-x' }],
      }),
    })

    const { handleEvidenceIndexed } = await import('../EvidenceIndexedConsumer.js')
    await handleEvidenceIndexed(
      { event_type: 'EvidenceIndexed', source_event_id: 'evt1', doc_id: 'doc1', case_ref: 'case-001' },
      'tenant-dev',
      pool,
    )

    // Should have called Digicore
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/runtime/measure-evaluate'),
      expect.any(Object),
    )
    // Should have closed the gap
    const calls = client.query.mock.calls as Array<[string, ...unknown[]]>
    const updateGapCall = calls.find(c => typeof c[0] === 'string' && c[0].includes("status = 'closed'"))
    expect(updateGapCall).toBeTruthy()
  })

  it('does NOT close gap when numerator stays false', async () => {
    const { pool, client } = makePool([
      { rows: [] },
      { rows: [{ measure_ref: 'hedis:BCS-E', measure_version: '1.0.0', digicore_library_ref: 'url', tenant_id: 'tenant-dev' }] },
      { rows: [{ member_ref: 'member-002' }] },
      { rows: [{ gap_id: 'gap-02', member_id: 'member-002', measure_ref: 'hedis:BCS-E', period_start: '2025-01-01', period_end: '2025-12-31' }] },
    ])

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ memberRef: 'member-002', denominator: true, numerator: false, exclusion: false, exception: false, traceRef: 'trace-y' }],
      }),
    })

    const { handleEvidenceIndexed } = await import('../EvidenceIndexedConsumer.js')
    await handleEvidenceIndexed(
      { event_type: 'EvidenceIndexed', source_event_id: 'evt2', doc_id: 'doc2', case_ref: 'case-002' },
      'tenant-dev',
      pool,
    )

    const calls = client.query.mock.calls as Array<[string, ...unknown[]]>
    const closeCall = calls.find(c => typeof c[0] === 'string' && c[0].includes("status = 'closed'"))
    expect(closeCall).toBeUndefined()
  })

  it('acks without throwing even when Digicore returns error', async () => {
    const { pool } = makePool([
      { rows: [] },
      { rows: [{ measure_ref: 'hedis:BCS-E', measure_version: '1.0.0', digicore_library_ref: 'url', tenant_id: 'tenant-dev' }] },
      { rows: [{ member_ref: 'member-003' }] },
    ])

    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'unavailable' })

    const { handleEvidenceIndexed } = await import('../EvidenceIndexedConsumer.js')
    // Should not throw
    await expect(
      handleEvidenceIndexed(
        { event_type: 'EvidenceIndexed', source_event_id: 'evt3', doc_id: 'doc3', case_ref: 'case-003' },
        'tenant-dev',
        pool,
      )
    ).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd modules/qualitron/aggregation
npx vitest run src/consumers/__tests__/EvidenceIndexedConsumer.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `EvidenceIndexedConsumer.ts`**

```typescript
// modules/qualitron/aggregation/src/consumers/EvidenceIndexedConsumer.ts
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
              // period: use current calendar year as default
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
```

- [ ] **Step 4: Run the tests, confirm all 3 pass**

```bash
npx vitest run src/consumers/__tests__/EvidenceIndexedConsumer.test.ts 2>&1 | tail -10
```

Expected: 3/3 PASS.

- [ ] **Step 5: Write `MeasureBatchSchedule.ts`**

```typescript
// modules/qualitron/aggregation/src/schedules/MeasureBatchSchedule.ts
import type { Pool } from 'pg'
import { withTenant } from '../db/withTenant.js'

const EXECUTION_URL =
  process.env['QUALITRON_EXECUTION_URL'] ?? 'http://localhost:4020'

export async function triggerBatchRuns(pool: Pool): Promise<void> {
  // Query one row per (tenant_id, measure_ref) pair that has a Digicore library ref
  const { rows } = await pool.query<{
    measure_ref: string
    version: string
    tenant_id: string
  }>(
    `SELECT measure_ref, version, tenant_id
     FROM qual.measure_definition
     WHERE digicore_library_ref IS NOT NULL`,
  )

  const periodStart = `${new Date().getFullYear()}-01-01`
  const periodEnd = new Date().toISOString().split('T')[0]!

  for (const row of rows) {
    try {
      await fetch(`${EXECUTION_URL}/v1/quality/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sim-tenant-id': row.tenant_id,
        },
        body: JSON.stringify({
          measure_ref: row.measure_ref,
          measure_version: row.version,
          period_start: periodStart,
          period_end: periodEnd,
        }),
      })
    } catch (err) {
      console.error(`MeasureBatchSchedule: failed to trigger run for ${row.measure_ref}:`, err)
    }
  }
}

// Returns the interval handle so callers can clear it in tests
export function scheduleDailyBatch(pool: Pool): ReturnType<typeof setInterval> {
  const MS_24H = 24 * 60 * 60 * 1000
  return setInterval(() => {
    triggerBatchRuns(pool).catch(err =>
      console.error('MeasureBatchSchedule: batch run error:', err),
    )
  }, MS_24H)
}
```

- [ ] **Step 6: Create `services/qualitron-aggregation/src/server.ts`**

```typescript
// services/qualitron-aggregation/src/server.ts
import { Kafka } from 'kafkajs'
import pg from 'pg'
import express from 'express'
import { handleEvidenceIndexed } from '@sim/qualitron-aggregation'
import { scheduleDailyBatch } from '@sim/qualitron-aggregation/schedules/MeasureBatchSchedule.js'

const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] })

const kafka = new Kafka({
  clientId: 'qualitron-aggregation',
  brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(','),
})

async function startConsumer() {
  const consumer = kafka.consumer({ groupId: 'qualitron-aggregation-evidence' })
  await consumer.connect()
  await consumer.subscribe({ topic: 'sim.qual.evidence', fromBeginning: false })

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return
      try {
        const envelope = JSON.parse(message.value.toString()) as {
          tenant?: { tenant_id?: string }
          payload?: { event_type?: string }
        }
        const tenantId = envelope.tenant?.tenant_id
        if (!tenantId) return
        const payload = envelope.payload
        if (payload?.event_type !== 'EvidenceIndexed') return
        await handleEvidenceIndexed(payload as any, tenantId, pool)
      } catch (err) {
        console.error('qualitron-aggregation consumer error:', err)
        // Swallow — we don't want to crash the consumer on bad messages
      }
    },
  })
}

// Health check HTTP server
const app = express()
app.get('/health', (_req, res) => res.json({ ok: true }))
const port = parseInt(process.env['PORT'] ?? '4081', 10)
app.listen(port)

// Start Kafka consumer
startConsumer().catch(err => {
  console.error('Failed to start aggregation consumer:', err)
  process.exit(1)
})

// Schedule nightly batch runs
scheduleDailyBatch(pool)
console.log('qualitron-aggregation started')
```

- [ ] **Step 7: Create `services/qualitron-aggregation/package.json` and `tsconfig.json`**

```json
{
  "name": "@sim/qualitron-aggregation-service",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@sim/qualitron-aggregation": "workspace:*",
    "express": "^4.18.0",
    "kafkajs": "^2.2.4",
    "pg": "^8.11.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 8: Create `services/qualitron-aggregation/Dockerfile`**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY modules/qualitron/aggregation/package.json ./modules/qualitron/aggregation/
COPY services/qualitron-aggregation/package.json ./services/qualitron-aggregation/

RUN pnpm install --frozen-lockfile --filter @sim/qualitron-aggregation-service...

COPY modules/qualitron/aggregation/ ./modules/qualitron/aggregation/
COPY services/qualitron-aggregation/ ./services/qualitron-aggregation/

RUN pnpm --filter @sim/qualitron-aggregation run build
RUN pnpm --filter @sim/qualitron-aggregation-service run build
RUN pnpm --filter @sim/qualitron-aggregation-service deploy --legacy --prod /deploy

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /deploy .
ENV NODE_ENV=production
ENV PORT=4081
EXPOSE 4081
CMD ["node", "dist/server.js"]
```

- [ ] **Step 9: Add `qualitron-aggregation` to `docker-compose.yml`**

```yaml
  qualitron-aggregation:
    build:
      context: ../../
      dockerfile: services/qualitron-aggregation/Dockerfile
    environment:
      DATABASE_URL: ${DATABASE_URL:-postgresql://sim_app:sim_app_password@postgres:5432/simintero}
      KAFKA_BROKERS: ${KAFKA_BROKERS:-redpanda:9092}
      DIGICORE_SERVICE_URL: ${DIGICORE_SERVICE_URL:-http://digicore-runtime:8080}
      QUALITRON_EXECUTION_URL: ${QUALITRON_EXECUTION_URL:-http://qualitron-execution:4020}
      PORT: "4081"
    ports:
      - "4081:4081"
    depends_on:
      - postgres
      - redpanda
    restart: unless-stopped
```

- [ ] **Step 10: Run aggregation module tests**

```bash
cd modules/qualitron/aggregation
npx vitest run 2>&1 | tail -10
```

Expected: all tests pass (including pre-existing EvidenceConsumer and CaseLifecycleConsumer tests).

- [ ] **Step 11: Commit**

```bash
git add modules/qualitron/aggregation/src/consumers/EvidenceIndexedConsumer.ts \
        modules/qualitron/aggregation/src/consumers/__tests__/EvidenceIndexedConsumer.test.ts \
        modules/qualitron/aggregation/src/schedules/MeasureBatchSchedule.ts \
        services/qualitron-aggregation/ \
        infra/compose/docker-compose.yml
git commit -m "feat(qualitron): mount aggregation service + EvidenceIndexed consumer + nightly batch schedule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `QualGapClosed` outbox event + Enstellar consumer (TypeScript + Python)

**Files:**
- Modify: `modules/qualitron/gaps/src/GapEventHandler.ts` (emit `QualGapClosed` outbox event on gap closure)
- Modify: `modules/qualitron/gaps/src/__tests__/GapDetector.test.ts` — check existing test still passes; add outbox assertion
- Create: `services/enstellar-workflow/enstellar_workflow/consumers/qual_gap_closed_consumer.py`
- Create: `services/enstellar-workflow/tests/consumers/test_qual_gap_closed_consumer.py`
- Modify: `services/enstellar-workflow/enstellar_workflow/consumers/__init__.py` (register new consumer if applicable)

**Interfaces:**
- Consumes:
  - `qual.gap` row with `gap_id`, `member_id`, `measure_ref`, `period_start`, `period_end`, `tenant_id`
  - `qual.outreach_task_ref WHERE gap_id = $1` — to find the linked task
  - Enstellar `Task Service` HTTP API — to mark task resolved
- Produces:
  - Outbox event `QualGapClosed` on topic `qual.gap.closed` (from `GapEventHandler.ts`)
  - Task Service HTTP call marking outreach task resolved (from Python consumer)

**Context:** `GapEventHandler.ts` closes gaps in the `else if (payload.numerator)` branch (lines ~76-84 of the current file). The existing `pool.query` call there does NOT use `withTenant` — it receives the pool as the 5th argument to `handleMeasureReportCompleted`, and the pool is actually the `PoolClient` from the outer transaction (cast to `Pool`). Add the outbox INSERT in the same `UPDATE qual.gap` block. The Python consumer follows the `RfiResponseConsumer` pattern exactly: `class QualGapClosedConsumer(IdempotentKafkaConsumer)` with `handle(event)`. It queries `qual.outreach_task_ref` for the `gap_id`, then calls the Task Service to mark the task resolved. If no outreach task exists, log and return (not an error).

- [ ] **Step 1: Write the failing test addition for `GapEventHandler`**

Look at the existing test file `modules/qualitron/gaps/src/__tests__/OutreachTaskCreator.test.ts` for the pool mock pattern. Then open `GapDetector.test.ts` to understand the existing test structure.

Add a new test file for `GapEventHandler`:

```typescript
// modules/qualitron/gaps/src/__tests__/GapEventHandler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function makePool(responses: Array<{ rows: unknown[] }> = []) {
  let idx = 0
  return {
    query: vi.fn().mockImplementation(() =>
      Promise.resolve(responses[idx++] ?? { rows: [] }),
    ),
  } as any
}

const BASE_PAYLOAD = {
  event_type: 'MeasureReportCompleted' as const,
  run_id: 'run_01',
  member_id: 'member-001',
  measure_ref: 'hedis:BCS-E',
  numerator: true,
  denominator: true,
  exclusion: false,
}

describe('handleMeasureReportCompleted — gap closure outbox', () => {
  beforeEach(() => vi.resetAllMocks())

  it('emits QualGapClosed outbox event when gap is closed', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ task_id: 'task-001' }) })

    const pool = makePool([
      // detectGap → has_gap=false (numerator=true), so goes to the else-if close branch
      { rows: [{ gap_id: 'gap-01' }] },   // SELECT existing open gap
      { rows: [] },                         // UPDATE gap SET status = 'closed'
      { rows: [] },                         // INSERT shared.outbox (QualGapClosed)
    ])

    const { handleMeasureReportCompleted } = await import('../GapEventHandler.js')
    await handleMeasureReportCompleted(
      BASE_PAYLOAD,
      'tenant-dev',
      '2025-01-01',
      '2025-12-31',
      pool,
      'http://localhost:5050',
    )

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown[]]>
    const outboxCall = calls.find(
      c => typeof c[0] === 'string' && c[0].includes('shared.outbox'),
    )
    expect(outboxCall).toBeTruthy()

    const envelope = JSON.parse(outboxCall![1]![3] as string) as {
      payload: { event_type: string; gap_id: string; member_id: string }
    }
    expect(envelope.payload.event_type).toBe('QualGapClosed')
    expect(envelope.payload.gap_id).toBe('gap-01')
    expect(envelope.payload.member_id).toBe('member-001')
  })

  it('does not emit outbox event when no open gap exists', async () => {
    const pool = makePool([
      { rows: [] }, // no open gaps
    ])

    const { handleMeasureReportCompleted } = await import('../GapEventHandler.js')
    await handleMeasureReportCompleted(
      BASE_PAYLOAD,
      'tenant-dev',
      '2025-01-01',
      '2025-12-31',
      pool,
      'http://localhost:5050',
    )

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown[]]>
    const outboxCall = calls.find(
      c => typeof c[0] === 'string' && c[0].includes('shared.outbox') && (c[0] as string).includes('QualGapClosed'),
    )
    expect(outboxCall).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails (no outbox INSERT yet)**

```bash
cd modules/qualitron/gaps
npx vitest run src/__tests__/GapEventHandler.test.ts 2>&1 | tail -10
```

Expected: FAIL — outbox INSERT not found.

- [ ] **Step 3: Modify `GapEventHandler.ts` to emit `QualGapClosed` on gap closure**

Read the current `GapEventHandler.ts` first. In the `else if (payload.numerator)` branch, after the `UPDATE qual.gap SET status = 'closed'...` query, add the outbox INSERT.

Replace the `else if` block at the bottom of `handleMeasureReportCompleted`:

```typescript
  } else if (payload.numerator) {
    // Numerator met — close any open gaps for this member+measure+period
    const { rows: closedGaps } = await pool.query<{
      gap_id: string;
      member_id: string;
      measure_ref: string;
    }>(
      `UPDATE qual.gap
       SET status = 'closed', closed_at = NOW(), closure_reason = 'numerator_met'
       WHERE tenant_id = $1 AND member_id = $2 AND measure_ref = $3
         AND period_start = $4 AND period_end = $5 AND status = 'open'
       RETURNING gap_id, member_id, measure_ref`,
      [tenantId, payload.member_id, payload.measure_ref, periodStart, periodEnd],
    );
    for (const gap of closedGaps) {
      const eventId = 'evt_' + ulid();
      const closedAt = new Date().toISOString();
      await pool.query(
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
      );
    }
  }
```

Note: we changed the `UPDATE` to use `RETURNING gap_id, member_id, measure_ref` so we get the gap details back for the outbox event.

- [ ] **Step 4: Run the gaps module tests**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: all tests pass including the two new GapEventHandler tests.

- [ ] **Step 5: Write the Enstellar Python consumer test**

```python
# services/enstellar-workflow/tests/consumers/test_qual_gap_closed_consumer.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from canonical_model import EventEnvelope

from enstellar_workflow.consumers.qual_gap_closed_consumer import QualGapClosedConsumer


def make_envelope(gap_id: str = "gap-01", member_id: str = "member-001") -> EventEnvelope:
    return EventEnvelope.model_validate({
        "event_id": "evt-test-001",
        "schema_ref": "sim.qual.gap/QualGapClosed/v1",
        "occurred_at": "2026-01-01T00:00:00Z",
        "tenant": {"tenant_id": "tenant-dev"},
        "correlation_id": gap_id,
        "payload": {
            "event_type": "QualGapClosed",
            "gap_id": gap_id,
            "member_id": member_id,
            "measure_ref": "hedis:BCS-E",
            "closed_at": "2026-01-01T00:00:00Z",
        },
    })


@pytest.mark.asyncio
async def test_resolves_outreach_task_when_gap_has_one():
    pool = AsyncMock()
    conn = AsyncMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    # qual.outreach_task_ref returns a task_id
    conn.fetchrow = AsyncMock(return_value={"task_id": "task-001"})
    conn.execute = AsyncMock()

    with patch("httpx.AsyncClient.post") as mock_post:
        mock_post.return_value = MagicMock(status_code=200)
        consumer = QualGapClosedConsumer(pool)
        await consumer.handle(make_envelope())

    mock_post.assert_called_once()
    call_url = mock_post.call_args[0][0]
    assert "task-001" in call_url or "resolved" in str(mock_post.call_args)


@pytest.mark.asyncio
async def test_acks_without_error_when_no_outreach_task():
    pool = AsyncMock()
    conn = AsyncMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    # No outreach task found
    conn.fetchrow = AsyncMock(return_value=None)
    conn.execute = AsyncMock()

    with patch("httpx.AsyncClient.post") as mock_post:
        consumer = QualGapClosedConsumer(pool)
        await consumer.handle(make_envelope())

    # Task Service should NOT be called
    mock_post.assert_not_called()
```

- [ ] **Step 6: Run the test, confirm it fails**

```bash
cd services/enstellar-workflow
python -m pytest tests/consumers/test_qual_gap_closed_consumer.py -v 2>&1 | tail -20
```

Expected: FAIL — `QualGapClosedConsumer` not found.

- [ ] **Step 7: Write `qual_gap_closed_consumer.py`**

Follow `rfi_response_consumer.py` exactly for the class structure:

```python
# services/enstellar-workflow/enstellar_workflow/consumers/qual_gap_closed_consumer.py
"""QualGapClosedConsumer — marks outreach tasks resolved when Qualitron closes a quality gap.

Subscribes to ``qual.gap.closed`` and filters to ``QualGapClosed`` events. On receipt:
  1. Look up ``qual.outreach_task_ref`` for the gap_id
  2. If found, call the Task Service to mark the outreach task resolved
  3. If not found, log and ack (gap closed but no outreach task was created — valid state)
"""
from __future__ import annotations

import logging

import asyncpg
import httpx

from canonical_model import EventEnvelope
from ..kafka.consumer import IdempotentKafkaConsumer
from simintero_tenant_context import tenant_transaction

logger = logging.getLogger(__name__)

TASK_SERVICE_URL = "http://task-service:5050"  # overrideable via env


class QualGapClosedConsumer(IdempotentKafkaConsumer):
    """Consumes QualGapClosed events from qual.gap.closed Kafka topic."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        import os
        super().__init__(pool, ["qual.gap.closed"], group_id="workflow-engine-qual-gap-closed")
        self._task_service_url = os.environ.get("TASK_SERVICE_URL", TASK_SERVICE_URL)

    async def handle(self, event: EventEnvelope) -> None:
        payload = event.payload
        if not payload or payload.get("event_type") != "QualGapClosed":
            return

        gap_id = payload.get("gap_id")
        tenant_id = event.tenant.tenant_id if event.tenant else None
        if not gap_id or not tenant_id:
            logger.warning("QualGapClosedConsumer: missing gap_id or tenant_id in event %s", event.event_id)
            return

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT otr.task_id
                FROM qual.outreach_task_ref otr
                WHERE otr.gap_id = $1
                LIMIT 1
                """,
                gap_id,
            )

        if not row:
            logger.info(
                "QualGapClosedConsumer: gap %s closed but no outreach task exists — no action",
                gap_id,
            )
            return

        task_id = row["task_id"]
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self._task_service_url}/v1/tasks/{task_id}/resolved",
                json={"reason": "qual_gap_closed", "gap_id": gap_id},
            )
            if resp.status_code not in (200, 204):
                logger.error(
                    "QualGapClosedConsumer: Task Service returned %d for task %s",
                    resp.status_code,
                    task_id,
                )
```

- [ ] **Step 8: Run the Enstellar Python tests**

```bash
cd services/enstellar-workflow
python -m pytest tests/consumers/test_qual_gap_closed_consumer.py -v 2>&1 | tail -20
```

Expected: 2/2 PASS.

- [ ] **Step 9: Run the full Enstellar test suite to check no regressions**

```bash
python -m pytest tests/ -v 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add modules/qualitron/gaps/src/GapEventHandler.ts \
        modules/qualitron/gaps/src/__tests__/GapEventHandler.test.ts \
        services/enstellar-workflow/enstellar_workflow/consumers/qual_gap_closed_consumer.py \
        services/enstellar-workflow/tests/consumers/test_qual_gap_closed_consumer.py
git commit -m "feat(qualitron,enstellar): emit QualGapClosed outbox event + Enstellar consumer resolves outreach task

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
