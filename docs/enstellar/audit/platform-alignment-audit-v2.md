# Platform Alignment Audit — v2.0 (Updated)

**Original audit:** 2026-06-10, Enstellar HEAD `84b3315`  
**Updated:** 2026-06-13  
**Scope of update:** Cross-referenced original 19 divergences against what is now built in both codebases — the Simintero platform monorepo (`/Simintero/simintero/`) and the Enstellar standalone (`/Simintero/Enstellar/`).  
**Result:** 8 of 19 divergences are now resolved or substantially resolved by the platform. 11 remain open in the Enstellar standalone. 1 new finding added (N-001). Tranche plan revised.

---

## What changed since v1

The platform monorepo has shipped the following since the original audit, resolving several divergences at the platform substrate level:

| Platform capability | Service / lib | Resolves |
|---|---|---|
| RLS on all schemas with GUC | All V002–V015 migrations + `tenant-context/ts/db.ts` | DIV-004 (platform side) |
| Complete C-3 event envelope | `platform/libs/outbox/ts/src/index.ts` | DIV-007 (platform side) |
| CCEM-aligned `ens.determination` schema | V015 migration | DIV-008 |
| `ens.case_pin`, `AppendPin` command, pins on determination | V014–V015 + case module | DIV-001 (platform side) |
| Full event-sourced case aggregate | `modules/enstellar/case/` | DIV-012, DIV-015 |
| VKAS service (lifecycle + blast-radius + promotion) | `platform/services/vkas/` | DIV-011 (partially) |
| Model Gateway (boundary, kill-switch, PHI filter, ai.interaction events, prompt versioning) | `platform/services/model-gateway/` | DIV-003, DIV-016, DIV-018 |
| Temporal clock worker with VKAS profile resolution | `modules/enstellar/clock/` | DIV-006 (platform side) |
| Temporal PA workflow with VKAS workflow-def resolution + CEL guards | `modules/enstellar/workflow/` | DIV-005 (platform side) |
| Full Trace schema on `ens.case_event` | V015 + case module event types | DIV-013 (platform side) |

---

## Updated Divergence Register

### Legend
- **PLATFORM-RESOLVED** — the platform has built the correct implementation; Enstellar standalone must call/adopt it
- **OPEN** — still requires code changes in the Enstellar standalone
- **PARTIALLY-RESOLVED** — platform side done; Enstellar standalone still needs changes
- **DEFERRED** — ratified deferral, no immediate action

---

### SECURITY — Must fix before any tenant is provisioned

| ID | Summary | Status | What changed | Remaining action |
|---|---|---|---|---|
| **DIV-002** | `X-Tenant-Id` trusted as plain header on worklist router | **OPEN** | Nothing — worklist_router.py path from original audit may have moved; grep confirms `dev_bypass_auth` is still live | Find the actual worklist/queue routers in workflow-engine, replace `Header("X-Tenant-Id")` with `Depends(require_auth)` |
| **DIV-019** | `dev_bypass_auth` flag in `portal-bff/auth.py:15` returns hardcoded tenant | **OPEN** | Nothing — confirmed still present in `services/portal-bff/enstellar_bff/auth.py` | Delete the `if settings.dev_bypass_auth` branch; use mock Keycloak token in test tooling |
| **UNK-1** | HAPI JPA tenant scoping unverified | **OPEN** | Not investigated | Run cross-tenant FHIR query test against HAPI partition configuration |
| **UNK-5** | Consumer idempotency on `event_id` unverified | **OPEN** | Not investigated | Audit each Kafka consumer; verify `event_id` deduplication before DIV-014 is closed |

---

### DIV-001 — `pins[]` on Decisions and Cases

**Original severity:** S1 / PERMANENT  
**Updated status:** PARTIALLY-RESOLVED

