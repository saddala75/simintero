# Platform Alignment Audit — Divergence Register

**Run date:** 2026-06-10 | **Branch:** main | **HEAD:** `84b3315`  
**Priority order:** PERMANENT → S1 → COMPOUNDING → HIGH → MEDIUM → LOW  
**Disposition / Owner columns:** □ pending review — to be filled by human reviewers.  
**Abbreviations:** DDD = Simintero Detailed Design Doc; SAD = Architecture Decision Record; CCEM = Canonical Case & Evidence Model; C-1/C-3 = Interface Contract.

---

## Priority: PERMANENT

| ID | Source of truth | Built reality | Description | Severity | Irreversibility | Disposition | Owner | Target phase | ADR needed? |
|---|---|---|---|---|---|---|---|---|---|
| DIV-001 | C-1 §3 (normative pinning rule): every response includes `pins[]` (full array of governing artifacts); consumers MUST persist on aggregate; re-evaluation MUST send stored pins | `digicore/models.py:46–50`: `DecisionResponse` has only `structured_trace: StructuredTrace` (single artifact+version). `canonical_model/case.py:38–58`: no `pins[]` field. `auto_determination.py:139–153`: Decision constructed with `rule_artifact_id` + `rule_version` only | Decisions lack the full governing artifact pin set required by C-1. Appeals cannot reconstruct the exact rule versions used. Any in-flight re-evaluation or appeal for already-recorded decisions has no stored pins to send | S1 | **PERMANENT**: historical decisions cannot be retroactively pinned without access to Digicore's version resolver at their `decided_at` timestamp — a capability not guaranteed to exist | □ pending review | □ | P1 | Yes — defines Case.pins shape + Decision pinning model vs CCEM §4.1 |

---

## Priority: S1

| ID | Source of truth | Built reality | Description | Severity | Irreversibility | Disposition | Owner | Target phase | ADR needed? |
|---|---|---|---|---|---|---|---|---|---|
| DIV-002 | DDD §3.1: tenant context sourced from verified JWT claim; all service principals must present token; platform rejects any call without valid tenant context | `api/worklist_router.py:24`: `tenant_id: str = Header(..., alias="X-Tenant-Id")` — no JWT. `queues/router.py:13`: same pattern. No verification wrapping either endpoint | Two production endpoints accept tenant_id from an unverified HTTP header. Any caller (including other tenants sharing the network) can forge `X-Tenant-Id` and read another tenant's worklist or queue statistics. This is a cross-tenant data-read vulnerability | S1 | Low: fix is a 2-line Depends() swap per endpoint | □ pending review | □ | P0 (immediate) | No |
| DIV-003 | DDD §11.1 / SAD ADR-9: single Model Gateway path for all inference; boundary-resolved endpoints; per-tenant kill switches; PHI minimization filter; audit log (`sim.ai.interaction`) | `model_access/anthropic_adapter.py:19`: `self._client = anthropic.AsyncAnthropic(api_key=api_key)` direct. `ollama_adapter.py`: direct HTTP. `factory.py:14–24`: factory selects adapter, no gateway intercept. No boundary enforcement. No kill switches | All AI inference goes directly to provider endpoints, bypassing the Model Gateway. There is no boundary enforcement (dev/prod/enclave all use same code path), no per-tenant or per-workflow disable switch, and no centralized AI audit log. `sim.ai.interaction` events are not emitted | S1 | Medium: requires Model Gateway service or a gateway-pattern wrapper layer | □ pending review | □ | P1 | Yes — defines whether Model Gateway is a separate service or a library wrapper |

---

## Priority: COMPOUNDING

