# Platform Alignment Audit — Evidence Appendix

**Run date:** 2026-06-10  
**Auditor:** Claude Code (claude-sonnet-4-6)  
**Codebase hash:** git HEAD `84b3315` (branch: main)  
**Files read:** ~55 source files  
**Scan commands run:** ~25 grep/find/bash commands  

---

## 1. Repo Shape

### Module inventory

| Module | Path | Language/Framework | Purpose |
|---|---|---|---|
| workflow-engine | `services/workflow-engine/` | Python 3.12 / FastAPI / asyncpg | Case lifecycle state machine, clocks, worklists, RFI, human signoffs, outbox relay, notification service |
| agent-layer | `services/agent-layer/` | Python / FastAPI / LangGraph | Completeness + triage advisory agents; 7-rule guardrail engine; Anthropic/Ollama model adapters; eval harness |
| interop | `services/interop/` | Java 21 / Spring Boot / HAPI FHIR | PAS $submit/$inquire, CRD/CDS Hooks, DTR questionnaire serving, decision store, FHIR proxy |
| portal-bff | `services/portal-bff/` | Python / FastAPI | Reviewer UI aggregation; proxies to workflow-engine; handles adverse decision sign-off flow |
| integration-connectors | `services/integration-connectors/` | Python | DigiCoreClient (circuit breaker + retry), RevitalClient, PHI minimizer |
| canonical-model | `packages/canonical-model/` | Generated Python/Java/TypeScript | Case, Decision, Member, Coverage, ServiceLine, Provider Pydantic/JPA/TS models from JSON schemas; round-trip tests |
| authz | `packages/authz/` | Python | JWT validation library, `TenantContext` ContextVar, `require_auth` FastAPI dependency |
| event-contracts | `packages/event-contracts/` | Python | `EventEnvelope`, `Actor`, `ActorType` Pydantic models; `Topics` constants |
| web UI | `apps/web/` | TypeScript / React + Vite | Reviewer worklist, case page, DTR form, EHR order simulator; Playwright e2e tests |
| infra | `infra/compose/`, `infra/helm/`, `infra/terraform/` | Docker Compose + YAML | Local stack: HAPI, Redpanda, MinIO, Keycloak, digicore-mock, revital-mock |

### Dependency sketch

```
apps/web → portal-bff (REST) → workflow-engine (REST) + digicore (REST via integration-connectors)
portal-bff → workflow-engine (REST, via WorkflowClient)
workflow-engine → integration-connectors (imported: DigiCoreClient, RevitalClient)
workflow-engine → packages/authz (require_auth dependency)
workflow-engine → packages/event-contracts (EventEnvelope, Topics)
workflow-engine → packages/canonical-model (Case, Decision models)
agent-layer → packages/authz (require_auth)
agent-layer → packages/event-contracts (EventEnvelope)
agent-layer → integration-connectors (RevitalClient, PHI minimizer)
interop → packages/canonical-model (Java generated)
interop → (HAPI FHIR container via JPA — not a code import)
```

### All persisted tables (complete list from migrations)

**Workflow-engine (Alembic, 0001–0008):**
- `outbox`: event_id, tenant_id, case_id, type, payload, schema_version, occurred_at, correlation_id, actor_id, actor_type, published_at
- `processed_events`: event_id, consumer_group, processed_at (idempotency dedup)
- `workflow_instances`: case_id (PK), tenant_id, correlation_id, lob, program, status, urgency, workflow_def_version, case_json (JSONB), assignee_queue, human_signoff_id, created_at, updated_at
- `workflow_events`: id (PK), case_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, correlation_id, payload, occurred_at
- `clocks`: clock_id (PK), tenant_id, case_id, clock_type, state, urgency, duration_calendar_days, started_at, deadline, paused_at, total_paused_seconds, breached_at, updated_at
- `human_signoffs`: signoff_id (PK), case_id, tenant_id, actor_id, actor_type, signed_at, outcome_context
- `notification_templates`: template_id (PK), tenant_id, event_type, channel, subject_template, body_template, version (int), active (bool)
- `notification_log`: notification_id (PK), tenant_id, case_id, event_type, channel, template_id, rendered_subject, sent_at
- `case_criteria`: id (PK), case_id (FK), tenant_id, criterion_id, text, status, plus JSONB fields
- `case_suggestions`: id (PK), case_id (FK), tenant_id, agent_id, title, body, confidence, plus JSONB