**What the platform built:**
- `ens.case_pin` table (case_id, canonical_url, version, pinned_at) with RLS
- `AppendPin` command in `modules/enstellar/case/` — idempotent (`ON CONFLICT DO NOTHING`)
- `ens.determination.pins` JSONB column in V015
- Workflow module `callRuntimeEvaluate` activity persists pins from C-1 response to case-service `/v1/cases/{id}/pins`

**What Enstellar standalone still needs:**
1. `DecisionRequest` in `digicore/models.py` — add `pins: list[Pin] = []` (sent to Digicore for context)
2. `DecisionResponse` in `digicore/models.py` — add `pins: list[Pin]` (all governing artifacts returned by Digicore)
3. `auto_determination.py` — persist `resp.pins` onto the `Decision` and the case record
4. `EventEnvelope` for `decision.recorded` — include `pins[]` in payload
5. `canonical_model/case.py` (generated) — regenerate with `pins: list[Pin] | None` field

**Note:** Historical decisions (dev-era data) cannot be retroactively pinned — ADR-012 permits data reset pre-customer.

---

### DIV-003 + DIV-018 — Direct LLM adapter calls, no boundary enforcement

**Original severity:** S1 (A-1 invariant violation)  
**Updated status:** PLATFORM-RESOLVED (platform); OPEN (Enstellar standalone)

**What the platform built:**  
`platform/services/model-gateway/` is fully implemented:
- Resolves `model_binding` from VKAS to get endpoint per `cell_boundary` (`pooled/dedicated/enclave`)
- Kill-switch check per tenant + per workflow-id via `ctrl.entitlement` (`ai.inference.disabled`, `ai.workflow.{id}.disabled`)
- PHI filter applied before any prompt leaves the boundary (`applyPhiFilter` by task_kind allow-list)
- `anthropic-no-training: 1` header enforced on every call
- `sim.ai.interaction` event published to outbox per dispatch (with `prompt_ref`, `prompt_version`, `input_refs`, `output_hash`, `boundary`, `latency_ms`, `provider_cost_usd`)

**What Enstellar standalone still needs:**
- Replace `ModelAdapter` factory (`services/agent-layer/enstellar_agents/model_access/factory.py`) with an HTTP client that calls `platform/services/model-gateway/` at `POST /inference`
- Pass `prompt_ref`, `prompt_version`, `model_binding_ref`, `model_binding_version`, `task_kind`, and `tenant_ctx` in the request body
- Remove `AnthropicAdapter` and `OllamaAdapter` direct instantiation from agent-layer
- `AgentOutput.provenance` will automatically gain `prompt_version` from gateway response

---

### DIV-004 — Zero Postgres RLS in workflow-engine

**Original severity:** HIGH / COMPOUNDING  
**Updated status:** PLATFORM-RESOLVED (platform tables); OPEN (Enstellar standalone DB)

**What the platform built:**  
Every table in every platform schema (V002–V015) has:
```sql
ALTER TABLE <schema>.<table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <schema>.<table> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <schema>.<table>
  USING (tenant_id = current_setting('sim.tenant_id', true));
```
`platform/libs/tenant-context/ts/src/db.ts` sets the GUC before every query:
```typescript
await conn.execute("SET LOCAL sim.tenant_id = $1", [tenantId]);
```

**What Enstellar standalone still needs:**  
The Enstellar standalone's `db/connection.py` (`asyncpg.create_pool`) never sets the GUC. All 8+ workflow-engine tables have `tenant_id NOT NULL` but zero RLS policies.

1. New Alembic migration: add `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;` + `CREATE POLICY tenant_isolation USING (tenant_id = current_setting('sim.tenant_id', true))` on all workflow-engine tables
2. In `db/connection.py`, add GUC injection after acquiring a connection:
   ```python
   conn = await pool.acquire()
   await conn.execute("SET LOCAL sim.tenant_id = $1", tenant_context.tenant_id)
   ```
3. CI test: superuser cross-tenant SELECT must return 0 rows
4. Separately: verify HAPI JPA uses partition-aware queries (UNK-1)

---

