# Platform Alignment Audit — Capability Map

**Run date:** 2026-06-10 | **Branch:** main | **HEAD:** `84b3315`  
**Reference documents:** CCEM v1.0.0-draft, C-1 v1.0.0-draft, C-2 v1.0.0-draft, C-3 v1.0.0-draft, DDD, SAD  
**Auditor:** Claude Code (claude-sonnet-4-6)  

---

## Executive Summary

**Capability classes:** CONFORMANT: 0 / EXTRACTABLE: 3 / EMBEDDED: 6 / ABSENT: 3  
**S1 divergences:** 2 (T-4 unverified tenant source; A-1 direct LLM calls bypass Model Gateway)  
**PERMANENT divergences:** 1 (D-2: historical decisions missing C-1 pins[] — cannot be retroactively pinned)  
**COMPOUNDING divergences:** 4 (T-2 no RLS, W-1 code-embedded workflow engine, W-3 hardcoded clocks, E-1 missing C-3 envelope/topic fields)  

**Three retrofits to start Monday:**
1. **T-4 / S1 — Unverified tenant header** (`worklist_router.py:24`, `queues/router.py:13`): Replace `Header("X-Tenant-Id")` with the existing `require_auth` dependency. Two endpoints, one afternoon, immediately closes a cross-tenant data-read vector.
2. **D-2 / PERMANENT — Digicore pins[] capture** (`digicore/models.py`, `auto_determination.py:139-153`): Add `pins[]` to `DecisionRequest`/`DecisionResponse` models and the `Case` schema now; existing rows are already lost but new decisions will be compliant from this point forward.
3. **E-1 / COMPOUNDING — Event envelope + topic alignment** (`event-contracts/enstellar_events/envelope.py`, `topics.py`): Add `schema_ref`, `causation_id`, `trace_ref` fields and rename topics to match C-3 (`sim.case.lifecycle`, `/v1` suffix). Consumers (future Qualitron, Audit) depend on this contract being stable.

**Biggest duplication risk for the next module build (Qualitron):**  
Qualitron's entire integration model depends on C-3 events from Enstellar. The current topics (`case.state.transitioned`, `decision.recorded`) do not match C-3 (`sim.case.lifecycle`, `sim.case.determination-recorded/v1`). The envelope lacks `causation_id` and `trace_ref` — two fields Qualitron's gap engine needs to chain evidence to determinations. If Qualitron starts building against current topics, it will lock in a naming contract that diverges from the platform spec, creating a migration cost on both sides later.

---

## Part A — Capability Classification Table