| ID | Source of truth | Built reality | Description | Severity | Irreversibility | Disposition | Owner | Target phase | ADR needed? |
|---|---|---|---|---|---|---|---|---|---|
| DIV-004 | DDD §3.3: `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation USING (tenant_id = current_setting('sim.tenant_id', true))` on every table; GUC set inside every transaction | Zero `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` statements in all 8 Alembic migrations (0001–0008) or Flyway migrations (V1–V4). `db/connection.py:14`: asyncpg pool factory with no GUC setting | No Postgres RLS anywhere. Tenant isolation is purely application-layer (WHERE predicates). A missing WHERE clause in any new code path, a DB admin connection, or a bulk data tool would read cross-tenant data with no DB-level defense. Every new table added to the codebase starts unprotected | HIGH | Low: retrofitting RLS is additive (policy + GUC); no data migration needed | □ pending review | □ | P1 | No |
| DIV-005 | DDD §9.2: Temporal-backed workflow engine; VKAS-pinned `workflow_def` artifact (YAML: states, transitions, guards, routing); per-case pin at case creation; generic CEL guard interpreter | `canonical_model/case.py:18–29`: 11 states hardcoded as Python StrEnum. `engine/transitions.py`: transitions in Python functions. `engine/auto_determination.py:46–58`: hardcoded branches. `cases/repository.py:39`: `workflow_def_version = "v1"` literal. Zero Temporal dependency in codebase | Entire workflow engine — states, transitions, guards — is embedded in Python code. No metadata-driven interpretation, no per-case workflow version pin, no Temporal backing. Changing workflow behavior for any tenant requires a code deploy. The "v1" literal on new cases means in-flight case version migration is structurally impossible | HIGH | High: extracting to VKAS + Temporal is an XL rebuild | □ pending review | □ | P2 | Yes — ADR on Temporal adoption vs lightweight YAML interpreter; VKAS timing |
| DIV-006 | DDD §9.3: `clock_profile` VKAS artifact (ISO8601 duration limits, business calendar, pause_on/resume_on events); per-case clock_profile pin; business-day arithmetic via tenant business_calendar artifact | `clocks/model.py:17–22`: `CLOCK_RULES = {("expedited","decision"): 3, ("standard","decision"): 7, ("concurrent","decision"): 1}` hardcoded. `clocks/service.py:63`: `deadline = now + timedelta(days=definition.duration_calendar_days)` — calendar-day only, no business calendar | Clock limits hardcoded in Python; any regulatory change (CMS rule update, state mandate) requires a code deploy and redeploy of all workflow-engine instances. Business-day calendar not implemented — deadlines may be off for weekends/holidays. No clock_profile pin on cases | HIGH | Medium: extracting to JSON artifact + business-day lib is M effort; clock arithmetic is correct | □ pending review | □ | P1 | No |
| DIV-007 | C-3 §2: `EventEnvelope` normative fields include `schema_ref` (e.g., `sim.case.state-changed/v1`), `causation_id`, `trace_ref`. C-3 §3: topics prefixed `sim.` with per-event-type schema version suffix | `event-contracts/enstellar_events/envelope.py:12–30`: envelope has `event_id, tenant_id, case_id, correlation_id, type, occurred_at, actor, payload, schema_version` — missing `schema_ref`, `causation_id`, `trace_ref`. `topics.py`: uses flat `case.state.transitioned` instead of `sim.case.lifecycle` with schema_ref routing. Qualitron-critical `sim.case.determination-recorded/v1` event: `decision.recorded` exists but lacks `decided_by.type`, `auto_path`, `rationale_ref`, `rules_trace_ref`, `pins[]` | Event contract diverges from C-3 on envelope fields and topic naming. Qualitron depends on `causation_id` to chain evidence to determinations, `trace_ref` for rule provenance, and the `sim.case.determination-recorded/v1` schema for gap measurement. Building Qualitron against the current contract will lock in an incompatible naming structure | HIGH | Medium: envelope field addition is additive; topic rename requires all consumers to update subscriptions | □ pending review | □ | P1 | No |

---

## Priority: HIGH

