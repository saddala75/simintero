# Enstellar: .claude Scaffolding + T01 (Monorepo + CI + Local Stack) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `.claude/` context files needed for AI-assisted development, then scaffold the full monorepo with a working local docker-compose stack (`make up` → all services healthy).

**Architecture:** Two phases — (A) extract design-doc content into per-file `.claude/` specs/guardrails/task-graph so every future task has targeted context; (B) create the directory skeleton, Makefile, docker-compose stack with mocks, and GitHub Actions CI skeleton that satisfies T01's DoD.

**Tech Stack:** Docker Compose v2, HAPI FHIR (Java), Redpanda (Kafka), MinIO (S3), OpenSearch, Keycloak, Redis, Ollama, FastAPI (mock stubs), GitHub Actions.

---

## File Map

### Phase A — .claude scaffolding
```
.claude/
  task-graph.md          # Executable P0→P1 task DAG from design doc Appendix B
  guardrails.md          # Codegen rules + human-review gates from design doc §10.3
  specs/
    fhir-api.md          # §6.1 component design
    pas-service.md       # §6.2
    x12-translator.md    # §6.3
    crd-dtr.md           # §6.4
    workflow-engine.md   # §6.5
    agent-layer.md       # §6.6
    integration-connectors.md  # §6.7
    portal-bff-web.md    # §6.8
```

### Phase B — T01 files
```
.gitignore
.editorconfig
Makefile
infra/
  compose/
    docker-compose.yml               # All local services
    .env.example                     # Port/secret defaults
    init/
      workflow-db-init.sql           # Creates keycloak DB in workflow-db postgres
    mocks/
      digicore/
        main.py                      # FastAPI stub → decision + trace
        Dockerfile
        requirements.txt
      revital/
        main.py                      # FastAPI stub → summary + entities
        Dockerfile
        requirements.txt
packages/
  canonical-model/.gitkeep
  event-contracts/.gitkeep
  authz/.gitkeep
services/
  interop/.gitkeep
  workflow-engine/.gitkeep
  agent-layer/.gitkeep
  integration-connectors/.gitkeep
  portal-bff/.gitkeep
apps/
  web/.gitkeep
test/.gitkeep
.github/
  workflows/
    ci.yml
```

---

## Task 1: `.claude/task-graph.md`

**Files:**
- Create: `.claude/task-graph.md`

- [ ] **Step 1: Write the file**

```markdown
# Enstellar Task Graph (P0 → P1)

Status legend: `[ ]` todo · `[~]` in-progress · `[x]` done

## P0 — Foundation & Walking Skeleton

| Task | Stack | Depends on | Review class | Status |
|---|---|---|---|---|
| T01 monorepo + CI + local stack | infra | — | infra | `[ ]` |
| T02 canonical-model + codegen | packages | T01 | standard | `[ ]` |
| T03 identity/authz (Keycloak, SMART) | JVM+Py | T01 | **sensitive (auth)** | `[ ]` |
| T04 event bus + outbox + envelope | Py+infra | T01 | standard | `[ ]` |
| T05 fhir-api + CapabilityStatement | JVM/HAPI | T02 | **sensitive (FHIR)** | `[ ]` |
| T06 PAS submit/inquire (happy path) | JVM/HAPI | T05 | **sensitive (FHIR)** | `[ ]` |
| T07 normalization (FHIR→canonical) | Py/JVM | T02 | standard | `[ ]` |
| T08 workflow-engine skeleton | Py | T04,T06,T07 | **sensitive (decision path)** | `[ ]` |
| T09 Digicore client + decision call | Py | T08 | standard | `[ ]` |
| T10 auto-determination (approve-only) + trace | Py | T09 | **sensitive (decision path)** | `[ ]` |
| T11 ClaimResponse out + status | JVM/Py | T10 | **sensitive (FHIR)** | `[ ]` |

### P0 exit criteria
- Walking skeleton green in CI.
- A clean PAS submit flows EHR→Enstellar→Digicore mock→approved `ClaimResponse` with decision trace.
- Conformance smoke (US Core + PAS happy path) passes.
- Decision trace is reproducible from its event history.

## P1 — PA Core (Full UM Lifecycle, No Appeals)

| Task | Stack | Depends on | Review class | Status |
|---|---|---|---|---|
| T12 worklists + reviewer UI | TS/Py | P0 done | standard | `[ ]` |
| T13 pend/RFI + clock/SLA | Py | T12 | **sensitive (clocks)** | `[ ]` |
| T14 agent layer + guardrails | Py | T13 | **sensitive (AI)** | `[ ]` |
| T15 Revital client (advisory) | Py | T14 | **sensitive (AI/PHI)** | `[ ]` |
| T16 triage + escalation + human sign-off | Py/TS | T15 | **sensitive (decision path)** | `[ ]` |
| T17 comms/notifications + X12 278/275 intake | Py/JVM | T16 | **sensitive (FHIR/X12)** | `[ ]` |

### P1 exit criteria
- Full lifecycle configurable without code changes.
- No-autonomous-adverse test suite green.
- Agent evals pass gates.
- X12 278 round-trip conformance.
- A UM team can run real PA end-to-end (minus appeals) for a design partner.

## Task DoDs

### T01
compose up → all containers healthy; make targets (up/down/test/e2e/conformance/scan) exit 0; CI skeleton green.

### T02
`packages/canonical-model` JSON Schema compiles to Pydantic (Python) + TypeScript types + Java records; round-trip test (serialize→deserialize→assert equal) passes.

### T03
SMART on FHIR (app launch) and SMART Backend Services (client-credentials + signed JWT) tokens issued by Keycloak; tenancy middleware enforced in Python + JVM tiers; no FHIR endpoint reachable without a valid token.

### T04
Transactional outbox publishes events to Redpanda; idempotent consumer reads them back; event envelope (event_id, tenant_id, case_id, correlation_id, type, occurred_at, actor, payload, schema_version) schema validated.

### T05
HAPI FHIR R4; US Core read/search conformant for Patient, Practitioner, Coverage, Organization; `CapabilityStatement` generated from runtime config (not hand-edited); conformance smoke passes.

### T06
`POST /fhir/Claim/$submit` (PAS-profiled) creates a canonical case; on an approved-decision event, returns an approved `ClaimResponse`; Inferno/Touchstone PAS submit passes for the happy path.

### T07
FHIR PAS Bundle → canonical `Case` mapping is lossless (round-trip assertion); raw PAS bundle retained in object store with provenance link.

### T08
State machine drives intake→completeness→auto-determination states; each transition emits a tenant-scoped event; idempotent re-run of a state does not produce duplicate events.

### T09
Digicore client calls `POST /api/v1/decisions`; response `{ decision, requirements, structured_trace }` is consumed by the engine; circuit-breaker + retry with exponential backoff.

### T10
Auto-determination path approves when criteria met; **never produces a denial/adverse outcome without human sign-off**; property tests + integration tests cover the no-autonomous-adverse invariant with fuzzing; rules trace pinned to Digicore artifact + version.

### T11
`ClaimResponse` (approved) is returned by PAS inquire and on async completion; decision trace reproducible from event history; status polling (`$inquire`) returns correct state.

### T12
Reviewer worklist shows cases sorted by SLA; case workspace displays case header, service lines, documents, events timeline; BFF enforces authz.

### T13
Pend transitions pause the decision clock; RFI sends structured request to provider; clock resumes on documentation receipt; SLA breach raises an alert event; clock pause/resume behavior has integration tests validated against representative rules.

### T14
Completeness & RFI assist agent: inputs case + Digicore doc rules + Revital evidence; outputs gap list (cited) + draft RFI (advisory); guardrail engine blocks any attempt to send RFI or modify state directly; agent evals pass groundedness + gap-detection gates.

### T15
Revital client calls `POST /api/v1/summarize`; advisory contract honored; PHI minimized before call; provenance event recorded (model version, inputs, output, confidence).

### T16
Triage agent suggests queue/reviewer (suggestion only, engine authoritative); escalation path routes to MD; adverse determination requires recorded human (clinician) sign-off enforced in transition guard; tests prove no adverse outcome without sign-off.

### T17
Provider and member determination notifications generated from tenant templates; delivered via configured channels; X12 278 intake produces a canonical case identical to an equivalent PAS submit (round-trip regression suite green).
```