| # | Capability | Class | Evidence | Interface quality (0–3) | Domain leak points (worst 3) | Invariant violations | Disposition | Extraction cost | Blocks |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Tenant context & propagation | EXTRACTABLE | `packages/authz/enstellar_authz/dependencies.py:43–65`; `worklist_router.py:24`; `queues/router.py:13`; `portal-bff/auth.py:33` | 2 — clean JWT lib exists; 2 endpoints bypass it | `worklist_router.py:24` (header), `queues/router.py:13` (header), `portal-bff/auth.py:33` (dev_bypass) | T-4 FAIL | CONFORM | S | None |
| 2 | Data isolation (RLS) | EMBEDDED | All 8 tables: `tenant_id NOT NULL` + CHECK; zero `ENABLE ROW LEVEL SECURITY` statements; `db/connection.py:14` no GUC | 1 — implicit app-layer predicates | `cases/repository.py:52` (WHERE only), `worklist_router.py:40–72` (JOIN query), `integration-connectors/digicore/client.py` (no GUC forwarded) | T-2 FAIL | CONFORM | M | Qualitron RLS boundary |
| 3 | Eventing & outbox | EXTRACTABLE | `outbox/publisher.py:8–35`; `outbox/relay.py:36–63`; `event-contracts/envelope.py`; `topics.py` | 2 — transactional outbox correct; envelope missing 3 fields; topics miss C-3 naming | `topics.py:1–30` (flat names), `envelope.py:12–30` (missing fields), `relay.py:52` (non-atomic mark) | E-1 PARTIAL, E-2 PARTIAL | CONFORM | M | C-3 consumers (Qualitron, Audit) |
| 4 | Case event sourcing / history | EMBEDDED | `workflow_events` table (`migration 0002:31–48`); mutable `workflow_instances.case_json`; `cases/repository.py:85–106` | 1 — events exist; projection mutable; no rebuild tooling | `decision_recorder.py:50–65` (JSONB append to mutable case_json), `cases/repository.py:85–106` (case_json UPDATE), `cases/service.py:60` (snapshot in workflow_instances) | E-3 PARTIAL, D-3 PARTIAL | CONFORM | M | Audit rebuild |
| 5 | Audit trail | ABSENT | No dedicated audit schema or service; `workflow_events` used informally; no hash-chaining; no PHI access auditing | 0 — none | n/a (absent) | none direct | ADOPT-NEW | L | Compliance, Appeals, Qualitron |
| 6 | Workflow engine | EMBEDDED | `canonical_model/case.py:18–29` (StrEnum states); `engine/transitions.py` (Python code transitions); `cases/repository.py:39` (`"v1"` hardcoded) | 1 — TransitionEngine class exists but not metadata-driven | `case.py:18–29` (hardcoded states), `engine/auto_determination.py:46–58` (hardcoded branches), `cases/repository.py:39` (hardcoded version) | W-1 FAIL | CONFORM (near-term) / REBUILD (long-term) | XL | Per-tenant workflow config, Appeals |
| 7 | Regulatory clocks & calendars | EMBEDDED | `clocks/model.py:17–22` (CLOCK_RULES dict hardcoded); `clocks/service.py:47–63` (calendar-day timedelta) | 1 — ClockService API correct; limits hardcoded | `clocks/model.py:17–22` (hardcoded dict), `clocks/service.py:63` (calendar-day only), no VKAS clock_profile ref anywhere | W-3 FAIL | CONFORM | M | Regulatory change response |
| 8 | Rules/decision logic + versioning seam | EXTRACTABLE | `integration-connectors/digicore/client.py` (single seam); `digicore/models.py:37–45` (StructuredTrace); `auto_determination.py:139–153` (Decision construction) | 2 — clean DigiCoreClient seam; single artifact/version captured; pins[] missing | `auto_determination.py:139–153` (Decision with 1 pin only), `digicore/models.py:46–50` (no pins[] in response), `canonical_model/case.py:38–58` (no pins field) | D-2 FAIL (PERMANENT) | CONFORM | M | Appeals, Audit, Re-evaluation |
| 9 | Document/attachment handling | EMBEDDED | `normalization/storage.py:33–62` (MinioStore); `MinioRawBundleStore.java`; no retrieval authz found | 1 — raw storage works; no access governance | `normalization/storage.py:47` (no authz check), `normalization/storage.py:33` (no content-hash), no retrieval layer | P-3 FAIL | CONFORM | L | Document access auditing |
| 10 | Task / worklist & notification | EMBEDDED | `api/worklist_router.py` (PA-specific query on workflow_instances); `comms/service.py:26–97` (NotificationService); `notification_templates` table | 1 — PA worklist embedded in workflow_instances; no generic Task shape | `worklist_router.py:40–72` (direct workflow_instances JOIN), `comms/service.py` (embedded in workflow-engine), `notification_templates` (version int, no lifecycle) | none direct | CONFORM (near-term) / PROMOTE (long-term) | L | Qualitron task creation |
| 11 | Artifact versioning (proto-VKAS) | ABSENT | `notification_templates.version INT`; `workflow_def_version = "v1"` hardcoded; no VKAS schema or service | 0 — none | n/a (absent) | none direct | ADOPT-NEW | XL | Per-tenant policy config, clock changes, prompt versioning |
| 12 | AI/LLM access (proto–Model Gateway) | EMBEDDED | `anthropic_adapter.py:19` (direct client); `ModelAdapter` base class; `guardrails/engine.py:30–44` (guardrail check) | 2 — clean ModelAdapter seam; no gateway; no boundary enforcement; no prompt versioning | `anthropic_adapter.py:19` (direct instantiation), `model_access/factory.py:14–24` (adapter factory, no gateway), `agents/models.py` (provenance: no prompt_version) | A-1 FAIL, A-2 PARTIAL | CONFORM | M | Multi-boundary deployment, AI governance |