| ID | Source of truth | Built reality | Description | Severity | Irreversibility | Disposition | Owner | Target phase | ADR needed? |
|---|---|---|---|---|---|---|---|---|---|
| DIV-008 | CCEM §4.3 (normative): `Determination { decided_by{type:human, id, role}, auto_path: bool, rationale_ref, rules_trace_ref, advisory_analysis_ref?, pins[], decided_at }`. Adverse outcome ⇒ `decided_by.type=human` ∧ `auto_path=false` ∧ `rules_trace_ref≠null` ∧ `rationale_ref≠null` (three enforcement layers) | `canonical_model/decision.py`: `Decision` has `rule_artifact_id, rule_version, human_signoff_required, human_signoff_actor, human_signoff_at, auto_approved`. Missing: `decided_by.type`, `rationale_ref`, `rules_trace_ref`, `advisory_analysis_ref`, `pins[]`. No DB CHECK enforces `adverse ⇒ rationale_ref IS NOT NULL` | CCEM §4.3 Determination invariant partially enforced: guard blocks adverse transitions without signoff, but stored Decision schema lacks 5 required CCEM fields. A determination record without `rules_trace_ref` and `rationale_ref` is not compliant with CCEM and cannot serve as the evidence root for an appeal. The `decided_by.type` field is critical for the event validator in C-3's `determination-recorded/v1` | HIGH | Low: schema fields are additive; existing rows will have nulls (which is the problem) | □ pending review | □ | P1 | No |
| DIV-009 | DDD §7.3 / SAD §7.3: access authorization on document retrieval; object-level policy per tenant; `sim.audit.access` event on every PHI-bearing read | `normalization/storage.py`: `MinioStore` has `upload()` and `_ensure_bucket()` only — no retrieval method with authz. `grep` for retrieval authz across all Python files: zero hits. MinIO bucket policy: not configured in any migration or infra script | No authorization check on document retrieval. Any code path that receives a MinIO object key can retrieve any tenant's documents without a tenant/principal check. No `sim.audit.access` event emitted on document read | HIGH | Low: access check + audit event can be added as a wrapper | □ pending review | □ | P1 | No |
| DIV-010 | SAD §7.2: immutable, append-only audit store with hash-chaining for tamper evidence; `sim.audit.access` events for PHI reads; retention/legal-hold per tenant; evidence-package exporter | Zero dedicated audit schema or service. `workflow_events` is an informal transition log (mutable at DB level — no immutability trigger). No hash-chaining. No PHI read auditing. No evidence-package exporter | Audit capability is ABSENT. Compliance reporting, appeal evidence packages, and PHI access auditing all require manual DB extracts. Appeals risk failing without a defensible, tamper-evident evidence chain | HIGH | Low: `workflow_events` data is available; the audit service is what's absent | □ pending review | □ | P1 | No |
| DIV-011 | DDD §5: `vkas.artifact` table (canonical_url, version, state: draft→approved→active→deprecated), approval gates, `sim.artifact.activated/v1` event; consumers pin by canonical_url+version | `notification_templates.version INT` with no lifecycle. `workflow_def_version = "v1"` literal. No VKAS schema, no VKAS API, no VKAS service anywhere in the codebase. Clock limits, workflow defs, notification templates, and prompts all change only via code deploy | Artifact versioning is ABSENT. All governed artifacts (clock limits, workflow defs, coverage policies, prompts) are embedded in code or use ad-hoc integer versions with no lifecycle management. Regulatory and clinical changes require code deploys instead of governed artifact promotions | HIGH | Low: no data loss; existing data maps to VKAS concepts once schema exists | □ pending review | □ | P2 | Yes — ADR on VKAS scope (clock profiles only, or all governed artifacts including prompts) |

---

## Priority: MEDIUM