**Interop (Flyway, V1–V4):**
- `fhir_resource`: DROPPED in V4. HAPI JPA now owns all FHIR resource storage (external HAPI container).
- `decision_store`: id (PK BigSerial), case_id (UUID), tenant_id, correlation_id, claim_ref, outcome, rule_artifact, rule_version, auto_approved, decided_at, created_at, patient_ref, insurer_ref, claim_fhir_id

**RLS status:** ZERO tables have `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` statements in any migration.

---

## 2. Capability Investigation Evidence

### 2.1 Tenant Context & Propagation

**JWT path (Python services):**
- `packages/authz/enstellar_authz/dependencies.py:43–65`: `require_auth` FastAPI dependency. Extracts `tenant_id` from JWT via `JWTValidator`, rejects blank/whitespace, sets `TenantContext` ContextVar.
- `packages/authz/enstellar_authz/context.py:12–21`: `_TENANT_CTX: ContextVar[TenantContext | None]`; `get_tenant_context()` raises `RuntimeError` if not set (fail-closed).
- `services/portal-bff/enstellar_bff/auth.py:23–55`: `require_reviewer` validates JWT from Keycloak JWKS; extracts `tenant_id`, enforces `reviewer` role.
- **T-4 VIOLATION:** `services/portal-bff/enstellar_bff/auth.py:33–34`: `dev_bypass_auth` returns static tenant without any JWT check in dev mode.

**Header path (unverified):**
- `services/workflow-engine/enstellar_workflow/api/worklist_router.py:24`: `tenant_id: str = Header(..., alias="X-Tenant-Id")` — no JWT verification.
- `services/workflow-engine/enstellar_workflow/queues/router.py:13`: `tenant_id: str = Header(..., alias="X-Tenant-Id")` — no JWT verification.

**Java/HAPI path:**
- `services/interop/src/main/java/com/simintero/enstellar/interop/auth/TenantContextFilter.java:26–51`: `@Order(10)` filter extracts `tenant_id` from Spring Security JWT principal; rejects blank; calls `TenantContext.set(tenantId)`. Correct fail-closed behaviour.

**Tests for T-4 (whitespace/missing tenant):**
- `packages/authz/tests/test_dependencies.py:70,98`: Tests for missing and whitespace-only `tenant_id` returning 401. These tests cover the authz library correctly, but the worklist/queue-stats endpoints bypass this library.

---

### 2.2 Data Isolation (RLS)

**T-1 evidence (tenant_id NOT NULL):**
All tables verified:
- `outbox`: `sa.CheckConstraint("tenant_id != ''", ...)` — migration `0001:21`
- `workflow_instances`: `sa.CheckConstraint("tenant_id != ''", ...)` — migration `0002:21`
- `workflow_events`: `sa.Column("tenant_id", sa.Text, nullable=False)` — `0002:45`
- `clocks`: `sa.CheckConstraint("tenant_id != ''", ...)` — `0003:24`
- `human_signoffs`: `sa.CheckConstraint(...)` — `0005:42`
- `decision_store`: `tenant_id TEXT NOT NULL` — `V2:15`

**T-2 evidence (NO RLS):**
- Grep for `ENABLE ROW LEVEL SECURITY` across all .sql and .py files: ZERO results.
- Application-layer predicates: `CaseRepository.fetch_by_id()` at `cases/repository.py:52`: `WHERE case_id = $1 AND tenant_id = $2`. Pattern consistent across all queries.
- DB pool: `services/workflow-engine/enstellar_workflow/db/connection.py:14`: standard asyncpg pool — no `sim.tenant_id` GUC setting (as DDD §3.3 requires).

**T-4 evidence:**
- Scan command: `grep -rn "Header.*X-Tenant-Id\|Header.*tenant_id" --include="*.py" services/` → 2 hits:
  - `services/workflow-engine/enstellar_workflow/api/worklist_router.py:24`
  - `services/workflow-engine/enstellar_workflow/queues/router.py:13`
- No JWT verification wrapping these endpoints found.

---

### 2.3 Eventing & Outbox

**Outbox implementation:**
- `services/workflow-engine/enstellar_workflow/outbox/publisher.py:8–35`: `OutboxPublisher.publish()` inserts to `outbox` inside caller's transaction. `ON CONFLICT (event_id) DO NOTHING` for idempotency.
- `services/workflow-engine/enstellar_workflow/outbox/relay.py:36–63`: `OutboxRelay._relay_batch()`: (1) fetch unpublished rows, (2) `producer.send(topic, event)` to Kafka, (3) `UPDATE outbox SET published_at = now()` in a **separate connection**. Non-atomic mark: if relay crashes after Kafka publish but before DB mark, event re-delivers (at-least-once OK). If Kafka publish fails, event remains in outbox (correct). Low risk but noted.