---

## Part A — Per-Capability Detail

### 1. Tenant Context & Propagation — EXTRACTABLE

**What was built:**  
`packages/authz` provides a correct JWT-based tenant context: `require_auth` extracts and validates `tenant_id` from the JWT, rejects blank values, sets `TenantContext` in a ContextVar. All Python services except two use this path. Java (interop) has `TenantContextFilter.java` (`@Order(10)`) that extracts from the Spring Security principal — also correct and fail-closed.

**Gaps vs DDD §3.1:**  
Two FastAPI routers accept `X-Tenant-Id` as a plain header without any JWT verification (`worklist_router.py:24`, `queues/router.py:13`). Any caller can forge this header and read another tenant's worklist or queue stats. Additionally, `portal-bff/auth.py:33` has a `dev_bypass_auth` flag that returns a hardcoded tenant without authentication — T-4-adjacent risk if `dev_bypass_auth` were accidentally enabled in production.

**Extraction path:**
1. Replace `Header("X-Tenant-Id")` with `auth: TenantContext = Depends(require_auth)` in both routers.
2. Remove `dev_bypass_auth` flag; use a mock Keycloak token instead.
3. Add integration test: unauthenticated request to `/worklist` must return 401.

**Cost:** S (2–4 hours)

---

### 2. Data Isolation (RLS) — EMBEDDED

**What was built:**  
All 8+ tables have `tenant_id NOT NULL` with CHECK constraints. All application-level queries include `WHERE tenant_id = $N` predicates. This provides *de facto* isolation as long as all code paths are audited.

**Gaps vs DDD §3.3:**  
Zero Postgres RLS policies exist in any migration. The connection pool (`db/connection.py:14`) does not set the `sim.tenant_id` GUC that DDD §3.3 specifies (`SET LOCAL sim.tenant_id = $1`). A DB admin or a new code path that omits the WHERE clause would read cross-tenant data with no DB-layer protection.

**Extraction path:**
1. Add `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;` + `CREATE POLICY tenant_isolation USING (tenant_id = current_setting('sim.tenant_id', true))` in a new migration for all 8 tables.
2. In `db/connection.py`, add `await conn.execute("SET LOCAL sim.tenant_id = $1", tenant_id)` after acquiring a connection.
3. Add a CI test: connect as superuser bypassing app layer, attempt cross-tenant SELECT — must return 0 rows.
4. Verify HAPI JPA tenant isolation separately (HAPI partition configuration).

**Cost:** M (1–2 days: migrations + pool change + test harness)

---

### 3. Eventing & Outbox — EXTRACTABLE

**What was built:**  
Transactional outbox pattern correctly implemented: `OutboxPublisher.publish()` inserts within the caller's transaction; `OutboxRelay` SELECT → Kafka publish → mark (separate transaction, at-least-once). Kafka relay covers: case lifecycle, clock, RFI, decision, notification, and agent-assist events.

**Gaps vs C-3 §2:**  
Event envelope missing: `schema_ref` (e.g., `sim.case.state-changed/v1`), `causation_id`, `trace_ref`. Topic naming: `case.state.transitioned` instead of `sim.case.lifecycle` (topic) with `schema_ref: sim.case.state-changed/v1`. Missing C-3 event types: `sim.evidence.*`, `sim.task.*`, `sim.artifact.*`, `sim.ai.interaction`, `sim.audit.access`, `sim.tenant.admin`.