### DIV-005 — Workflow engine code-embedded; no Temporal; `"v1"` literal pin

**Original severity:** HIGH  
**Updated status:** PLATFORM-RESOLVED (platform); PARTIALLY-RESOLVED (Enstellar standalone)

**What the platform built:**  
`modules/enstellar/workflow/` is a complete Temporal-based PA workflow:
- Resolves `workflow_def` from VKAS (`pa-standard-ma.yaml`) with hardcoded fallback
- Pins `workflow_def_version` on the case at creation
- CEL guard evaluator (no I/O, Temporal-sandbox-safe)
- Full state machine: intake → completeness_check → rfi_pending/clinical_review → determined
- Activities for coverage discovery, C-1 evaluate, RFI, routing, auto-determination
- Signals: withdrawSignal, rfiSatisfiedSignal, decisionRecordedSignal

**What Enstellar standalone still needs (near-term, T3 deferral confirmed):**
1. Wrap `TransitionEngine` behind a `WorkflowEnginePort` interface matching the platform workflow module's operation signatures — so the two can be swapped without breaking callers
2. Define the PA workflow as a `workflow_def` YAML artifact (even if loaded from disk)
3. Capture `workflow_def_pin` on case creation and include in the outbox event
4. Long-term: adopt the platform's Temporal worker as the canonical workflow engine and deprecate Python TransitionEngine

---

### DIV-006 — Clock limits hardcoded dict; calendar-day only; no profile pin

**Original severity:** HIGH / COMPOUNDING  
**Updated status:** PLATFORM-RESOLVED (platform); OPEN (Enstellar standalone)

**What the platform built:**  
`modules/enstellar/clock/` is a Temporal-based clock worker:
- `resolveClockProfile` activity fetches `clock_profile` artifacts from VKAS (fallback: `ma-cms-0057.yaml` stub)
- `computeDeadline` activity supports `business_days`, `hours`, `calendar_days` units with weekend-skip logic
- `clock_profile_version` pinned per Clock row
- Signals for pause/resume/satisfy; handles banked elapsed time

**What Enstellar standalone still needs:**
- Replace `CLOCK_RULES = {("expedited","decision"): 3, ...}` dict in `clocks/model.py` with a call to VKAS for `clock_profile` artifacts
- Implement `business_day` calendar (currently pure `timedelta(days=N)`)
- Pin `clock_profile_version` on each `Clock` row in `workflow_instances` / `clocks` table
- Include `clock_profile_pin` in the `clock.started` outbox event

---

### DIV-007 — Envelope missing C-3 fields; topic names don't match C-3

**Original severity:** HIGH / COMPOUNDING  
**Updated status:** PLATFORM-RESOLVED (platform); OPEN (Enstellar standalone)

**What the platform built:**  
`platform/libs/outbox/ts/src/index.ts` — complete `EventEnvelope`:
```typescript
{
  event_id, schema_ref, occurred_at, tenant: { tenant_id },
  correlation_id, causation_id, actor: { type, id },
  trace_ref, payload
}
```
`topicFor(schemaRef)` maps all C-3 topics correctly:
- `sim.case.*` → `sim.case.lifecycle`
- `sim.ai.*` → `sim.ai.interaction`
- `sim.clock.*` → `sim.clock`
- `sim.artifact.*` → `sim.artifact`
- `sim.tenant.*` → `sim.tenant.admin`

**What Enstellar standalone still needs:**  
`packages/event-contracts/enstellar_events/envelope.py` — current state:
```python
class EventEnvelope(BaseModel):
    event_id: UUID
    tenant_id: str
    case_id: UUID
    correlation_id: str
    type: str           # topic constant, not schema_ref
    occurred_at: datetime
    actor: Actor
    payload: dict
    schema_version: str  # "1.0.0" — not a schema_ref URI
```