**Envelope comparison vs C-3:**
- Built: `EventEnvelope` fields: `event_id`, `tenant_id`, `case_id`, `correlation_id`, `type`, `occurred_at`, `actor {id, type}`, `payload`, `schema_version`.
- C-3 normative: adds `schema_ref` (e.g. `sim.case.state-changed/v1`), `causation_id`, `trace_ref`.
- Missing: `schema_ref` (enum discriminator), `causation_id`, `trace_ref`.
- `type` field serves as topic name (`case.state.transitioned`) rather than schema version reference.

**Topic naming vs C-3:**
- Built topics (`packages/event-contracts/enstellar_events/topics.py`): `case.intake.received`, `case.state.transitioned`, `case.pended`, `case.assigned`, `case.closed`, `clock.*`, `rfi.*`, `notification.sent`, `decision.recorded`, `agent.assist.*`, `case.adverse.structured`.
- C-3 normative: `sim.case.lifecycle` (topic) with event types `sim.case.created/v1`, `sim.case.state-changed/v1`, `sim.case.determination-recorded/v1`, etc.; `sim.evidence`, `sim.task`, `sim.clock`, `sim.artifact`, `sim.ai.interaction`, `sim.audit.access`, `sim.tenant.admin`.
- Missing C-3 topics: `sim.evidence.*`, `sim.task.*`, `sim.artifact.*`, `sim.ai.interaction`, `sim.audit.access`, `sim.tenant.admin`.
- Topic structure: flat `case.state.transitioned` vs hierarchical `sim.case.lifecycle` (single topic, multiple event types). Different topic architecture.

**E-1 coverage estimate:**
Covered: case intake, state transitions, clock events, RFI, decision.recorded, notifications (~8 event types). Missing: evidence fabric events, AI interaction events, task events, artifact events, audit access events (~15 C-3 event types). Coverage: ~35%.

---

### 2.4 Case Event Sourcing / History

**Event store:**
- `workflow_events` table (`migration 0002:31–48`): immutable rows per state transition. PK is autoincrement `id`; columns: `case_id`, `tenant_id`, `event_type`, `from_state`, `to_state`, `actor_id`, `actor_type`, `correlation_id`, `payload` (JSONB), `occurred_at`.
- `CaseService.get_events()` at `cases/service.py:234–271`: returns all rows ordered by `id ASC`.

**Mutable projection:**
- `workflow_instances.case_json` (JSONB) is overwritten on every state transition via `CaseRepository.update_status()` at `cases/repository.py:85–106`.
- `DecisionRecorder.append_decision()` at `engine/decision_recorder.py:50–65`: appends to `case_json['decisions']` using `COALESCE(...) || '[{decision}]'::jsonb` — decisions persist across status updates.

**Reconstruction limitation:**
- The `workflow_events` table captures state transitions (from_state, to_state, actor, payload).
- Decisions are stored in `case_json['decisions']` JSONB. They are appended atomically but the source-of-truth for decisions is `case_json`, not `workflow_events.payload`.
- E-3 sample: a case moving through INTAKE → COMPLETENESS → AUTO_DET → APPROVED would show 3 workflow_events rows + 1 decision in case_json. The case_json snapshot is more complete but mutable. Rebuilding case state from `workflow_events` alone is possible for transitions; decision content (rule_artifact_id, criteria_branch) is in case_json payload of the transition event.
- DDD §4.4 specifies: "load events (or snapshot+tail) → apply command via pure reducer → append". Built system uses a mutable snapshot, not pure event sourcing.

**Concurrency:**
- No optimistic locking sequence number (DDD §4.4 `seq = last+1` conflict detection). `workflow_instances` uses last-write-wins via `UPDATE WHERE case_id = $N`.

---

### 2.5 Audit Trail

**What exists:**
- `workflow_events`: state-transition records (transition_engine writes one row per transition at `recorder.py:40–57`). Not immutable at DB level (no immutability trigger; rows could be DELETEd by DB admin).
- `human_signoffs`: clinical sign-off records (append + upsert).
- `notification_log`: notification dispatch records.
- `case_suggestions`: AI advisory outputs logged.