**Extraction path:**
1. Add `schema_ref: str`, `causation_id: str | None`, `trace_ref: str | None` to `EventEnvelope`.
2. Rename `topics.py` constants to match C-3 topic taxonomy; wire `schema_ref` at each publish site.
3. Implement missing event types as stub schemas; wire the determination-recorded event with `pins[]` and `trace_ref`.
4. Add schema-registry integration (schema validation on publish).

**Cost:** M (2–3 days: envelope + topics + key event types)

---

### 4. Case Event Sourcing / History — EMBEDDED

**What was built:**  
`workflow_events` table is append-only (no DELETE/UPDATE trigger but no DB-level guarantee). Transitions write one row per state change with `from_state`, `to_state`, `actor_id`, `actor_type`, and `payload` JSONB. Decisions are appended to `workflow_instances.case_json['decisions']` via the `||` operator. `get_events()` returns all rows ordered by `id ASC`.

**Gaps vs DDD §4.4:**  
`workflow_instances.case_json` is mutable (overwritten on each status UPDATE), making it a snapshot, not an event-sourced projection. There is no optimistic concurrency sequence number. The decision array is in `case_json`, not in `workflow_events.payload` as an independent event stream — reconstruction requires reading both tables. DDD §4.4 specifies `seq = last+1` conflict detection.

**Extraction path:**
1. Add `seq INT NOT NULL DEFAULT 0` to `workflow_instances`; include in every UPDATE WHERE clause.
2. Emit a `case.decision.recorded` `workflow_events` row from `DecisionRecorder` alongside the `case_json` append.
3. Rebuild projection from `workflow_events` as the canonical source; validate against `case_json` in a consistency check script.
4. Long-term: migrate `case_json` to be a pure cached projection, source of truth = events.

**Cost:** M (1–2 days to add seq + decision events; L for full event-source migration)

---

### 5. Audit Trail — ABSENT

**What was built:**  
`workflow_events` records state transitions informally. `human_signoffs` records sign-off acts. `notification_log` records notification dispatches. `case_suggestions` logs AI outputs. No dedicated audit service, no hash-chaining, no tamper-evidence, no PHI-access auditing.

**Gaps vs SAD §7.2:**  
SAD specifies: immutable append-only store with hash-chaining, retention/legal-hold policies per tenant, evidence-package exporter. None of these exist. C-3 specifies `sim.audit.access` topic — not implemented. Without audit trail, the appeals evidence-package cannot be assembled, and compliance reporting requires full DB dumps.

**Extraction path (ADOPT-NEW):**
1. Create `audit` schema with `audit_event` table: `{id, tenant_id, occurred_at, actor_id, actor_type, action, subject_ref, payload_hash, prev_hash}`.
2. Consume all `workflow_events` + `human_signoffs` writes via a trigger or outbox consumer.
3. Add `sim.audit.access` events on document retrieval and PHI read paths.
4. Add retention policy per tenant (configurable via VKAS when VKAS exists).
5. Build evidence-package exporter: transitive closure from `determination_id` → trace → artifacts.

**Cost:** L (3–5 days for service skeleton + hash chain + basic exporter)

---

### 6. Workflow Engine — EMBEDDED

**What was built:**  
A `TransitionEngine` class orchestrates case state changes with an adverse-transition guard. `AutoDeterminator` is structurally limited to `approved`/`clinical_review`. Guards are Python code, transitions are Python functions, states are a Python StrEnum in the canonical model. Structurally sound for the current PA-only workflow.

**Gaps vs DDD §9.2:**  
DDD specifies: VKAS-pinned `workflow_def` artifact (YAML with states/transitions/guards/routing); Temporal backing; per-case `workflow_def_version` pin; generic CEL guard interpreter. None of these exist. `workflow_def_version = "v1"` is a hardcoded string literal. No Temporal dependency anywhere in the codebase.

**Extraction path:**
1. Short-term CONFORM: wrap the current Python engine behind a `WorkflowEnginePort` interface with the DDD operation signatures.
2. Define the PA workflow as a `workflow_def` YAML artifact (even if loaded from disk, not VKAS).
3. Capture `workflow_def_pin` on case creation and in the outbox event.
4. Long-term REBUILD: introduce Temporal, implement the YAML interpreter, migrate PA workflow to first YAML def.