| ID | Source of truth | Built reality | Description | Severity | Irreversibility | Disposition | Owner | Target phase | ADR needed? |
|---|---|---|---|---|---|---|---|---|---|
| DIV-012 | DDD §4.4: case event sourcing with optimistic concurrency (`seq = last + 1` conflict detection); mutable projection rebuildable from events | `workflow_instances.case_json` (JSONB) overwritten on every state transition at `cases/repository.py:85–106`. No `seq` column. No concurrency conflict detection. Decisions appended to `case_json` via `||` — persisted, but source-of-truth is the JSONB blob, not an independent event stream | `workflow_instances.case_json` is a mutable snapshot, not a pure event-sourced projection. Last-write-wins update semantics — concurrent transitions could corrupt case state. Rebuilding case state from `workflow_events` alone is incomplete (decisions require reading `case_json`) | MEDIUM | Low: adding `seq` and emitting decision events is additive | □ pending review | □ | P2 | No |
| DIV-013 | CCEM §7 Trace schema: `{trace_id, tenant, subject{type,ref}, governing_artifacts[], inputs[], logic_path[]?, actors[], outcome}`. C-1 §5: every 200 from evaluate has a trace_ref resolving to this profile | `integration-connectors/digicore/models.py:37–45`: `StructuredTrace { artifact: str, version: str, source: str, logic_branch: str }` — only 4 fields. No `governing_artifacts[]` (array), no `inputs[]` (used/unused), no `logic_path[]`, no `actors[]`. `Decision.rule_artifact_id` links to this partial trace only | StructuredTrace diverges from the CCEM §7 normative Trace schema. A reviewer cannot trace which inputs were used in an evaluation, which inputs were unused (DIG `unused_inputs`), or who (human/service/model) participated. Appeals reconstruction is incomplete | MEDIUM | Low: StructuredTrace extension is additive; existing data stays as-is | □ pending review | □ | P1 | No |
| DIV-014 | DDD §4.3 outbox: relay atomically marks published events in the same transaction as the Kafka publish | `outbox/relay.py:36–63`: step 1 SELECT, step 2 `producer.send()` (Kafka), step 3 `UPDATE outbox SET published_at = now()` — steps 2 and 3 are in **separate connections**. If the relay process crashes after Kafka publish but before the DB mark, the event is re-delivered on next relay run (at-least-once, correct per C-3). If the DB mark succeeds but Kafka publish returns a transient error after acknowledgement, the event is marked published but not delivered | At-least-once delivery holds; the relay is not atomic. A relay crash window (publish success + mark failure) results in duplicate events — consumers must be idempotent (C-3 §2: "consumers MUST be idempotent on event_id"). Consumers that are not idempotent on `event_id` will process duplicates. The inverse (publish fails silently) is prevented by the separate transaction approach | MEDIUM | Low: add Kafka transactional producer + atomic mark, or accept at-least-once and enforce consumer idempotency | □ pending review | □ | P2 | No |
| DIV-015 | C-3 §2 principle 2 / DDD §4.4: cases reconstructable from events alone (no side-channel reads); Qualitron replay from events + fabric snapshot must work | `workflow_events` captures state transitions. Decisions stored in `workflow_instances.case_json['decisions']` JSONB — not in `workflow_events`. Rebuilding a complete case (state + decisions + RFI history) requires reading both `workflow_events` (for transitions) and `workflow_instances.case_json` (for decision content and criteria) | Case reconstruction from events alone is incomplete. `sim.case.determination-recorded/v1` should carry the full decision payload, but `decision.recorded` in the outbox does not include `rule_artifact_id, criteria_branch, pins[]`. Qualitron replay from events would miss decision content | MEDIUM | Low: emit richer payloads in outbox events; decisions in JSONB remain accessible | □ pending review | □ | P1 | No |
| DIV-016 | DDD §11.1: prompt/model version logging to audit; `interaction.model_binding@version` + `interaction.prompt@version` required per C-2 §3 (INV-4). `sim.ai.interaction.analysis-completed/v1` event emitted per interaction | `agent-layer/enstellar_agents/models.py`: `AgentOutput.provenance: dict[str, Any] = {model_name, input_hash, timestamp}` — no `prompt_version`. System prompts are Python string literals in `agents/completeness.py:23–50`, `agents/triage.py:23–50`. No `sim.ai.interaction` outbox events emitted from agent-layer | AI interactions cannot be fully reproduced or audited: `model_name` recorded but `prompt_version` is absent (prompts change with code deploys). No `sim.ai.interaction` event stream — AI-ops dashboards, override-rate monitoring, and calibration tracking are unavailable | MEDIUM | Low: adding prompt_version + outbox events is purely additive | □ pending review | □ | P1 | No |

---

## Priority: LOW