**What is absent:**
- No `audit` schema or dedicated audit service.
- No hash-chaining or tamper-evidence.
- No PHI read auditing (no `sim.audit.access` events).
- No evidence-package exporter.
- No retention/legal-hold policies.

**Comparison to SAD §7.2:**
- SAD requires: "immutable, append-only store with hash-chaining for tamper evidence, retention/legal-hold policies per tenant, evidence-package exporter."
- Built: none of these properties.

---

### 2.6 Workflow Engine

**State enum:**
- `packages/canonical-model/generated/python/canonical_model/case.py:18–29`: `class Status(StrEnum)` with 11 values hardcoded: `intake`, `completeness_check`, `auto_determination`, `clinical_review`, `pend_rfi`, `approved`, `denied`, `partially_denied`, `adverse_modification`, `withdrawn`, `closed`.

**Transition code:**
- `services/workflow-engine/enstellar_workflow/engine/transitions.py`: `TransitionEngine.apply()` validates the target state via `adverse_transition_guard` only (no metadata-driven guard evaluation).
- `services/workflow-engine/enstellar_workflow/engine/auto_determination.py:46–58`: Hard-coded two branches: `_approve()` → `to_state="approved"` and `_route_to_clinical_review()` → `to_state="clinical_review"`.

**workflow_def_version:**
- `services/workflow-engine/enstellar_workflow/cases/repository.py:39`: `"v1"` hardcoded string. No VKAS artifact reference.

**W-1 status:**
- DDD §9.2: "one Temporal workflow per case; generic interpreter loads the pinned workflow_def version at case start."
- Built: Python code with hardcoded StrEnum states and procedural transition logic. FAIL.

**Temporal:**
- No Temporal dependency anywhere in the codebase. `grep -rn "temporal" services/ packages/` → 0 hits in non-test code.

---

### 2.7 Regulatory Clocks & Calendars

**Implementation:**
- `services/workflow-engine/enstellar_workflow/clocks/model.py:17–22`:
```python
CLOCK_RULES: dict[tuple[str, str], int] = {
    ("expedited", "decision"): 3,   # 72 h = 3 calendar days
    ("standard", "decision"): 7,    # 7 calendar days
    ("concurrent", "decision"): 1,  # 1 calendar day
}
```
- `ClockDefinition.for_case()` at `model.py:32–43`: looks up from this dict.
- `ClockService.start()` at `clocks/service.py:47–63`: `deadline = now + timedelta(days=definition.duration_calendar_days)` — pure calendar days, no business calendar.

**W-3 evidence:**
- `grep -rn "\b72\b\|P7D\|PT72H" services/` → Comment in `model.py:4` references "72 h = 3 calendar days". Actual literal values are `3` and `7` in the dict, not scattered.
- No VKAS `clock_profile` artifacts found. No `clock_profile_pin` on cases.

**Clock pause/resume correctness:**
- `ClockService.pause()`, `.resume()`, `.check_breach()`: Arithmetic is correct — `total_paused_seconds` accumulates, `adjusted_deadline` property adds offset. Logic is sound.

---

### 2.8 Rules/Decision Logic + Versioning Seam

**Digicore seam:**
- `services/integration-connectors/enstellar_connectors/digicore/client.py`: `DigiCoreClient.evaluate_request()` — single clean call site.
- `services/integration-connectors/enstellar_connectors/digicore/models.py:37–45`: `StructuredTrace { artifact: str, version: str, source: str, logic_branch: str }`.
- `services/workflow-engine/enstellar_workflow/engine/auto_determination.py:139–153`: Decision constructed with `rule_artifact_id=resp.structured_trace.artifact`, `rule_version=resp.structured_trace.version`.

**D-2 PERMANENT violation:**
- C-1 §3 normative: response includes `pins[]` — an array of `{canonical_url, version}` for ALL governing artifacts (coverage_rule + CQL library + value sets + supplementary rules).
- `DecisionRequest` at `connectors/digicore/models.py:17–34`: No `pins` field sent to Digicore.
- `DecisionResponse` at `connectors/digicore/models.py:46–50`: Only `StructuredTrace` (single artifact) returned, no `pins[]` array.
- `Case` schema at `canonical_model/case.py:38–58`: No `pins` field.
- Evidence: all Decision records in production would have only 1 of potentially N governing artifact versions. Re-evaluation for appeal using original pins is structurally impossible with current schema. This is irreversible without data migration for already-created decisions.