**Cost:** XL (Temporal setup + YAML interpreter + migration: 2–4 weeks)

---

### 7. Regulatory Clocks & Calendars — EMBEDDED

**What was built:**  
`ClockService` has correct pause/resume/breach arithmetic. Clocks are persisted, tenant-scoped, and emitted via the outbox. The `ClockDefinition.for_case()` factory is the single lookup point.

**Gaps vs DDD §9.3:**  
`CLOCK_RULES = {("expedited","decision"): 3, ("standard","decision"): 7, ("concurrent","decision"): 1}` is hardcoded at `clocks/model.py:17–22`. No `clock_profile` VKAS artifact. No business-day calendar (pure `timedelta(days=N)` at `clocks/service.py:63`). No composition of multiple profiles. Any regulatory change (CMS rule, state mandate) requires a code deploy.

**Extraction path:**
1. Define a `clock_profile` JSON schema matching DDD §9.3 (duration_limit, urgency_modifier, business_calendar ref, pause_on/resume_on events).
2. Load from a versioned artifact file (initially from disk; later from VKAS).
3. Implement business-day calendar using tenant `business_calendar` artifact (initially a fixed US federal holiday list).
4. Pin `clock_profile_version` on each `Clock` row.
5. Emit `clock_profile_pins` in `sim.case.created/v1` event.

**Cost:** M (2–3 days for schema + loader + business-day lib; L if calendar customization is per-tenant)

---

### 8. Rules / Decision Logic + Versioning Seam — EXTRACTABLE

**What was built:**  
Clean `DigiCoreClient.evaluate_request()` seam. `StructuredTrace` captures the governing artifact URL + version + logic branch. `Decision.rule_artifact_id` and `rule_version` persisted. `auto_determination.py` uses only this seam — no inline rule evaluation.

**Gaps vs C-1 §3:**  
C-1 §3 (normative pinning rule): response includes `pins[]` — the full array of ALL governing artifacts (coverage rule + CQL libraries + value sets + supplementary rules). Built: only a single `StructuredTrace.artifact` + `version` — one artifact instead of N. `DecisionRequest` sends no `pins` to Digicore. `Case` schema has no `pins[]` field. Re-evaluation for appeal sending stored pins is structurally impossible.

**Extraction path:**
1. Add `pins: list[Pin]` to `DecisionResponse`/`DecisionRequest` Pydantic models (`digicore/models.py`).
2. Add `pins: list[Pin]` to `Case` CCEM model and migration (new `case_pins` column or table).
3. In `auto_determination.py:139–153`, persist all returned pins on the case and Decision.
4. Wire `pins[]` into `sim.case.determination-recorded/v1` event payload.
5. Note: historical decisions (D-2) cannot be retroactively pinned — document as PERMANENT loss in the register.

**Cost:** M (1–2 days for schema + migration; mock Digicore must return pins[] in tests)

---

### 9. Document / Attachment Handling — EMBEDDED

**What was built:**  
`MinioStore.upload()` stores raw bundles at `{bucket}/{tenant_id}/raw-bundles/{date}/{correlation_id}.json` before normalization. Tenant prefix in path provides logical separation. Both Python and Java layers have MinIO implementations.

**Gaps vs SAD §7.3:**  
No access authorization on document retrieval. No span-addressable storage. No content-hash or tamper evidence. No OCR pipeline. No retention/legal-hold. Presigned URL generation not found — access control is purely at the application layer, and even that layer is absent (no retrieval authz check found).

**Extraction path:**
1. Add `content_sha256: str` to `MinioStore.upload()` return value and `document_refs` table.
2. Add a `DocumentRepository.get(doc_id, tenant_id)` method that: (a) verifies the requester's tenant matches the document's tenant, (b) emits a `sim.audit.access` event.
3. Set MinIO bucket policy to deny direct object access without signed tokens.
4. Add retention policy field to `raw_bundles` metadata.