Required changes:
1. Add `schema_ref: str` (e.g. `sim.case.lifecycle/CaseStateChanged/v1`)
2. Add `causation_id: str | None`
3. Add `trace_ref: str | None`
4. Rename `type` → topic routing stays in `topics.py`; `schema_ref` becomes the canonical identifier
5. `topics.py` — rename constants to C-3 names: `CASE_LIFECYCLE = "sim.case.lifecycle"`, `DECISION_RECORDED = "sim.case.lifecycle"` (same topic, different schema_ref), etc.
6. Update all `OutboxPublisher.publish()` call sites to supply `schema_ref` instead of `type`

---

### DIV-008 — Determination missing 5 CCEM §4.3 fields; no DB CHECK on adverse invariant

**Original severity:** HIGH  
**Updated status:** PLATFORM-RESOLVED

**What the platform built:**  
V015 `ens.determination` has all required fields:
- `decided_by` (`human` / `auto`)
- `rationale_ref`
- `rules_trace_ref`
- `advisory_analysis_ref`
- `pins` JSONB
- DB CHECK: `(outcome NOT IN ('denied','modified') OR (decided_by='human' AND rationale_ref IS NOT NULL AND rules_trace_ref IS NOT NULL))`

The platform `RecordDecision` command enforces this via OPA adverse-action guard before the INSERT.

**Remaining:** Enstellar standalone's `Decision` Pydantic model (`canonical_model/decision.py`) does not yet include these fields. When Enstellar standalone is wired to use the platform case service for decision recording, this will be resolved automatically. Until then, the standalone Decision model should be extended to match.

---

### DIV-009 — No document retrieval authz; no `sim.audit.access` on reads

**Original severity:** HIGH  
**Updated status:** PARTIALLY-RESOLVED

**What the platform built:**  
`platform/services/document/` handles ingestion with:
- Tenant-scoped object keys (`{tenantId}/docs/{uuid}`)
- `sim.tenant_id` GUC on all DB writes (`docs.document` table)
- `retention_policy` stored at ingest time
- `case_ref` tracked on every document

**What still needs to happen:**
1. Enstellar standalone's `normalization/storage.py` calls MinIO directly — needs to be replaced with a call to the platform document service ingest endpoint
2. `DocumentRepository.get()` with tenant authz check is not yet in the platform document service — retrieval endpoint with `sim.audit.access` event needed
3. MinIO bucket policy needs to deny direct object access

---

### DIV-010 — No audit service

**Original severity:** HIGH  
**Updated status:** OPEN (unchanged — not built in either codebase)

**Platform:** `automation.disposition_log` in V010 serves as a partial audit trail for automation decisions. No general-purpose hash-chained audit service exists.

**Still needs to be built in platform:**
- `audit` schema: `audit_event(id, tenant_id, occurred_at, actor_id, actor_type, action, subject_ref, payload_hash, prev_hash)`
- Outbox consumer: consumes `sim.case.lifecycle` and `sim.audit.access` topics
- Evidence-package exporter: transitive closure from `determination_id → trace → artifacts → documents`

---

### DIV-011 — No VKAS

**Original severity:** HIGH  
**Updated status:** PARTIALLY-RESOLVED

**What the platform built:**  
`platform/services/vkas/` is substantially implemented:
- Lifecycle state machine: `draft → in_review → approved → active → retired/rolled_back` (enforced, throws `StatusTransitionError` on invalid transitions)
- Artifact schema: `vkas.artifact(canonical_url, version, tenant_id, artifact_type, status, effective_from, effective_to, applicability, content, content_hash, relations, metadata)` — V003 migration
- Approval gates: `vkas.approval(gate, decided, attestation)` — clinical + compliance dual-gate
- Blast-radius gate: `evaluateBlastRadius()` checks eval gate approval + outcome delta thresholds before promotion
- `resolveEffectiveVersion()`: LOB/region/program/product applicability match + semver sort
- **Immutability trigger:** V003 prevents UPDATE/DELETE on approved/active/retired/superseded artifacts