| ID | Source of truth | Built reality | Description | Severity | Irreversibility | Disposition | Owner | Target phase | ADR needed? |
|---|---|---|---|---|---|---|---|---|---|
| DIV-017 | CCEM §6.3: `contracts/fhir/required-elements.json` enumerates fields that MUST survive round-trip; CI property tests assert FHIR→CCEM→FHIR identity on mapped fields; a mapping without a passing round-trip suite cannot merge | `contracts/fhir/required-elements.json`: file NOT found in repo (UNKNOWN-2). `packages/canonical-model/tests/python/test_roundtrip.py` exists but only Python↔TS round-trip verified. No FHIR↔canonical property test found | Required-elements manifest file is absent or not yet committed. FHIR↔canonical round-trip correctness is unverified. PAS submission correctness (Claim → CCEM → ClaimResponse) cannot be CI-asserted. This is a Phase 0 exit criterion per CCEM §9 | MEDIUM | Low: manifest + tests are additive; no data loss | □ pending review | □ | P1 | No |
| DIV-018 | DDD §11.1 / SAD ADR-9: boundary-resolved endpoints; FedRAMP boundary must not reach external inference endpoints | `model_access/factory.py:14–24`: adapter selection by `ENSTELLAR_MODEL_PROVIDER` env var with no boundary constraint. `AnthropicAdapter` + `OllamaAdapter` available regardless of deployment context | No deployment-boundary enforcement on model adapter selection. A FedRAMP-boundary deployment could accidentally configure `ENSTELLAR_MODEL_PROVIDER=anthropic` and call an external endpoint, violating boundary integrity. INV-6 (C-2 §3) specifies gateway-enforced boundary resolution | LOW | Low: boundary config is a factory-level policy check | □ pending review | □ | P2 | No |
| DIV-019 | DDD §3.1: all developer tooling must use mock identity tokens; no hardcoded tenant bypass | `portal-bff/enstellar_bff/auth.py:33–40`: `dev_bypass_auth: bool = False` parameter on `require_reviewer`; when True, returns a hardcoded `TenantContext("dev-tenant", ...)` without JWT validation. No guard preventing this flag in production config | dev_bypass_auth is a code-level production risk if accidentally enabled (e.g., via environment variable injection). No runtime assertion prevents it in production. The pattern may propagate to new endpoints as the BFF grows | LOW | Low: replacing with mock Keycloak token is a test-tooling change | □ pending review | □ | P2 | No |

---

## Register Summary

| Priority bucket | Count | DIV IDs |
|---|---|---|
| PERMANENT | 1 | DIV-001 |
| S1 | 2 | DIV-002, DIV-003 |
| COMPOUNDING | 4 | DIV-004, DIV-005, DIV-006, DIV-007 |
| HIGH | 4 | DIV-008, DIV-009, DIV-010, DIV-011 |
| MEDIUM | 5 | DIV-012, DIV-013, DIV-014, DIV-015, DIV-016 |
| LOW | 3 | DIV-017, DIV-018, DIV-019 |
| **TOTAL** | **19** | |

---

## UNKNOWN Items Requiring Human Input

| ID | Description | Next step |
|---|---|---|
| UNKNOWN-1 | HAPI JPA multi-tenant isolation: `TenantContextFilter.java` sets tenant_id, but whether HAPI JPA queries are actually scoped (HAPI partition tags or RLS) is not verified from code alone | Read HAPI Spring config + run cross-tenant FHIR query test |
| UNKNOWN-2 | `contracts/fhir/required-elements.json`: referenced by CCEM §6.3 as the round-trip proof manifest; file NOT found in repo | Confirm with platform team whether file was never created (Phase 0 gap) or lives outside this repo |
| UNKNOWN-3 | Full C-3 event coverage: 15 C-3 event types vs ~8 built; exact count unverified for non-case-lifecycle topics | Run `grep -rn "publish\|produce" services/ --include=*.py` and map each to C-3 schema_ref |
| UNKNOWN-4 | OPA policy enforcement: DDD §7.2 specifies OPA for authz; no OPA import or config found in codebase (`grep -rn "opa" services/ packages/` → 0 hits). Whether OPA is intended for a later phase or a gap | Confirm with platform team |
| UNKNOWN-5 | Kafka consumer idempotency: `processed_events` dedup table exists; not all consumers verified to use it. Without idempotency, DIV-014 (at-least-once relay) becomes a data-integrity risk | Read each consumer module and confirm `event_id` dedup |

---

## Suggested Re-scan Targets (post-retrofit)

After remediating DIV-001, DIV-002, DIV-007, DIV-008, re-run Parts B+C only:

```
/platform-audit-rescan
  --invariants T-4,D-2,E-1,D-1
  --capabilities 1,3,8
  --scope services/workflow-engine services/integration-connectors packages/event-contracts packages/canonical-model
```

After retrofitting RLS (DIV-004), re-run:

```
/platform-audit-rescan
  --invariants T-1,T-2
  --capabilities 2
  --scope services/workflow-engine/migrations services/workflow-engine/enstellar_workflow/db
```