- [ ] **Step 2: Verify the file exists with correct content**

```bash
wc -l .claude/task-graph.md
# Expected: > 80 lines
```

---

## Task 2: `.claude/guardrails.md`

**Files:**
- Create: `.claude/guardrails.md`

- [ ] **Step 1: Write the file**

```markdown
# Enstellar Codegen Guardrails

These rules apply to every code generation session. They are enforced in CLAUDE.md, CI, and mandatory human-review gates.

## Hard prohibitions (never generate these)

1. **No autonomous adverse determinations.**
   Never generate a code path that can issue or be the sole basis for a denial, partial denial, or other adverse determination without a recorded human (clinician, where required) sign-off. The adverse-transition guard in the workflow engine is sacred. Tests that cover it must never be weakened or removed.

2. **No LLM call on the decision path.**
   Never introduce an inference/LLM call into the determination or coverage-decision path. AI output is advisory and must pass through the guardrail engine before any system action.

3. **No PHI in logs.**
   Never log PHI in the clear. All log statements involving case/member/provider data must use the PHI-redacted logger.

4. **No PHI to inference without redaction.**
   Never send case data to an inference endpoint without first applying the configured minimization/redaction transform.

5. **No cross-boundary path.**
   Never add a code path that crosses a tenant or deployment boundary. Tenant context must be present on every request, query, event, and log line. No query executes without `tenant_id`.

6. **No hand-edited CapabilityStatement or invented FHIR profiles.**
   The `CapabilityStatement` is generated from runtime configuration. Profiles are bound to pinned Da Vinci / US Core IG versions. Do not fork FHIR schemas locally.

7. **No forked contracts.**
   Always bind to shared contracts in `packages/*` (canonical model, event contracts, authz). Do not define local copies of canonical types.

## Mandatory rules (always do these)

- **Always propagate `tenant_id`/context** on every call, query, event, and log line.
- **Always add or extend tests** with every change. A change that reduces coverage of an invariant is rejected — do not weaken tests to make code compile.
- **Always bind to shared contracts** (`packages/*`). Generated types are authoritative; hand-written copies are not.
- **Always retain raw payloads** (FHIR bundles, X12 messages) in the object store with a provenance link before transformation.
- **Always run the verification loop** (unit → contract → integration → conformance → security scans) before a PR is opened.

## Mandatory human-review gates

A **senior engineer** must approve PRs touching:

| Area | Why |
|---|---|
| Workflow transition guards / decision path | Invariant #1 and #2 |
| Guardrail engine | AI safety |
| Auth/identity (Keycloak, SMART, JWT) | Auth bypass risk |
| PHI handling (logging, redaction, storage) | HIPAA |
| FHIR conformance (profiles, CapabilityStatement) | Standards fidelity |
| X12 mapping (278/275/27x) | Translation fidelity |
| Infra/IaC (compose, Helm, Terraform) | Deployment blast radius |

UI-only and docs changes use lighter review (peer review sufficient).

## Test invariants (must stay green; do not weaken)

- **No-autonomous-adverse:** property/integration tests proving no adverse outcome (denial, partial, adverse modification) is possible without a recorded human sign-off with a clinician role. Fuzz the auto-determination path with adversarial inputs.
- **Determinism:** identical inputs + pinned artifact/model versions reproduce the same decision + trace. Assert no LLM call participates in the determination.
- **PHI handling:** PHI-redaction runs before any inference call; no PHI appears in log output; no cross-boundary egress of case data (enforced by network-policy + test).
- **Tenant isolation:** no query returns data from a different tenant; no event is visible across tenants.

## AI-assisted code review checklist

Before opening a PR generated by an AI coding agent, a human reviewer must confirm:

- [ ] No adverse-determination path exists without human sign-off.
- [ ] No LLM call is on the determination path.
- [ ] All PHI log statements use the redacted logger.
- [ ] `tenant_id` is present on all persisted records and emitted events.
- [ ] All types come from `packages/*`, not local copies.
- [ ] Tests were written/updated; invariant tests still green.
- [ ] FHIR profiles reference pinned IG versions; `CapabilityStatement` generated.
- [ ] Security scans (`make scan`) pass.
```

- [ ] **Step 2: Verify**

```bash
wc -l .claude/guardrails.md
# Expected: > 70 lines
```

---

## Task 3: `.claude/specs/*.md` (one per component)

**Files:**
- Create: `.claude/specs/fhir-api.md`
- Create: `.claude/specs/pas-service.md`
- Create: `.claude/specs/x12-translator.md`
- Create: `.claude/specs/crd-dtr.md`
- Create: `.claude/specs/workflow-engine.md`
- Create: `.claude/specs/agent-layer.md`
- Create: `.claude/specs/integration-connectors.md`
- Create: `.claude/specs/portal-bff-web.md`

- [ ] **Step 1: Write `.claude/specs/fhir-api.md`**

```markdown
# Spec: fhir-api (JVM/HAPI)

**Phase:** P0 · **Stack:** Java 21, HAPI FHIR, Spring Boot, PostgreSQL · **Review class:** sensitive (FHIR)

## Responsibility
FHIR R4/US Core server — resource CRUD and search. Publishes the `CapabilityStatement` at `/fhir/metadata`. Enforces SMART on FHIR / SMART Backend Services authorization and tenant isolation on every request.

## Interfaces
- `GET /fhir/metadata` → `CapabilityStatement` (generated from runtime config, not hand-edited)
- Standard FHIR REST: `GET/POST /fhir/{Resource}`, `GET /fhir/{Resource}/{id}`, `GET /fhir/{Resource}?{search-params}`
- Supported resources: Patient, Practitioner, PractitionerRole, Organization, Coverage, Encounter, ServiceRequest, DocumentReference, Binary, Claim, ClaimResponse, Questionnaire, QuestionnaireResponse, Communication
- Emits canonical events on writes (via outbox in P1): `fhir.resource.written`

## Internals
- HAPI JPA server on PostgreSQL; US Core profiles pinned per deployment.
- HAPI interceptors: `TenantInterceptor` (resolves `tenant_id` from auth token, applies to every request/query); `SmartAuthInterceptor` (validates SMART scopes); `AuditInterceptor` (writes audit events).
- `CapabilityStatement` generated from configuration (not maintained by hand) and tested to match runtime behavior.
- Terminology validation hook (offline or against `TERMC` for validation).

## Data
- PostgreSQL via HAPI JPA schema.
- Read: `tenant_id` always applied as a search parameter / tag filter.

## Dependencies
- `packages/canonical-model` — for type references
- Keycloak / SMART AS — for token validation
- `TenantInterceptor` reads `tenant_id` from JWT claim

## NFRs
- FHIR reads < 1s p50, < 2.5s p95
- CapabilityStatement served from cache (not regenerated per request)

## Definition of Done (T05)
- [ ] US Core Patient, Practitioner, Coverage, Organization resources are readable and searchable.
- [ ] `GET /fhir/metadata` returns a `CapabilityStatement` that is generated from configuration.
- [ ] Every request without a valid SMART token returns 401.
- [ ] Every request without a `tenant_id` claim is rejected.
- [ ] Conformance smoke test (US Core profile validation) passes in CI.
- [ ] `CapabilityStatement` is verified to match runtime behavior (declared resources/ops match actual endpoints).

## Gotchas
- HAPI's default `CapabilityStatement` is auto-generated but includes all registered providers. Override via `IServerConformanceProvider` to generate from config and exclude unimplemented features.
- HAPI JPA search can be slow on large datasets without OpenSearch offloading (configured in P1).
- Do not hand-edit the `CapabilityStatement` bean — use the generated builder pattern.
```

- [ ] **Step 2: Write `.claude/specs/pas-service.md`**

```markdown
# Spec: pas-service (JVM/HAPI)

**Phase:** P0 (happy path) → P1 (full) · **Stack:** Java 21, HAPI FHIR, Spring Boot · **Review class:** sensitive (FHIR)

## Responsibility
Implements PAS (Prior Authorization Support) Da Vinci IG operations: `Claim/$submit` and `Claim/$inquire`. Parses PAS-profiled `Claim` Bundles, maps them to the canonical `Case`, and produces `ClaimResponse` on decision events.

## Interfaces
- `POST /fhir/Claim/$submit` — accepts a PAS `Bundle` (Claim + supporting resources), returns synchronous `ClaimResponse` (approved) or deferred response with polling URL.
- `POST /fhir/Claim/$inquire` — returns current status/decision for a prior submission.
- Consumes: `decision.recorded` Kafka event (to build `ClaimResponse`)
- Publishes: `case.intake.received` event (on valid submit)

## Internals
- HAPI operation providers for `$submit` and `$inquire` registered on the `Claim` resource.
- Validates inbound Bundle against PAS profiles (US Core + Da Vinci PAS IG, pinned version).
- Maps PAS Claim → canonical `Case` (delegates to `NormalizationService`).
- Async/pended path (P1): if workflow responds async, return 202 with `Content-Location` header; `$inquire` polls Kafka / DB for decision.

## Data
- Raw PAS Bundle stored in MinIO with correlation ID before any transformation.
- Canonical `Case` ID returned as `ClaimResponse.identifier`.

## Dependencies
- `fhir-api` — shares HAPI FHIR server context.
- `workflow-engine` — via Kafka events.
- `packages/canonical-model` — `Case` type.

## Definition of Done (T06 — happy path)
- [ ] `POST /fhir/Claim/$submit` with a valid PAS bundle creates a canonical case (verified by querying the workflow engine).
- [ ] On an `approved` decision event from the workflow engine, the operation returns a `ClaimResponse` with `outcome = complete` and `adjudication[0].category = approved`.
- [ ] The raw PAS bundle is stored in MinIO with a provenance link.
- [ ] Inferno/Touchstone PAS submit smoke test passes.
- [ ] Invalid bundles (missing required profiles) return `OperationOutcome` with 422.

## Gotchas
- PAS `Claim` uses `use = preauthorization`; standard HAPI `Claim` validation will reject it — override with PAS profile validator.
- The `ClaimResponse` must echo back the `Claim.identifier` as a prior-auth tracking number.
- Raw payload retention must happen before any transform attempt (store-first, transform-second pattern).
```

- [ ] **Step 3: Write `.claude/specs/x12-translator.md`**

```markdown
# Spec: x12-translator (JVM)

**Phase:** P0 stub → P1 full · **Stack:** Java 21, Spring Boot · **Review class:** sensitive (FHIR/X12)

## Responsibility
Translates X12 278 (PA request/response), 275 (attachments), and 27x (eligibility, claim status) ↔ canonical case model. The translation is lossless and bidirectional. Raw X12 is retained in MinIO before any transform.

## Interfaces
- Internal REST: `POST /translate/x12-to-canonical` — returns canonical `Case` or error with field-level provenance.
- Internal REST: `POST /translate/canonical-to-x12` — returns X12 string.
- Companion-guide variability handled as configuration (trading-partner ID → companion guide profile).
- Consumed by: `portal-bff`, workflow events; not called directly from FHIR API.

## Internals
- P0 stub: accept X12 278 inbound, parse ISA/GS/ST segments, return a minimal canonical `Case` sufficient to create a workflow entry. No outbound X12 in P0.
- P1 full: complete loop mapping per PAS IG mapping tables; companion-guide config per trading partner; golden fixture round-trip regression suite.

## Data
- Raw X12 string stored in MinIO with `correlation_id` and `tenant_id` before transform.
- Mapping tables versioned in config (not hard-coded).

## Dependencies
- `packages/canonical-model` — canonical `Case` type.
- MinIO — raw retention.
- X12 parsing library (open-source; e.g., Edifecs or custom segment parser — decision pending).

## Definition of Done (T17 — P1)
- [ ] X12 278 inbound → canonical `Case` with same required fields as an equivalent PAS submit.
- [ ] Canonical `Case` → X12 278 outbound, round-trip assert: fields survive.
- [ ] Raw X12 stored in MinIO before transform.
- [ ] Companion-guide variability resolved from config (test with two trading-partner profiles).
- [ ] Regression suite of golden X12↔canonical pairs passes.

## P0 stub DoD
- [ ] A minimal X12 278 parser that extracts ISA/GS control numbers and a service type code.
- [ ] Returns a `Case` with `correlation_id`, `tenant_id`, and `channel = x12`.
- [ ] Raw X12 stored in MinIO.

## Gotchas
- X12 278 companion guides differ per trading partner — the translator must be configuration-driven, never hard-coded.
- Lossless means: any field required by the 278 spec that has a canonical representation must survive the round trip. Document explicitly which fields have no canonical equivalent (and how they're preserved as extension metadata).
```

- [ ] **Step 4: Write `.claude/specs/crd-dtr.md`**

```markdown
# Spec: crd-cds-hooks + dtr-service (JVM/HAPI)

**Phase:** P1 · **Stack:** Java 21, HAPI FHIR, Spring Boot, CDS Hooks · **Review class:** sensitive (FHIR)

## CRD (Coverage Requirements Discovery)

### Responsibility
Exposes CDS Hooks endpoints for coverage requirements discovery. When a provider orders a service in their EHR, the EHR fires a hook; Enstellar calls Digicore and returns cards telling the provider whether PA is required and what documentation is needed.

### Interfaces
- `POST /cds-hooks/order-select` — returns `{ cards: [...] }` with coverage info cards.
- `POST /cds-hooks/order-sign` — same, at order signing.
- `POST /cds-hooks/appointment-book` — for appointment-level PA check.
- Cards: `PA required` (with DTR launch link), `PA not required` (with rule reference), `alternatives`, `documentation requirements`.
- `GET /cds-hooks` — service discovery endpoint.

### Internals
- Calls `integration-connectors/DigiCoreClient.get_crd_content(service_code, member_id, plan_id)`.
- Returns CDS Hooks `Card` objects per the CDS Hooks spec (1.0).
- DTR launch card includes a SMART app launch URL pointing to `dtr-service`.

## DTR (Documentation Templates and Rules)

### Responsibility
Serves FHIR `Questionnaire`+CQL artifacts (sourced from Digicore) to DTR-capable EHR apps or SMART apps. Accepts completed `QuestionnaireResponse` and attaches it to the case.

### Interfaces
- `GET /fhir/Questionnaire?context={service_code}&plan={plan_id}` — returns the DTR `Questionnaire` + CQL package.
- `POST /fhir/QuestionnaireResponse` — accepts completed response; links to case.
- SMART app launch: `GET /dtr/launch?iss={fhir_base}&launch={launch_token}`.

### DoD
- [ ] `order-select` hook returns correct cards for three test contexts: (a) PA required, (b) PA not required, (c) DTR launch.
- [ ] Digicore client called correctly; trace reference included in card extension.
- [ ] DTR `Questionnaire` + CQL served per Digicore content; test with a reference DTR SMART app.
- [ ] `QuestionnaireResponse` accepted and attached to the correct case.
- [ ] CDS Hooks service discovery endpoint returns valid service list.

## Gotchas
- CDS Hooks `fhirAuthorization` must be validated before calling back to the EHR for prefetch.
- The DTR `Questionnaire` is Digicore's content — do not cache it past its effective date.
- CQL execution happens in the EHR/DTR app, not in Enstellar — Enstellar only serves the artifact.
```

- [ ] **Step 5: Write `.claude/specs/workflow-engine.md`**

```markdown
# Spec: workflow-engine (Python)

**Phase:** P0 skeleton → P1 full · **Stack:** Python 3.12, FastAPI, Pydantic v2, PostgreSQL (asyncpg), Kafka (aiokafka) · **Review class:** sensitive (decision path)

## Responsibility
The **deterministic spine** — configurable state machine that is the system of record for every case's lifecycle. Drives states, transitions, guards, timers, and actions from metadata per tenant/LOB/program. No code branches for standard workflow variations.

Also owns: task/queue service, regulatory-clock/SLA manager, decision & rules-trace recorder, outbound communication dispatch.

## Interfaces

### REST (internal, via BFF)
- `POST /cases` — create case from canonical model
- `GET /cases/{case_id}` — case detail + current state
- `GET /cases/{case_id}/events` — immutable event history
- `POST /cases/{case_id}/transitions` — trigger a manual transition (with actor, reason)
- `GET /queues/{queue_id}/worklist` — paginated worklist with SLA info
- `POST /tasks` — create a task on a case
- `GET /tasks/{task_id}`
- `POST /admin/workflows` — upsert workflow definition (tenant-scoped)

### Kafka (consumed)
- `case.intake.received` — creates state machine instance
- `decision.recorded` → triggers notification dispatch
- `rfi.response.received` → resumes clock and re-checks completeness

### Kafka (emitted — outbox)
- `case.state.transitioned`
- `case.pended`, `case.assigned`, `case.closed`
- `clock.started`, `clock.paused`, `clock.resumed`, `clock.breached`
- `rfi.requested`, `notification.sent`

## Internals

### State machine
- State/transition definitions stored in PostgreSQL as JSON (versioned per tenant/LOB/program/version).
- Each transition has: `from_state`, `to_state`, `guards[]`, `actions[]`, `timers[]`.
- **No state transition executes without all guards passing.**
- The **adverse-transition guard** is a hard guard (not configurable away): `if outcome in {denied, partially_denied, adverse_modification}: require human_signoff_recorded == True`.
- Actions are deterministic side effects (emit event, create task, pause clock, send notification). No LLM calls.
- Transitions are **idempotent**: re-applying the same transition with the same correlation ID is a no-op.

### Regulatory-clock / SLA manager
- Clock definitions: `type` (decision/RFI/notification/appeal), `lob`, `state_jurisdiction`, `urgency`, `duration_calendar_days`, `business_calendar`, `pause_on_states[]`, `resume_on_events[]`.
- Clock state: `started_at`, `paused_at`, `paused_duration_total`, `deadline`, `status`.
- `deadline` = `started_at + duration` adjusted for pauses and business calendar.
- SLA breach detection: a background task checks all active clocks; breach emits `clock.breached` event and raises an alert.
- Clock pause/resume is deterministic (no AI involvement).

### Decision & rules-trace recorder
- On every determination event, records: `rule_artifact_id`, `rule_version`, `criteria_branch`, `evidence_refs[]`, `outcome`, `human_signoff_actor`, `human_signoff_at`.
- This record is immutable after creation.

### Auto-determination path
- **Approve only.** Eligible requests (configured per tenant/LOB/service-category) that fully meet criteria may transition to `Approved` automatically.
- Guard: `outcome == 'approved'`. Any non-approved outcome is blocked from the auto path and routed to clinical review.
- The auto-approval action records `human_signoff_required = False` and `auto_approved = True` in the decision record.

## Data
- `workflow_instances` — state machine instances (case_id, tenant_id, state, version, correlation_id)
- `workflow_definitions` — JSON-column config per tenant/LOB/program/version
- `workflow_events` — immutable event log (mirrored from Kafka for query)
- `tasks` — task records linked to cases
- `clocks` — clock instances per case

## Dependencies
- `packages/canonical-model` — `Case`, `Decision` types
- `packages/event-contracts` — event envelope + topic names
- Kafka — event bus
- Digicore client — decision + rules trace
- Agent layer — assist invocations (P1)

## NFRs
- Manual transition (UI action) < 2s p50
- State machine step (no external call) < 100ms
- Clock breach detection lag < 60s

## Definition of Done

### T08 (skeleton)
- [ ] State machine drives intake→completeness→auto-determination states.
- [ ] Each transition emits a tenant-scoped event via the outbox.
- [ ] Idempotent re-run of a state with the same correlation ID is a no-op.
- [ ] `GET /cases/{id}/events` returns the full event history.

### T10 (auto-determination)
- [ ] Auto-determination path approves eligible cases.
- [ ] **Property test: no adverse outcome (denied/partial/adverse) is possible through the auto path** — fuzz with randomized criteria responses.
- [ ] Rules trace pinned to Digicore artifact version at time of decision.
- [ ] `human_signoff_required = False` recorded correctly for auto-approvals.

### T13 (pend/RFI + clocks)
- [ ] Entering `Pend_RFI` state pauses the decision clock.
- [ ] RFI event dispatched via outbox.
- [ ] On `rfi.response.received`, clock resumes.
- [ ] SLA breach detection raises `clock.breached` event.
- [ ] Clock behavior tested against representative rules (e.g., expedited 72h, standard 7 days).

## Gotchas
- The adverse-transition guard lives in the state machine transition logic, NOT only in the UI. Even a direct API call to `/cases/{id}/transitions` must enforce it.
- Clock pause duration must accumulate across multiple pauses (not just the last one).
- Workflow definition versioning: a case always executes against the definition version active when it was created, not the latest.
```

- [ ] **Step 6: Write `.claude/specs/agent-layer.md`**

```markdown
# Spec: agent-layer (Python)

**Phase:** P1 · **Stack:** Python 3.12, LangGraph, FastAPI, Pydantic v2, MCP · **Review class:** sensitive (AI)

## Responsibility
Governed agentic-AI layer: agent orchestrator, the three v1 assist agents, guardrail/policy engine, pluggable model-access layer, provenance recorder, and eval harness.

**Invariant:** Agents are advisory tools only. They may draft suggestions but may never commit state transitions, send communications, or produce adverse determinations.

## V1 Agents

| Agent | Purpose (advisory) | Key tools | Output |
|---|---|---|---|
| Intake-Normalization | Map heterogeneous intake onto canonical case; flag ambiguities | FHIR read, terminology | Proposed field mappings + confidence |
| Completeness & RFI | Compare evidence to Digicore rules; draft structured RFI | Digicore, Revital, FHIR read | Gap list (cited) + draft RFI |
| Triage & Routing | Suggest queue/reviewer | case/event search, FHIR read | Routing suggestion + rationale |

## Interfaces

### Internal REST
- `POST /assist/normalize` — invoke Intake-Normalization agent
- `POST /assist/completeness` — invoke Completeness & RFI agent
- `POST /assist/triage` — invoke Triage & Routing agent

All endpoints return:
```json
{
  "result": { ... },          // agent-specific output
  "confidence": 0.0–1.0,
  "citations": [...],
  "abstained": false,
  "provenance": {
    "model_id": "...",
    "model_version": "...",
    "prompt_template_id": "...",
    "prompt_template_version": "...",
    "inputs_hash": "...",
    "tool_calls": [...]
  }
}
```

### Kafka (published — outbox)
- `agent.assist.produced` — per agent invocation (model, prompt, inputs, output, confidence, human action recorded later)

## Guardrail engine

Every agent output passes through the guardrail engine before being returned. The engine enforces:

1. **Schema validity** — output matches the declared Pydantic schema.
2. **Grounding** — assertions cite Revital document spans or Digicore rule references. Ungrounded assertions → abstain.
3. **Abstention threshold** — if `confidence < threshold` (configured per agent), return `abstained = True` and route to human.
4. **No-autonomous-adverse** — hard block: if the output could be interpreted as recommending a denial/adverse action, it is blocked and the case is routed to human review.
5. **Least authority** — agents return draft/suggestion objects. The engine strips any field that would directly commit a state transition.
6. **PHI minimization** — case data is minimized/redacted per config before being passed to the model-access layer.
7. **Tenant/boundary isolation** — context is scoped to the requesting tenant; no cross-tenant retrieval.

## Model-access layer

Provider-agnostic interface:
```python
class ModelAccessPort(Protocol):
    async def complete(self, prompt: str, system: str, tools: list[Tool], ...) -> Completion: ...
    async def embed(self, text: str) -> list[float]: ...
```

Implementations:
- `AnthropicAdapter` — Claude via Anthropic SDK (commercial boundary)
- `OllamaAdapter` — local open-weight via Ollama REST API (local dev + FedRAMP boundary)
- `VLLMAdapter` — open-weight via vLLM (FedRAMP boundary)

Selected by `ENSTELLAR_MODEL_PROVIDER` env var. No cross-boundary inference.

## Provenance recorder

Records per agent invocation:
- `model_id`, `model_version`
- `prompt_template_id`, `prompt_template_version`
- SHA-256 hash of minimized inputs
- Full output (confidence, citations, abstained flag)
- `human_action` (populated later when reviewer accepts/overrides)

## Eval harness

Each agent has a golden dataset of (input, expected_output) pairs (clinically reviewed for completeness/RFI agent). Gates:
- **Groundedness rate** ≥ threshold (e.g., 90% of assertions have citations)
- **Gap detection precision/recall** ≥ threshold (completeness agent)
- **Abstention rate** within acceptable range (not too eager, not too permissive)
- **Schema validity** = 100% (no output fails the Pydantic schema)

Evals run in CI on merge to main; gate threshold violations block the merge.

## Definition of Done (T14)

- [ ] Completeness & RFI agent: inputs case + Digicore doc rules + Revital evidence; outputs gap list with citations + draft RFI body.
- [ ] Guardrail engine blocks any output attempting to directly send an RFI or modify case state.
- [ ] Abstention triggers when confidence < configured threshold.
- [ ] No-autonomous-adverse guard blocks any output resembling a denial recommendation.
- [ ] PHI minimization applied before model call; verified by test asserting no raw PHI in model request payload.
- [ ] Agent eval suite passes all gates against the golden dataset.
- [ ] Provenance event recorded for every invocation; event schema validates.

## Gotchas
- LangGraph typed state graphs: define input/output types as Pydantic models for every node. The graph schema is the contract; don't use `dict` intermediaries.
- MCP tool permissions are least-privilege per agent: completeness agent gets Digicore + Revital + FHIR read only. Do not give triage agent write access.
- Model-access retries must not retry on guardrail failures (those are not transient errors). Only retry on transport errors.
```

- [ ] **Step 7: Write `.claude/specs/integration-connectors.md`**

```markdown
# Spec: integration-connectors (Python)

**Phase:** P0 (Digicore) → P1 (Revital, core-admin, terminology) · **Stack:** Python 3.12, FastAPI, httpx, Pydantic v2 · **Review class:** standard (Revital: sensitive AI/PHI)

## Responsibility
Resilient HTTP clients for external and internal service dependencies. All clients resolve their endpoint URL from the deployment config (per-boundary) and apply tenant context and circuit-breaker/retry logic.

## Clients

### DigiCoreClient (P0)

**Endpoint (env):** `DIGICORE_BASE_URL` (default: `http://mock-digicore:8000` locally)

```python
class DecisionRequest(BaseModel):
    case_id: str
    service_code: str
    member_id: str
    plan_id: str
    tenant_id: str

class StructuredTrace(BaseModel):
    artifact: str        # policy artifact identifier
    version: str         # pinned version used
    source: str          # provenance reference
    logic_branch: str    # which branch of criteria was evaluated

class DecisionResponse(BaseModel):
    decision: Literal["approved", "pending_review", "denied"]
    requirements: list[str]
    structured_trace: StructuredTrace

async def evaluate_request(self, req: DecisionRequest) -> DecisionResponse: ...
async def get_crd_content(self, service_code: str, member_id: str, plan_id: str, tenant_id: str) -> CRDContent: ...
async def get_questionnaire(self, service_code: str, plan_id: str, version: str, tenant_id: str) -> Questionnaire: ...
```

### RevitalClient (P1)

**Endpoint (env):** `REVITAL_BASE_URL`

```python
class SummarizeRequest(BaseModel):
    case_id: str
    document_ids: list[str]
    tenant_id: str
    # PHI minimized before this object is constructed

class SummarizeResponse(BaseModel):
    summary: str
    citations: list[Citation]
    extracted_entities: list[ExtractedEntity]
    completeness: dict  # {"gaps": [...]}
    triage: TriageSuggestion
    abstained: bool
    model_version: str

async def summarize(self, req: SummarizeRequest) -> SummarizeResponse: ...
```

**PHI rule:** `SummarizeRequest` is constructed only after PHI minimization is applied per tenant config.

### TerminologyClient (P1)
Calls a FHIR terminology service (local HAPI or external): `$expand`, `$validate-code`, `$lookup`. Used by agents and the X12 translator.

### CoreAdminClient (P1)
Integration with core admin platforms (Facets, QNXT, HealthEdge). Adapter pattern: `CoreAdminPort` interface with one implementation per supported platform. Methods: `get_eligibility()`, `get_member_coverage()`, `link_authorization()`.

## Resilience
All clients use:
- `httpx.AsyncClient` with configured timeouts
- Exponential backoff with jitter (3 retries, max 30s)
- Circuit breaker (`circuitbreaker` lib or equivalent): open after 5 consecutive failures; half-open after 30s
- Per-boundary endpoint resolution from `ENSTELLAR_BOUNDARY` env var

## Definition of Done (T09 — Digicore client)
- [ ] `DigiCoreClient.evaluate_request()` calls `POST /api/v1/decisions` and returns `DecisionResponse`.
- [ ] `tenant_id` is present on every request.
- [ ] Circuit breaker opens after 5 consecutive 5xx errors.
- [ ] Retry with exponential backoff on transient errors (502, 503, 504, connection errors).
- [ ] Test with mock Digicore (compose stack) — decision + trace returned correctly.
- [ ] Test with simulated Digicore outage — circuit breaker opens; workflow engine enters a retryable wait state (not a crash).

## Gotchas
- Revital is advisory only — a `RevitalClient` failure must never block the case workflow; the workflow falls back to human-only review.
- Never pass un-minimized PHI to `RevitalClient`; PHI minimization is the caller's responsibility and is enforced in the guardrail engine (agent-layer).
- Core admin platform connectors vary widely — use the adapter pattern; do not leak platform-specific types into the workflow engine.
```

- [ ] **Step 8: Write `.claude/specs/portal-bff-web.md`**

```markdown
# Spec: portal-bff + web (Python / TypeScript)

**Phase:** P1 · **Stack:** Python 3.12 + FastAPI (BFF), TypeScript + React + Vite + TanStack Query (web) · **Review class:** standard

## portal-bff

### Responsibility
Backend-for-frontend. Aggregates data from the workflow engine, FHIR API (via canonical model), and agent layer for the reviewer workspace and worklist. Enforces authorization — the browser never talks to HAPI or the workflow engine directly.

### Interfaces
- `GET /bff/cases/{case_id}` — case detail: header, service lines, member/coverage, documents list, AI advisory state, events timeline, clocks
- `GET /bff/queues/{queue_id}/worklist` — paginated worklist with SLA columns and filters
- `POST /bff/cases/{case_id}/decision` — submit a determination (approve/deny/escalate) with sign-off
- `POST /bff/cases/{case_id}/rfi` — approve and send a drafted RFI
- `GET /bff/cases/{case_id}/ai-summary` — fetch Revital advisory summary for this case
- All endpoints require OIDC token; `tenant_id` derived from token.

### Internals
- Fan-out to workflow engine (`GET /cases/{id}`) + FHIR API (document/resource links) + agent layer (advisory state).
- Response shape is BFF-specific (not a direct workflow engine DTO) — optimized for the reviewer workspace.
- RBAC check on every route: `reviewer` may view + decide; `admin` may configure; `coordinator` may manage RFI.

## web (Reviewer Workspace + Admin)

### Key views
1. **Worklist/queue view** — paginated table with columns: case ID, member, service, LOB, status, SLA (deadline + RAG status), assignee. Sort by SLA, filter by status/LOB/assignee. Bulk reassign action.
2. **Case workspace** — single-page, no full reload:
   - **Header bar:** case ID, status chip, SLA countdown, urgency badge, LOB.
   - **Service lines panel:** table of requested services with status per line.
   - **Member/coverage panel:** member demographics, plan, coverage type.
   - **Documents panel:** list of attachments with provenance; inline PDF viewer.
   - **Rules trace panel:** Digicore artifact, version, criteria branch, matching/failing criteria (collapsible).
   - **AI advisory panel:** Revital summary (cited), completeness gaps, triage suggestion, confidence bar. Clearly labeled "Advisory — for reviewer use only". Reviewer can accept or override with reason.
   - **Events timeline:** immutable ordered list of every state transition, external call, agent interaction, and user action.
   - **Actions panel:** context-sensitive buttons: approve / escalate / pend+RFI / request peer-to-peer. Decision capture form: outcome, rationale, sign-off confirmation.
3. **Admin config view** (P1 scope): workflow definition editor (JSON), clock profile editor, template editor.

### Tech conventions
- API clients generated from OpenAPI spec of `portal-bff`.
- State: TanStack Query for server state; no global client state store.
- Styling: Tailwind CSS (or design system TBD).
- E2E: Playwright tests covering the golden path: worklist → case workspace → decision.

### Accessibility
- WCAG AA for all interactive elements.
- All status indicators have text alternatives (not color-only).

## Definition of Done (T12 — MVP worklist + workspace)
- [ ] Worklist shows cases sorted by SLA deadline; SLA column shows RAG color + countdown.
- [ ] Case workspace displays case header, service lines, documents list, and events timeline from BFF.
- [ ] Decision capture form (approve/escalate) calls `POST /bff/cases/{id}/decision`; success shows confirmation.
- [ ] BFF returns 403 if the reviewer's token does not have the `reviewer` role for the case's tenant.
- [ ] Playwright test: load worklist, open a case, submit an approval.

## Gotchas
- The web app must never call HAPI FHIR directly. All data comes through the BFF. Enforce this with CSP headers.
- The AI advisory panel must be visually distinct and clearly labeled as advisory. It must not be the primary/only element the reviewer sees before the decision form.
- Decision sign-off for adverse outcomes requires a confirmation dialog (on top of the form submit) — this is a UX-level guard in addition to the server-side transition guard.
```

- [ ] **Step 9: Verify all spec files exist**

```bash
ls .claude/specs/
# Expected: 8 files
# fhir-api.md  pas-service.md  x12-translator.md  crd-dtr.md
# workflow-engine.md  agent-layer.md  integration-connectors.md  portal-bff-web.md
```

---

## Task 4: Repository skeleton (directory structure + root config files)

**Files:**
- Create: `.gitignore`
- Create: `.editorconfig`
- Create dirs: `packages/canonical-model/`, `packages/event-contracts/`, `packages/authz/`
- Create dirs: `services/interop/`, `services/workflow-engine/`, `services/agent-layer/`, `services/integration-connectors/`, `services/portal-bff/`
- Create dirs: `apps/web/`, `test/`, `docs/`

- [ ] **Step 1: Write `.gitignore`**

```
# Python
__pycache__/
*.py[cod]
*.egg-info/
.venv/
.uv/
dist/
.mypy_cache/
.ruff_cache/
.pytest_cache/
htmlcov/
.coverage

# JVM
.gradle/
build/
*.class
*.jar
.java-version

# TypeScript / Node
node_modules/
dist/
.next/
.vite/
*.tsbuildinfo

# IDE
.idea/
.vscode/
*.swp
*.swo

# Infra / secrets
.env
.env.local
*.tfstate
*.tfstate.*
.terraform/
*.pem
*.key
*.p12

# OS
.DS_Store
Thumbs.db

# Docker
docker-compose.override.yml
```

- [ ] **Step 2: Write `.editorconfig`**

```ini
root = true

[*]
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
charset = utf-8

[*.{py,java,kt}]
indent_style = space
indent_size = 4

[*.{ts,tsx,js,jsx,json,yaml,yml,html,css}]
indent_style = space
indent_size = 2

[*.{md}]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab
```

- [ ] **Step 3: Create directory placeholders**

```bash
mkdir -p packages/canonical-model packages/event-contracts packages/authz
mkdir -p services/interop services/workflow-engine services/agent-layer services/integration-connectors services/portal-bff
mkdir -p apps/web test docs
touch packages/canonical-model/.gitkeep
touch packages/event-contracts/.gitkeep
touch packages/authz/.gitkeep
touch services/interop/.gitkeep
touch services/workflow-engine/.gitkeep
touch services/agent-layer/.gitkeep
touch services/integration-connectors/.gitkeep
touch services/portal-bff/.gitkeep
touch apps/web/.gitkeep
touch test/.gitkeep
```

- [ ] **Step 4: Move existing docs to `docs/`**

```bash
mv enstellar_prd.md docs/
mv enstellar_architecture.md docs/
mv enstellar_design.md docs/
```

- [ ] **Step 5: Update CLAUDE.md to fix the docs path reference**

In `CLAUDE.md`, find the line:
```
The companion design doc lives in `docs/enstellar_design.md`
```
It already says `docs/enstellar_design.md` — verify this path is correct after the move.

```bash
grep "enstellar_design" CLAUDE.md
# Expected: docs/enstellar_design.md
```

- [ ] **Step 6: Verify structure**

```bash
find . -maxdepth 3 -not -path './.git/*' | sort
# Expected: all directories and placeholder files present
```

---

## Task 5: Root `Makefile`

**Files:**
- Create: `Makefile`

- [ ] **Step 1: Write `Makefile`**

```makefile
COMPOSE_FILE := infra/compose/docker-compose.yml
COMPOSE := docker compose -f $(COMPOSE_FILE)

.PHONY: up down test e2e conformance scan ps logs

## Bring up the full local stack and wait for all services to be healthy.
up:
	$(COMPOSE) up -d --build --wait

## Tear down the local stack and remove volumes.
down:
	$(COMPOSE) down -v

## Run unit, contract, and integration tests across all services.
test:
	@echo "→ No tests yet. Add service test targets here as services are built."
	@echo "  Example: cd services/workflow-engine && uv run pytest"

## Run end-to-end tests (requires the stack to be up).
e2e:
	@echo "→ No e2e tests yet. Add playwright/pytest targets here."

## Run FHIR conformance tests (Inferno/Touchstone). Requires make up.
conformance:
	@echo "→ No conformance tests yet. Inferno/Touchstone wired in T05/T06."

## Run security scans (SAST, secrets, dependency).
scan:
	@echo "→ No security scans yet. Wire in T01.1 (CI hardening)."

## Show status of running services.
ps:
	$(COMPOSE) ps

## Tail logs for all services (or pass SERVICE=<name> to filter).
logs:
	$(COMPOSE) logs -f $(SERVICE)
```

- [ ] **Step 2: Verify Makefile syntax**

```bash
make --dry-run up
# Expected: prints the docker compose command without running it
```

---

## Task 6: docker-compose local stack

**Files:**
- Create: `infra/compose/docker-compose.yml`
- Create: `infra/compose/.env.example`
- Create: `infra/compose/init/workflow-db-init.sql`

- [ ] **Step 1: Write `infra/compose/init/workflow-db-init.sql`**

```sql
-- Creates additional databases in the workflow-db PostgreSQL instance.
-- Runs automatically on first container start (docker-entrypoint-initdb.d).

CREATE DATABASE keycloak;
GRANT ALL PRIVILEGES ON DATABASE keycloak TO workflow;
```

- [ ] **Step 2: Write `infra/compose/.env.example`**

```bash
# Copy to .env and adjust as needed.
# .env is gitignored — never commit secrets.

# Port overrides (change if defaults conflict with local services)
HAPI_PORT=8080
KEYCLOAK_PORT=8081
MINIO_API_PORT=9000
MINIO_CONSOLE_PORT=9001
REDPANDA_KAFKA_PORT=9092
OPENSEARCH_PORT=9200
REDIS_PORT=6379
OLLAMA_PORT=11434
MOCK_DIGICORE_PORT=8090
MOCK_REVITAL_PORT=8091

# Secrets (dev only — DO NOT use in production)
HAPI_DB_PASSWORD=hapi_secret
WORKFLOW_DB_PASSWORD=workflow_secret
MINIO_ROOT_PASSWORD=minioadmin
KEYCLOAK_ADMIN_PASSWORD=admin
```

- [ ] **Step 3: Write `infra/compose/docker-compose.yml`**

```yaml
name: enstellar-local

services:
  # ── Databases ──────────────────────────────────────────────────────────────

  hapi-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: hapi
      POSTGRES_USER: hapi
      POSTGRES_PASSWORD: ${HAPI_DB_PASSWORD:-hapi_secret}
    volumes:
      - hapi-db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hapi"]
      interval: 10s
      timeout: 5s
      retries: 5

  workflow-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: workflow
      POSTGRES_USER: workflow
      POSTGRES_PASSWORD: ${WORKFLOW_DB_PASSWORD:-workflow_secret}
    volumes:
      - workflow-db-data:/var/lib/postgresql/data
      - ./init/workflow-db-init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U workflow"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── HAPI FHIR ──────────────────────────────────────────────────────────────

  hapi:
    image: hapiproject/hapi:v7.4.0
    ports:
      - "${HAPI_PORT:-8080}:8080"
    depends_on:
      hapi-db:
        condition: service_healthy
    environment:
      spring.datasource.url: jdbc:postgresql://hapi-db:5432/hapi
      spring.datasource.username: hapi
      spring.datasource.password: ${HAPI_DB_PASSWORD:-hapi_secret}
      spring.datasource.driverClassName: org.postgresql.Driver
      spring.jpa.properties.hibernate.dialect: ca.uhn.fhir.jpa.model.dialect.HapiFhirPostgres94Dialect
      hapi.fhir.fhir_version: R4
      hapi.fhir.allow_multiple_delete: "true"
      hapi.fhir.allow_external_references: "true"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8080/fhir/metadata > /dev/null 2>&1 || exit 1"]
      interval: 30s
      timeout: 15s
      retries: 10
      start_period: 90s

  # ── Kafka (Redpanda) ────────────────────────────────────────────────────────

  redpanda:
    image: redpandadata/redpanda:v24.1.7
    command:
      - redpanda
      - start
      - --smp=1
      - --memory=512M
      - --reserve-memory=0M
      - --overprovisioned
      - --node-id=0
      - --check=false
      - --kafka-addr=PLAINTEXT://0.0.0.0:29092,OUTSIDE://0.0.0.0:9092
      - --advertise-kafka-addr=PLAINTEXT://redpanda:29092,OUTSIDE://localhost:9092
      - --pandaproxy-addr=0.0.0.0:8082
      - --advertise-pandaproxy-addr=localhost:8082
    ports:
      - "${REDPANDA_KAFKA_PORT:-9092}:9092"
      - "29092:29092"
      - "8082:8082"
    healthcheck:
      test: ["CMD-SHELL", "rpk cluster health | grep -E 'Healthy:.+true' || exit 1"]
      interval: 15s
      timeout: 10s
      retries: 5
      start_period: 30s

  # ── Object Store (MinIO) ────────────────────────────────────────────────────

  minio:
    image: minio/minio:RELEASE.2024-06-04T19-20-08Z
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
    ports:
      - "${MINIO_API_PORT:-9000}:9000"
      - "${MINIO_CONSOLE_PORT:-9001}:9001"
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9000/minio/health/live || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5

  # ── Search (OpenSearch) ────────────────────────────────────────────────────

  opensearch:
    image: opensearchproject/opensearch:2.14.0
    environment:
      - discovery.type=single-node
      - DISABLE_SECURITY_PLUGIN=true
      - OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m
    ports:
      - "${OPENSEARCH_PORT:-9200}:9200"
    volumes:
      - opensearch-data:/usr/share/opensearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9200/_cluster/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s

  # ── Cache (Redis) ──────────────────────────────────────────────────────────

  redis:
    image: redis:7-alpine
    ports:
      - "${REDIS_PORT:-6379}:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── Identity (Keycloak) ────────────────────────────────────────────────────

  keycloak:
    image: quay.io/keycloak/keycloak:24.0.4
    command: start-dev
    environment:
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://workflow-db:5432/keycloak
      KC_DB_USERNAME: workflow
      KC_DB_PASSWORD: ${WORKFLOW_DB_PASSWORD:-workflow_secret}
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD:-admin}
    ports:
      - "${KEYCLOAK_PORT:-8081}:8080"
    depends_on:
      workflow-db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:8080/realms/master || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 10
      start_period: 60s

  # ── Local LLM (Ollama) ─────────────────────────────────────────────────────

  ollama:
    image: ollama/ollama:latest
    ports:
      - "${OLLAMA_PORT:-11434}:11434"
    volumes:
      - ollama-data:/root/.ollama

  # ── Mock Digicore ──────────────────────────────────────────────────────────

  mock-digicore:
    build:
      context: mocks/digicore
      dockerfile: Dockerfile
    ports:
      - "${MOCK_DIGICORE_PORT:-8090}:8000"
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:8000/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── Mock Revital ───────────────────────────────────────────────────────────

  mock-revital:
    build:
      context: mocks/revital
      dockerfile: Dockerfile
    ports:
      - "${MOCK_REVITAL_PORT:-8091}:8000"
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:8000/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  hapi-db-data:
  workflow-db-data:
  minio-data:
  opensearch-data:
  ollama-data:
```

- [ ] **Step 4: Validate compose file**

```bash
docker compose -f infra/compose/docker-compose.yml config --quiet
# Expected: exits 0 with no errors
```

---

## Task 7: Mock services (Digicore + Revital)

**Files:**
- Create: `infra/compose/mocks/digicore/requirements.txt`
- Create: `infra/compose/mocks/digicore/Dockerfile`
- Create: `infra/compose/mocks/digicore/main.py`
- Create: `infra/compose/mocks/revital/requirements.txt`
- Create: `infra/compose/mocks/revital/Dockerfile`
- Create: `infra/compose/mocks/revital/main.py`

- [ ] **Step 1: Write `infra/compose/mocks/digicore/requirements.txt`**

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
pydantic==2.7.1
```

- [ ] **Step 2: Write `infra/compose/mocks/digicore/Dockerfile`**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: Write `infra/compose/mocks/digicore/main.py`**

```python
from typing import Any, Literal
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Mock Digicore", description="Stub for local development — returns approve decisions")


class DecisionRequest(BaseModel):
    case_id: str
    service_code: str
    member_id: str
    plan_id: str
    tenant_id: str
    context: dict[str, Any] = {}


class StructuredTrace(BaseModel):
    artifact: str
    version: str
    source: str
    logic_branch: str


class DecisionResponse(BaseModel):
    decision: Literal["approved", "pending_review", "denied"]
    requirements: list[str]
    structured_trace: StructuredTrace


class CRDContent(BaseModel):
    pa_required: bool
    documentation_requirements: list[str]
    rule_reference: str
    dtr_launch_url: str | None = None


@app.post("/api/v1/decisions", response_model=DecisionResponse)
async def evaluate_request(req: DecisionRequest) -> DecisionResponse:
    return DecisionResponse(
        decision="approved",
        requirements=[],
        structured_trace=StructuredTrace(
            artifact="mock-policy-stub-v1",
            version="1.0.0",
            source="mock-digicore",
            logic_branch="auto-approve-stub",
        ),
    )


@app.get("/api/v1/crd", response_model=CRDContent)
async def get_crd_content(
    service_code: str,
    member_id: str,
    plan_id: str,
    tenant_id: str,
) -> CRDContent:
    return CRDContent(
        pa_required=True,
        documentation_requirements=["clinical-notes", "diagnosis-codes"],
        rule_reference="mock-rule-stub-v1",
        dtr_launch_url="http://localhost:8080/dtr/launch",
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "mock-digicore"}
```

- [ ] **Step 4: Write `infra/compose/mocks/revital/requirements.txt`**

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
pydantic==2.7.1
```

- [ ] **Step 5: Write `infra/compose/mocks/revital/Dockerfile`**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 6: Write `infra/compose/mocks/revital/main.py`**

```python
from typing import Any
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Mock Revital", description="Stub for local development — returns empty advisory summaries")


class SummarizeRequest(BaseModel):
    case_id: str
    document_ids: list[str]
    tenant_id: str
    context: dict[str, Any] = {}


class Citation(BaseModel):
    document_id: str
    span: str
    text: str


class ExtractedEntity(BaseModel):
    type: str
    value: str
    provenance: str


class TriageSuggestion(BaseModel):
    suggestion: str
    confidence: float


class SummarizeResponse(BaseModel):
    summary: str
    citations: list[Citation]
    extracted_entities: list[ExtractedEntity]
    completeness: dict[str, list[str]]
    triage: TriageSuggestion
    abstained: bool
    model_version: str


@app.post("/api/v1/summarize", response_model=SummarizeResponse)
async def summarize(req: SummarizeRequest) -> SummarizeResponse:
    return SummarizeResponse(
        summary=f"[Mock] Advisory summary for case {req.case_id}. No real documents were analyzed.",
        citations=[],
        extracted_entities=[],
        completeness={"gaps": []},
        triage=TriageSuggestion(suggestion="routine_review", confidence=0.95),
        abstained=False,
        model_version="mock-v0.0.1",
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "mock-revital"}
```

- [ ] **Step 7: Build mock images to verify Dockerfiles are valid**

```bash
docker build -t enstellar-mock-digicore infra/compose/mocks/digicore/
# Expected: Successfully tagged enstellar-mock-digicore:latest

docker build -t enstellar-mock-revital infra/compose/mocks/revital/
# Expected: Successfully tagged enstellar-mock-revital:latest
```

---

## Task 8: GitHub Actions CI skeleton

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  validate-compose:
    name: Validate docker-compose
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate compose config
        run: docker compose -f infra/compose/docker-compose.yml config --quiet

  lint-makefile:
    name: Lint Makefile
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Dry-run make targets
        run: |
          make --dry-run up
          make --dry-run down
          make --dry-run test
          make --dry-run conformance
          make --dry-run scan

  lint-python-mocks:
    name: Lint Python mock services
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install ruff
        run: pip install ruff
      - name: Lint mock services
        run: ruff check infra/compose/mocks/

  validate-specs:
    name: Validate .claude spec files exist
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check spec files
        run: |
          for f in \
            .claude/task-graph.md \
            .claude/guardrails.md \
            .claude/specs/fhir-api.md \
            .claude/specs/pas-service.md \
            .claude/specs/x12-translator.md \
            .claude/specs/crd-dtr.md \
            .claude/specs/workflow-engine.md \
            .claude/specs/agent-layer.md \
            .claude/specs/integration-connectors.md \
            .claude/specs/portal-bff-web.md; do
            test -f "$f" || (echo "Missing: $f" && exit 1)
          done
          echo "All spec files present."
```

- [ ] **Step 3: Verify YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
# Expected: no output (no errors)
```

---

## Task 9: Verify — `make up` / `make down`

This is the T01 acceptance test. All services must reach a healthy state.

- [ ] **Step 1: Copy `.env.example` to `.env`**

```bash
cp infra/compose/.env.example infra/compose/.env
```

Note: `.env` is gitignored. The compose file reads from `infra/compose/.env` via Docker Compose's env_file auto-discovery when run from the compose file's directory, or pass it explicitly.

- [ ] **Step 2: Run `make up` and wait**

```bash
make up
# This will build mock images and pull all others.
# Expected: all containers reach 'healthy' status.
# HAPI takes 90s+ to start; total wait ~3-5 minutes on first run.
```

- [ ] **Step 3: Verify all services are healthy**

```bash
make ps
# Expected: All services show 'healthy' in the STATUS column.
# Services: hapi-db, workflow-db, hapi, redpanda, minio, opensearch, redis, keycloak, ollama, mock-digicore, mock-revital
```

- [ ] **Step 4: Smoke-test key endpoints**

```bash
# HAPI FHIR CapabilityStatement
curl -s http://localhost:8080/fhir/metadata | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['resourceType'])"
# Expected: CapabilityStatement

# Keycloak realm
curl -s http://localhost:8081/realms/master | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['realm'])"
# Expected: master

# Mock Digicore
curl -s http://localhost:8090/health
# Expected: {"status":"ok","service":"mock-digicore"}

# Mock Revital
curl -s http://localhost:8091/health
# Expected: {"status":"ok","service":"mock-revital"}

# OpenSearch cluster health
curl -s http://localhost:9200/_cluster/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])"
# Expected: green or yellow (not red)

# Redpanda (via Pandaproxy)
curl -s http://localhost:8082/topics
# Expected: JSON array (possibly empty)

# MinIO health
curl -sf http://localhost:9000/minio/health/live && echo "MinIO: healthy"
# Expected: MinIO: healthy
```

- [ ] **Step 5: Tear down cleanly**

```bash
make down
# Expected: all containers stopped and volumes removed; exits 0
```

- [ ] **Step 6: Run `make test`, `make conformance`, `make scan` to verify they exit 0**

```bash
make test && make conformance && make scan
# Expected: each prints its "no tests yet" message and exits 0
```

---

## Self-Review

**Spec coverage check:**

| Requirement from design doc | Covered by task |
|---|---|
| `.claude/task-graph.md` with all P0/P1 tasks + DoDs | Task 1 |
| `.claude/guardrails.md` with hard prohibitions + review gates | Task 2 |
| `.claude/specs/` one file per component from §6 | Task 3 |
| Directory skeleton matching §4 repo map | Task 4 |
| `make up/down/test/e2e/conformance/scan` targets | Task 5 |
| HAPI FHIR + PostgreSQL in compose | Task 6 |
| Redpanda (Kafka) in compose | Task 6 |
| MinIO (S3) in compose | Task 6 |
| OpenSearch in compose | Task 6 |
| Keycloak in compose | Task 6 |
| Ollama in compose | Task 6 |
| Redis in compose (from D-6) | Task 6 |
| Mock Digicore in compose | Tasks 6 + 7 |
| Mock Revital in compose | Tasks 6 + 7 |
| CI skeleton green | Task 8 |
| T01 DoD: compose up healthy + make targets work | Task 9 |

**Placeholder scan:** No TBDs, TODOs, or "implement later" in task steps — all steps have actual file content or bash commands with expected output.

**Type consistency:** Mock stubs use Pydantic v2 models consistent with the contracts in `integration-connectors.md` spec. `DecisionResponse` and `SummarizeResponse` shapes match the contracts in `.claude/specs/`.