**What remains (Phase 1 DB wiring):**  
`vkas/src/router.ts` POST `/v1/artifacts` and GET `/v1/artifacts:resolve` both return `501 Not implemented in Phase 0 stub`. The resolve algorithm and lifecycle logic are fully implemented — just need DB connection wired in Phase 1.

**Immediate path:**
1. Wire `Pool` into router, implement `POST /v1/artifacts` INSERT into `vkas.artifact`
2. Wire `resolveEffectiveVersion()` into `GET /v1/artifacts:resolve` with a DB query for candidates

---

### DIV-012 — Mutable `case_json` snapshot; no `seq` optimistic concurrency

**Original severity:** MED  
**Updated status:** PLATFORM-RESOLVED

**What the platform built:**  
`modules/enstellar/case/` is fully event-sourced:
- `ens.case_event` is append-only (DB trigger prevents UPDATE/DELETE)
- `CaseEventStore.appendInTx()` inserts with `seq` auto-increment
- `Case` aggregate loaded by replaying `ens.case_event` rows via `reducers.ts`
- Advisory lock (`pg_advisory_xact_lock(hashtext(caseId))`) for concurrency safety
- No mutable JSONB snapshot — state is always derived from event log

**Remaining in Enstellar standalone:** `workflow_instances.case_json` is still a mutable JSONB column. This is resolved when Enstellar standalone calls the platform case service for state transitions.

---

### DIV-013 — `StructuredTrace` (4 fields) vs CCEM §7 Trace

**Original severity:** MED  
**Updated status:** PLATFORM-RESOLVED (platform schema); OPEN (Enstellar standalone model)

**What the platform built:**  
`ens.case_event.schema_ref` + `trace_ref` are present in V015. Platform case module events carry full actor, schema_ref, and trace_ref. The `ens.determination.rules_trace_ref` points to a trace record.

**Enstellar standalone still needs:**  
`digicore/models.py` `StructuredTrace` has only 4 fields (`artifact`, `version`, `logic_branch`, `source`). Needs extension to full Trace schema: `governing_artifacts[]`, `inputs[]`, `logic_path[]`, `actors[]`.

---

### DIV-014 — Outbox relay mark not atomic with publish

**Original severity:** MED  
**Updated status:** DEFERRED (T3, by design)

**Platform outbox:** Uses `FOR UPDATE SKIP LOCKED` + `ON CONFLICT (event_id) DO NOTHING` for idempotency. At-least-once delivery is accepted per C-3 §2. Consumer idempotency is the control (pending UNK-5 audit).

---

### DIV-015 — Case not reconstructable from events alone

**Original severity:** MED  
**Updated status:** PLATFORM-RESOLVED

**What the platform built:**  
Platform case module is fully event-sourced — events are the source of truth, `case_json` JSONB snapshot does not exist. `CaseEventStore.load(caseId)` replays all events to reconstruct current state.

**Remaining in Enstellar standalone:** Still uses mutable `workflow_instances.case_json`. Resolved when standalone adopts platform case service.

---

### DIV-016 — No `prompt_version` in provenance; prompts are code literals

**Original severity:** MED  
**Updated status:** PLATFORM-RESOLVED (platform); OPEN (Enstellar standalone)

**What the platform built:**  
`InferenceDispatcher.dispatch()` requires `prompt_ref` and `prompt_version` in the request. Every `sim.ai.interaction` outbox event records `prompt_ref`, `prompt_version`, `model_binding_ref`, `model_binding_version`. VKAS will version prompts as artifacts (once Phase 1 VKAS DB is wired).

**Enstellar standalone still needs:**  
Once agent-layer is updated to call the platform Model Gateway (DIV-003), `prompt_version` is automatically captured. The remaining step is to extract system prompts from Python string literals into versioned files (or VKAS artifacts), and pass their refs in the gateway dispatch request.

---

### DIV-017 — `required-elements.json` absent; FHIR↔CCEM round-trip tests absent

**Original severity:** MED  
**Updated status:** OPEN (unchanged)