**Call sites:**
- 1 call site: `auto_determination.py:99` — `await self._digicore.evaluate_request(req)`.
- Human review decisions: constructed directly from UI input via `portal-bff/routers/cases.py` — no Digicore evaluation called on the human-review path; no pin capture at all.

---

### 2.9 Document/Attachment Handling

**Raw payload storage:**
- `services/workflow-engine/enstellar_workflow/normalization/storage.py:33–62`: `MinioStore.upload()` — stores to `{bucket}/{tenant_id}/raw-bundles/{date}/{correlation_id}.json`. Called before normalization in the intake pipeline.
- `services/interop/src/main/java/com/simintero/enstellar/interop/pas/MinioRawBundleStore.java`: Parallel Java implementation for HAPI-layer raw storage.

**Missing capabilities:**
- No span-addressable storage (page/region addressing).
- No access authorization check on document retrieval (no policy check before MinIO GET).
- No OCR pipeline.
- No retention/legal hold.
- No content-hash or tamper evidence.

**P-3 evidence:**
- `grep -rn "minio.*get\|client.get_object\|presigned_url" services/ --include="*.py"` → No retrieval authorization check found. MinioStore only has `upload()` and `_ensure_bucket()`.

---

### 2.10 Task/Worklist & Notification

**Worklist:**
- `services/workflow-engine/enstellar_workflow/api/worklist_router.py`: Queries `workflow_instances` with LEFT JOIN `clocks` for SLA deadline. Returns paginated PA-specific rows. Not a generic task service.
- No `task_id`, `kind`, `subject_ref`, `sla_ref` generic task model.

**NotificationService:**
- `services/workflow-engine/enstellar_workflow/comms/service.py:26–97`: Jinja2 sandboxed template rendering; strips PHI from context; writes `notification_log` row + outbox event — all in caller's transaction. Good pattern.
- `notification_templates` table has `version: int` but no lifecycle states (draft/approved/active), no effective-dating, no promotion.

**Task gap:**
- CCEM §4.4: generic Task shape for UM review, intake exceptions, governance reviews, quality outreach.
- Built: `assignee_queue` field on `workflow_instances` only. Cannot serve non-PA task types (quality outreach, intake exceptions).

---

### 2.11 Artifact Versioning (proto-VKAS)

**What exists:**
- `notification_templates.version` (int, server_default=1): incremented manually; no lifecycle stages, no effective-dating, no approval workflow.
- `workflow_def_version = "v1"` string in `CaseRepository.insert()` at `cases/repository.py:39` — hardcoded.
- Digicore decision `rule_artifact_id + rule_version` stored on Decision — consuming external versioning but no local VKAS.

**VKAS service:**
- No `vkas.artifact` table. No `vkas.approval` table. No artifact promotion pipeline. No VKAS service code in `services/` or `platform/`.

**Impact:**
- `workflow_def_version = "v1"` means in-flight case upgrades impossible (no per-case version pin).
- Clock limits cannot be updated without code deploy.
- Prompts cannot be versioned independently of code.

---

### 2.12 AI/LLM Access (proto–Model Gateway)

**Direct calls:**
- `services/agent-layer/enstellar_agents/model_access/anthropic_adapter.py:19`: `self._client = anthropic.AsyncAnthropic(api_key=api_key)`.
- `services/agent-layer/enstellar_agents/model_access/ollama_adapter.py`: Direct Ollama HTTP calls.
- `services/agent-layer/enstellar_agents/model_access/factory.py:14–24`: Factory selects adapter based on `ENSTELLAR_MODEL_PROVIDER` env var. No gateway intercept.

**Model adapter seam:**
- `services/agent-layer/enstellar_agents/model_access/base.py:26`: Abstract `ModelAdapter` with `complete(system_prompt, user_message) → str` and `model_name() → str`. Clean seam for promoting to a gateway.

**PHI controls:**
- `services/integration-connectors/enstellar_connectors/revital/phi_minimizer.py`: Pre-call PHI field removal. Applied in connectors but NOT in agent-layer (agents use `AgentInput.case_summary` which is already PHI-minimized by design at `models.py:33`).
- Guardrail `rule_phi_minimization` scans output for SSN/DOB patterns.

**Provenance (A-2):**
- `AgentOutput.provenance: dict[str, Any]`: `{model_name, input_hash, timestamp}` — logged at `agents/completeness.py:86–88` and `agents/triage.py:86–88`.
- No `prompt_version` field. System prompts are Python string literals embedded in agent code at `agents/completeness.py:23–50` and `agents/triage.py:23–50`. No VKAS prompt artifact reference.