**Cost:** L (2–3 days for retrieval authz + audit event + content-hash; longer for full lifecycle management)

---

### 10. Task / Worklist & Notification — EMBEDDED

**What was built:**  
PA-specific worklist queries `workflow_instances` with SLA JOIN. `NotificationService` renders Jinja2-sandboxed templates with PHI stripping — a well-built component. `notification_templates` table with versioned templates and `notification_log`.

**Gaps vs CCEM §4.4 / C-3 §4.6:**  
No generic `Task` shape (`task_id`, `kind`, `subject_ref`, `queue`, `sla_ref`). CCEM §4.4 specifies one task shape for UM review, intake exceptions, governance reviews, and Qualitron outreach. C-3 §4.6 specifies `sim.task` topic. Qualitron needs to CREATE `quality_outreach` tasks and CONSUME completion events — the current design has no socket for this.

**Extraction path:**
1. Near-term CONFORM: add a `task_events` outbox event (`sim.task.created/v1`, `sim.task.completed/v1`) for PA review tasks.
2. Long-term PROMOTE: extract `TaskService` with the CCEM §4.4 generic shape; worklist router becomes a filtered view on tasks.
3. Add `sim.task` topic to C-3 compliance in `topics.py`.

**Cost:** L (generic task service is a separate microservice; near-term event wire-up is S)

---

### 11. Artifact Versioning (proto-VKAS) — ABSENT

**What was built:**  
`notification_templates.version INT` with `server_default=1`. `workflow_def_version = "v1"` hardcoded in CaseRepository. No approval/effective-dating/promotion/rollback lifecycle. No VKAS service.

**Gaps vs DDD §5:**  
DDD §5 specifies: `vkas.artifact` table (canonical_url, version, state: draft→in_review→approved→active→deprecated), `vkas.approval` workflow, VKAS API for consumers to pin, `sim.artifact.activated/v1` event. None of these exist. Clock limits, workflow definitions, prompts, and notification templates all require code deploys to change.

**Extraction path (ADOPT-NEW):**
1. Define `vkas.artifact` and `vkas.approval_gate` tables (migration).
2. Migrate `notification_templates` to use VKAS artifact references.
3. Migrate clock limits to `clock_profile` VKAS artifacts.
4. Expose VKAS API for pinning by consumers.
5. Long-term: move prompts and workflow defs to VKAS.

**Cost:** XL (platform-level service: 2–4 weeks to do correctly across all artifact types)

---

### 12. AI/LLM Access (proto–Model Gateway) — EMBEDDED

**What was built:**  
Clean `ModelAdapter` abstract base class with `complete(system_prompt, user_message) → str` and `model_name() → str`. PHI minimization applied before agent invocation (PHI-free `case_summary` in `AgentInput`). `GuardrailEngine` with 7 rules including `rule_no_autonomous_adverse` and `rule_phi_minimization`. `provenance` records `model_name + input_hash + timestamp`.

**Gaps vs DDD §11.1:**  
`AnthropicAdapter` and `OllamaAdapter` call provider APIs directly — no Model Gateway intercept. No boundary enforcement (same adapters in dev, prod, FedRAMP enclave). No per-tenant kill switches. `provenance` missing `prompt_version` — system prompts are Python string literals. AI interactions not logged to `sim.ai.interaction` topic (no outbox event on completion).

**Extraction path:**
1. Promote `ModelAdapter` factory into a `ModelGatewayClient` that: (a) resolves endpoint by deployment boundary from config, (b) enforces per-tenant entitlements (kill switch), (c) emits `sim.ai.interaction.analysis-completed/v1` to outbox.
2. Add `prompt_version: str` to `AgentOutput.provenance`; version system prompts as VKAS artifacts.
3. Add `no_train` header assertion in all adapter `complete()` calls.
4. Add boundary config: `ENSTELLAR_BOUNDARY=prod|enclave|local` → selects endpoint set.

**Cost:** M (1–2 days to promote adapter to gateway client with the governance layer)