Neither the platform nor the Enstellar standalone has produced `required-elements.json` (the CCEM §9 manifest mapping PAS + 278/275 FHIR fields to CCEM canonical fields). Required as a CCEM Phase-0 exit criterion.

**Action:** Author `required-elements.json` in `packages/canonical-model/` covering the PAS FHIR fields currently in use; add property-based round-trip tests to CI.

---

### DIV-018 — Adapter selection by env var, no boundary constraint

**Updated status:** PLATFORM-RESOLVED — folds into DIV-003 (Model Gateway enforces boundary from VKAS model_binding artifact).

---

### DIV-019 — `dev_bypass_auth` in portal-bff

**Updated status:** OPEN (confirmed still in `services/portal-bff/enstellar_bff/auth.py:15`).

```python
if settings.dev_bypass_auth:
    return {"tenant_id": settings.dev_tenant_id, "roles": ["reviewer"], "sub": "dev-user"}
```

**Action:** Delete this branch. Add a mock Keycloak token fixture to the test tooling. Add a CI gate that rejects any `dev_bypass_auth=true` in non-test configs.

---

### N-001 (NEW) — Enstellar standalone and platform case service are parallel implementations

**Severity:** HIGH  
**Finding:** The platform has built a complete TypeScript event-sourced case aggregate (`modules/enstellar/case/`) running on port 8091 that is the authoritative case record for the platform. The Enstellar standalone's Python `workflow_instances` table and `CaseRepository` are a second, divergent case store. Both will write to different databases and produce different event streams if deployed together.

**Disposition:** Converge. The Enstellar standalone's `TransitionEngine` should be the orchestration layer; it should call the platform case service (`POST /v1/cases/{id}/events`) for all state mutations rather than writing to its own `workflow_instances` table. The platform case service becomes the single source of truth for case state; the standalone workflow-engine becomes the process orchestrator.

**Near-term action:** In `engine/transitions.py`, replace direct `workflow_instances` writes with HTTP calls to the platform case service for state transitions and determination recording.

---

## Revised Tranche Plan

### Tranche 0 — Security (unchanged urgency)

| ID | Action | File(s) | Cost |
|---|---|---|---|
| DIV-002 | Replace forged-header bypass with `Depends(require_auth)` in all worklist/queue routers | `services/workflow-engine/enstellar_workflow/` — find routers with `Header("X-Tenant-Id")` | S |
| DIV-019 | Delete `dev_bypass_auth` branch; add mock Keycloak fixture | `services/portal-bff/enstellar_bff/auth.py` | S |
| UNK-1 | Cross-tenant FHIR query test against HAPI partition config | `services/interop/` + HAPI config | M |
| UNK-5 | Audit each Kafka consumer for `event_id` idempotency | `services/workflow-engine/enstellar_workflow/consumers/` | S |

**T0 exit:** Unauthenticated requests to all Enstellar routers return 401 in CI. UNK-1 and UNK-5 answered in writing.

---

### Tranche 1 — Adopt platform event + data contracts

| ID | Action | Cost |
|---|---|---|
| DIV-007 | Update `envelope.py` + `topics.py` to C-3 schema_ref/topic contract | M |
| DIV-001 | Add `pins[]` to DigiCore models, `auto_determination.py`, `case_json`, determination event | M |
| DIV-004 | Add RLS migrations + GUC injection in `db/connection.py` | M |
| DIV-013 | Extend `StructuredTrace` to full Trace schema | S |
| DIV-008 | Extend `Decision` Pydantic model to include all CCEM §4.3 fields | S |
| DIV-017 | Author `required-elements.json` + round-trip tests | M |
| N-001 | Wire `TransitionEngine` to call platform case service for state writes | L |

**T1 exit:** proxy-Qualitron stub can rebuild 5 synthetic cases from `sim.*` topics alone. Round-trip tests green.

---

### Tranche 2 — Adopt platform services