**A-1 evidence:**
- `grep -rn "openai\|anthropic\|AsyncAnthropic" services/agent-layer/ --include="*.py" | grep -v test | grep -v .venv`: 4 hits in `anthropic_adapter.py` (direct import + client creation).
- No Model Gateway service found. No boundary enforcement (same code paths for dev/prod/enclave).

**A-3 (AI cannot reach adverse path):**
- `GuardrailEngine.check()` at `guardrails/engine.py:30–44`: runs `rule_no_autonomous_adverse` which scans for ADVERSE_KEYWORDS in all output text.
- `AutoDeterminator` structurally limited to `approved`/`clinical_review` as documented — AI output is advisory, never fed directly to `decision.record`.

---

## 3. UNKNOWN Items

The following items could not be fully verified from available evidence:

- **UNKNOWN-1:** HAPI JPA multi-tenant isolation. HAPI owns FHIR resources (V4 dropped `fhir_resource`). HAPI's JPA data layer isolation mechanism is not verified — TenantContextFilter sets `tenant_id` but it is UNKNOWN whether HAPI JPA queries are actually scoped to that tenant or whether HAPI RLS / partition tags are configured. Requires reading HAPI config + runtime testing.
- **UNKNOWN-2:** Full round-trip fidelity test coverage. `packages/canonical-model/tests/python/test_roundtrip.py` exists but content not fully read. FHIR ↔ canonical required-elements manifest (`contracts/fhir/required-elements.json`) referenced in DDD §8 — file NOT found in repo; may not exist.
- **UNKNOWN-3:** E-3 for real/synthetic cases. Only workflow_events read path verified; full end-to-end case reconstruction test not executed (no test database accessible).
- **UNKNOWN-4:** OPA policy enforcement. `packages/authz` has JWT validation but OPA integration (DDD §7.2) not found. `grep -rn "opa\|Open Policy Agent" services/` → 0 hits. Whether OPA is wired or absent is UNKNOWN.
- **UNKNOWN-5:** Kafka consumer idempotency. `processed_events` table exists for dedup; consumer code not fully read to verify all consumers use it.

---

## 4. Scan Commands Executed

```bash
# Repo structure
find . -maxdepth 2,4 -not -path .git/*
find . -name "*.sql" -not -path .git/*
find . -name "*.py" -not -path ./.venv/*
find . -name "*.ts" -not -path node_modules

# SQL migrations
cat services/interop/src/main/resources/db/migration/V*.sql
cat services/workflow-engine/migrations/versions/000*.py

# Table / RLS scan
grep -rn "CREATE TABLE|ENABLE ROW LEVEL|CREATE POLICY|tenant_id" --include=*.sql,*.py services/ infra/ packages/

# Hardcoded clock literals
grep -rn "\b72\b|P7D|PT72H|business.?day|seven.?day" --include=*.py,*.java services/ packages/

# Per-tenant code branches
grep -rEn "tenant(_id|Id)?\s*(==|===|\.equals|in\s*\[)" --include=*.py services/ packages/

# Event publish sites
grep -rn "publish|produce|send" services/workflow-engine/enstellar_workflow/

# Decision writes
grep -rn "determination|decision|denial|deny|outcome" --include=*.py services/ packages/

# LLM seams
grep -rn "openai|anthropic|bedrock|AsyncAnthropic|client.messages" --include=*.py services/ packages/

# PHI logging risk
grep -rn "logger.(info|debug|warn|error).*case_data|.*member|.*bundle|.*payload" --include=*.py services/

# Secrets check
grep -rn "api_key\s*=\s*['\"]|ANTHROPIC_API_KEY\s*=" --include=*.py services/

# Header-based tenant
grep -rn "Header.*X-Tenant-Id|Header.*tenant_id" --include=*.py services/

# Model version tracking
grep -rn "model_name|prompt_version|provenance" --include=*.py services/agent-layer/

# RLS check
grep -n "ROW LEVEL|POLICY|RLS" services/workflow-engine/migrations/ -r

# Human signoffs
grep -rn "human_signoffs|signoff" services/ --include=*.py,*.sql

# VKAS check
grep -rn "vkas|artifact_version|artifact_store|policy_version" --include=*.py services/ packages/

# OPA check
grep -rn "opa|Open Policy Agent" services/ packages/
```