| ID | Action | Cost |
|---|---|---|
| DIV-003/018 | Replace `ModelAdapter` factory with HTTP client to platform Model Gateway | M |
| DIV-006 | Replace `CLOCK_RULES` dict with VKAS `clock_profile` artifact fetch | M |
| DIV-009 | Route document storage through platform document service; add retrieval authz | L |
| DIV-011 | Complete VKAS DB wiring (POST /v1/artifacts + GET /v1/artifacts:resolve) | M |
| DIV-010 | Build platform audit service (`audit` schema + hash-chain + evidence-package exporter) | L |

**T2 exit:** A clock-limit change ships as VKAS promotion with zero deploy. Evidence package for one synthetic determination exports with hash chain intact. Model Gateway boundary test rejects out-of-boundary provider.

---

### Tranche 3 — Deliberate deferrals (unchanged)

| ID | Action |
|---|---|
| DIV-005 | `WorkflowEnginePort` interface + YAML workflow artifact. Temporal rebuild on explicit trigger (ADR-014). |
| DIV-014 | Accept at-least-once; enforce consumer idempotency after UNK-5 audit passes. |

---

## Status Summary

| # | ID | Description | Status |
|---|---|---|---|
| 1 | DIV-001 | pins[] on decisions | PARTIALLY-RESOLVED |
| 2 | DIV-002 | Forged-header tenant bypass | OPEN |
| 3 | DIV-003 | Direct LLM calls bypass Model Gateway | OPEN (platform resolved) |
| 4 | DIV-004 | Zero Postgres RLS | OPEN (platform resolved) |
| 5 | DIV-005 | Code-embedded workflow engine | PARTIALLY-RESOLVED |
| 6 | DIV-006 | Hardcoded clock limits | OPEN (platform resolved) |
| 7 | DIV-007 | Incomplete event envelope; wrong topic names | OPEN (platform resolved) |
| 8 | DIV-008 | Determination missing CCEM §4.3 fields | PLATFORM-RESOLVED |
| 9 | DIV-009 | No document retrieval authz | PARTIALLY-RESOLVED |
| 10 | DIV-010 | No audit service | OPEN |
| 11 | DIV-011 | No VKAS | PARTIALLY-RESOLVED |
| 12 | DIV-012 | Mutable case_json; no seq | PLATFORM-RESOLVED |
| 13 | DIV-013 | Thin StructuredTrace | OPEN (platform resolved) |
| 14 | DIV-014 | Non-atomic outbox mark | DEFERRED |
| 15 | DIV-015 | Case not reconstructable from events | PLATFORM-RESOLVED |
| 16 | DIV-016 | No prompt_version in provenance | OPEN (platform resolved) |
| 17 | DIV-017 | required-elements.json absent | OPEN |
| 18 | DIV-018 | Adapter selection by env var | PLATFORM-RESOLVED (folds into DIV-003) |
| 19 | DIV-019 | dev_bypass_auth in portal-bff | OPEN |
| 20 | N-001 | Parallel case stores (standalone + platform) | OPEN — NEW |

**Fully resolved by platform:** DIV-008, DIV-012, DIV-015, DIV-018  
**Platform-resolved, Enstellar adoption pending:** DIV-003, DIV-004, DIV-006, DIV-007, DIV-013, DIV-016  
**Partially resolved:** DIV-001, DIV-005, DIV-009, DIV-011  
**Still open (no change):** DIV-002, DIV-010, DIV-017, DIV-019  
**New finding:** N-001  
**Deferred:** DIV-014  

---

## Standing rules (unchanged from v1)

1. **Freeze rule:** No new parallel implementations of capabilities already built in `platform/`. Consume `platform/` services or halt-and-ask.
2. **Pre-customer breaking-change window:** Topic renames, schema resets, data regeneration permitted without migration scaffolding until first design-partner tenant is provisioned.
3. **Rescan cadence:** Run `/platform-audit-rescan` after each tranche; statuses flip to VERIFIED only on passing rescan.
