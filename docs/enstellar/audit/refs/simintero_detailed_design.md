# Simintero Platform — Detailed Design Document (DDD)

| | |
|---|---|
| **Document** | Simintero Detailed Design v0.1 — Draft for engineering review |
| **Parents** | `simintero_multitenant_saas_prd_v2.md` (PRD) · `simintero_architecture.md` (SAD) |
| **Audience** | Engineering (platform, module teams), SRE, security; written to be directly consumable by AI coding agents per SAD §19 |
| **Design scope** | Implementation-ready design for **Phase 0 (platform substrate)** and **Phase 1 (PA vertical slice: Enstellar + Digicore)**, plus the Revital pipeline and Model Gateway (Phase 2) at design depth. Qualitron at interface depth only (Phase 3). |

**Conventions used in this document:** SQL is PostgreSQL 15+. JSON examples are normative shapes (full JSON Schemas live in `/contracts/schemas/`). `MUST/SHOULD/MAY` per RFC 2119. Requirement IDs reference the module PRDs (e.g., `ENS-WF-1`). Every design element notes its owning team: `[PLAT]` platform, `[ENS]`, `[DIG]`, `[REV]`, `[QUA]`.

---

## 1. Design principles (operationalized)

1. **Tenant context is unforgeable and ambient.** No function signature passes `tenant_id` as a plain parameter across trust boundaries; context travels in verified tokens/headers and is bound to the DB session. Code that touches data without context fails closed.
2. **Two kinds of truth:** the *event log* (what happened — immutable) and *projections* (what is — rebuildable). Anything you can't rebuild from events + artifacts + documents is a design bug.
3. **Artifacts, not branches.** Behavior that varies by tenant/LOB/state is a VKAS artifact interpreted by an engine. If a PR adds `if (tenant == X)`, the design has failed.
4. **Contracts are compiled.** Inter-module shapes are generated from `/contracts`; hand-written DTOs for cross-module calls are forbidden.
5. **Determinism where it counts.** Rules and measures: deterministic ELM with pinned versions. LLMs: only behind the Model Gateway, only grounded, only advisory in v1.
6. **Every "why" is a Trace.** One provenance schema (§8) for rules, AI, and measures.
7. **Design for the agent.** Every component in this doc has: a spec file path, invariants, and acceptance tests — the unit of work an AI coding agent can pick up safely (§20).

## 2. Repository & code organization `[PLAT]`

Monorepo, language baseline: **TypeScript (Node 20)** for services/BFF/UI, **Java 21** where the FHIR/CQL ecosystem demands it (HAPI facade, CQL engine host), **Python 3.12** for Revital ML/eval tooling. Polyglot is constrained to these three.

```
simintero/
├── CLAUDE.md                      # root agent conventions (§20.2)
├── contracts/                     # SOURCE OF TRUTH for all cross-module shapes
│   ├── openapi/                   #   c1-digicore-runtime.yaml, c2-revital-advisory.yaml,
│   │   ...                        #   platform-*.yaml (vkas, tasks, documents, terminology)
│   ├── asyncapi/                  #   c3-event-catalog.yaml
│   ├── schemas/                   #   trace.schema.json, event-envelope.schema.json,
│   │   ...                        #   workflow-definition.schema.json, clock-profile.schema.json
│   └── fhir/                      #   profiles/, capability templates, IG pin manifest (ig-lock.json)
├── platform/
│   ├── libs/                      # tenant-context, authz-client, outbox, audit-client,
│   │   ...                        #   trace-client, fhir-mapping, testing (per language: ts/, java/, py/)
│   └── services/
│       ├── identity-bridge/       # Keycloak extensions, token enrichment
│       ├── vkas/                  # artifact lifecycle service
│       ├── provenance/
│       ├── audit/
│       ├── document/
│       ├── terminology-gw/        # thin gateway over Ontoserver/HAPI-tx
│       ├── task/
│       ├── notification/
│       ├── search-indexer/
│       ├── model-gateway/
│       └── control-plane/         # tenant registry, entitlements, provisioning, promotion
├── modules/
│   ├── enstellar/                 # intake/, case/, workflow/, clock/, comms/, appeals/, workspace-bff/
│   ├── digicore/                  # registry/, authoring/, governance/, simulation/, runtime/
│   ├── revital/                   # pipeline/, extraction/, summarizer/, mapper/, eval/
│   └── qualitron/                 # (Phase 3)
├── apps/web/                      # shell + module UIs (React, design system)
├── integration/
│   ├── fhir-facade/               # HAPI-based, Java
│   ├── x12-translator/
│   ├── cds-hooks/
│   └── connectors/                # core-admin/, idp/, vsac/, clearinghouse/
├── artifacts/                     # seed packs: workflow defs, clock profiles, sample policy pack,
│   ...                            #   synthetic tenants & Synthea-derived data
├── infra/                         # terraform/, k8s/, argocd/, cell-stamp/
├── specs/                         # spec-driven dev files, mirrors PRD req IDs (§20.1)
└── docs/adr/
```

**Dependency rules (CI-enforced via import-linting per language):**
- `modules/*` → may import `platform/libs/*` and generated contract clients only. `modules/A` importing `modules/B` source is a build failure.
- `platform/*` → never imports `modules/*`.
- Wire formats (FHIR classes, X12) appear only under `integration/` and `platform/libs/fhir-mapping`.

## 3. Tenancy, identity & context propagation `[PLAT]`

### 3.1 Token & context design
Keycloak issues OIDC tokens enriched with Simintero claims:

```json
{
  "sub": "u_8f3c…", "azp": "workspace-web",
  "sim": {
    "tenant_id": "t_acmehealth",
    "cell_id": "cell-pooled-us1-03",
    "tier": "pooled",
    "scopes": { "lob": ["MA","MEDICAID"], "region": ["TX"], "modules": ["ENS","DIG"] },
    "roles": ["um_nurse_reviewer"],
    "principal_type": "human"            // human | service | model_agent
  }
}
```

- `principal_type` is set by the identity bridge and **cannot be requested by clients**; service accounts and any future agentic principals are minted as `service`/`model_agent`. This claim is what makes the adverse-action guard structural (§9.3).
- Service-to-service: mesh mTLS + a **context propagation header** `x-sim-ctx` — a short-lived JWT minted by the receiving edge from the user token (token exchange), carrying the same `sim` block. Services MUST verify signature and MUST NOT construct `x-sim-ctx` from request bodies.

### 3.2 Context library (`platform/libs/tenant-context`)
Per-language middleware that: verifies `x-sim-ctx`; opens an async-local/ThreadLocal context; **rejects any request lacking valid context (fail closed)**; exposes `ctx()` accessor. All platform libs (DB, outbox, audit, trace, search, model-gateway clients) read `ctx()` internally — application code physically cannot forget tenancy.

### 3.3 Postgres RLS implementation
Every tenant-scoped table:

```sql
CREATE TABLE ens.case (
  case_id        UUID PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  lob            TEXT NOT NULL,
  program        TEXT, product TEXT, region TEXT,
  state          TEXT NOT NULL,            -- projection of workflow state
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ...
);
ALTER TABLE ens.case ENABLE ROW LEVEL SECURITY;
ALTER TABLE ens.case FORCE ROW LEVEL SECURITY;   -- applies to table owner too
CREATE POLICY tenant_isolation ON ens.case
  USING (tenant_id = current_setting('sim.tenant_id', true));
```

The DB pool wrapper sets `SET LOCAL sim.tenant_id = $ctx.tenant_id` inside every transaction (GUC bound to the verified context, never to request input). Services use a least-privilege role with no `BYPASSRLS`. **CI includes an RLS test harness** that, for every table in every schema, attempts cross-tenant reads/writes with mismatched GUC and fails the build on any leak (agents extend it automatically when adding tables — §20).

### 3.4 Tenant registry (control plane) — core tables

```sql
-- ctrl schema lives ONLY in the control plane DB (no PHI)
CREATE TABLE ctrl.tenant (
  tenant_id   TEXT PRIMARY KEY,            -- slug, immutable
  display     TEXT NOT NULL,
  tier        TEXT NOT NULL CHECK (tier IN ('pooled','dedicated','enclave')),
  cell_id     TEXT NOT NULL REFERENCES ctrl.cell(cell_id),
  status      TEXT NOT NULL CHECK (status IN ('provisioning','active','suspended','archived','decommissioned')),
  env_kind    TEXT NOT NULL CHECK (env_kind IN ('sandbox','uat','prod')),
  env_group   TEXT NOT NULL,               -- links sandbox/uat/prod variants of one customer
  baa_status  TEXT, dpa_status TEXT, support_tier TEXT,
  compliance_baseline TEXT NOT NULL,       -- 'MA' | 'MEDICAID' | 'COMMERCIAL' | 'PUBLIC'
  retention_policy JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ctrl.entitlement (
  tenant_id TEXT REFERENCES ctrl.tenant,
  key       TEXT NOT NULL,                 -- 'module.ENS', 'ai.summarization', 'api.pkg.std', ...
  value     JSONB NOT NULL,                -- bool | limits {seats, tps, inferences/mo}
  PRIMARY KEY (tenant_id, key)
);
```

Edge routing resolves `tenant → cell` from a signed, cached registry snapshot; cache TTL 60s with push invalidation on tier change.

## 4. Event backbone & outbox `[PLAT]`

### 4.1 Envelope (normative; `contracts/schemas/event-envelope.schema.json`)

```json
{
  "event_id": "evt_01J…",                  // ULID
  "schema_ref": "sim.case.state-changed/v2",
  "occurred_at": "2026-06-10T14:03:22.117Z",
  "tenant": { "tenant_id":"t_acmehealth", "lob":"MA", "program":null, "product":"ppo-1", "region":"TX" },
  "correlation_id": "case_01J…",           // case/transaction spine
  "causation_id": "evt_01J…",              // event that caused this one
  "actor": { "type":"human|service|model_agent", "id":"u_8f3c…", "on_behalf_of":null },
  "trace_ref": "trc_01J…",                 // optional Provenance link
  "payload": { }
}
```

### 4.2 Topic taxonomy (per cell)
`sim.case.lifecycle` (key=case_id; strict ordering), `sim.evidence`, `sim.task`, `sim.clock`, `sim.artifact` (VKAS publishes/rollbacks), `sim.ai.interaction`, `sim.audit.access`, `sim.tenant.admin`. Retention: `case.lifecycle` and `audit.*` infinite (compacted snapshots + archival to object store); others 90 days (the audit store, not Kafka, is the system of record for history).

### 4.3 Outbox

```sql
CREATE TABLE shared.outbox (
  seq         BIGSERIAL PRIMARY KEY,
  event_id    TEXT NOT NULL UNIQUE,
  topic       TEXT NOT NULL,
  key         TEXT NOT NULL,
  envelope    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
```

Writes happen in the same transaction as state changes via `outbox.append(env)` from the platform lib; a relay (Debezium or poller, per service) publishes and marks. Consumers are idempotent by `event_id` (dedupe table or upsert semantics). DLQ per consumer group; the support console reads DLQs and re-drives.

### 4.4 Event sourcing for the Case aggregate `[ENS]`

```sql
CREATE TABLE ens.case_event (
  case_id    UUID NOT NULL,
  seq        INT  NOT NULL,                -- per-aggregate sequence, optimistic concurrency
  tenant_id  TEXT NOT NULL,
  event_type TEXT NOT NULL,                -- CaseCreated, IntakeNormalized, CompletenessEvaluated,
                                           -- AutoDeterminationEvaluated, Triaged, Assigned, ReviewStarted,
                                           -- Pended, RfiIssued, RfiSatisfied, EscalatedToMD, PeerToPeerScheduled,
                                           -- DeterminationRecorded, NotificationSent, AppealOpened, ...
  payload    JSONB NOT NULL,
  trace_ref  TEXT, actor JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, seq)
);
```

Aggregate writes: load events (or snapshot+tail) → apply command via pure reducer → append with `seq = last+1` (conflict ⇒ retry) → outbox publish of the public projection of the event. Projections (worklist rows, case header, timeline, status API) are rebuildable consumers; rebuild tooling ships in Phase 0.

## 5. VKAS — Versioned Knowledge Artifact Service `[PLAT]`

### 5.1 Data model

```sql
CREATE TABLE vkas.artifact (
  canonical_url TEXT NOT NULL,             -- https://artifacts.simintero.io/{tenant|shared}/{type}/{name}
  version       TEXT NOT NULL,             -- semver
  tenant_id     TEXT NOT NULL,             -- 'shared' allowed for platform-seeded packs
  artifact_type TEXT NOT NULL,             -- coverage_rule|cql_library|dtr_package|crd_rule|value_set|
                                           -- concept_map|workflow_def|clock_profile|measure|prompt|
                                           -- model_binding|template|authz_policy
  status        TEXT NOT NULL CHECK (status IN ('draft','in_review','approved','active','retired','superseded')),
  effective_from DATE, effective_to DATE,
  content       JSONB NOT NULL,            -- or object-store ref for large (ELM, packages)
  content_hash  TEXT NOT NULL,
  applicability JSONB NOT NULL,            -- {lob[], program[], product[], region[], regime[], precedence}
  relations     JSONB NOT NULL DEFAULT '[]',  -- [{rel:'references|supplements|supersedes', target, version_range}]
  metadata      JSONB NOT NULL,            -- title, owner, clinical_area, source_provenance, license_ref
  created_by    TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_url, version)
);
CREATE TABLE vkas.approval (
  canonical_url TEXT, version TEXT, gate TEXT,      -- 'clinical' | 'compliance' | 'eval' | ...
  approver TEXT NOT NULL, decided TEXT NOT NULL CHECK (decided IN ('approved','rejected')),
  rationale TEXT, attestation JSONB, decided_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (canonical_url, version, gate)
);
```

Published versions are **immutable** (enforced by trigger: no UPDATE on rows with status≥approved except status transitions). Segregation of duties: `approver != created_by` when the artifact type's governance profile requires it.

### 5.2 Effective-version resolution (the algorithm everything depends on)

```
resolve(canonical_or_selector, ctx{tenant, lob, program, product, region}, as_of_date):
  candidates = versions WHERE status='active'
               AND effective_from <= as_of_date < coalesce(effective_to,'infinity')
               AND applicability ⊇ ctx (dimension match; '*' wildcards allowed)
  if selector is a *policy domain* (e.g., service_category):
      candidates += resolve relations: internal rules that 'supplement' licensed/public refs
      order by precedence: internal_supplement > internal > licensed_ref > public_ref,
               then by applicability specificity (more dimensions matched wins),
               then by max(version)
  if top-2 tie on precedence+specificity → CONFLICT (authoring-time lint flags this; runtime returns 409 + trace)
  return {canonical_url, version, content_ref} + resolution_trace
```

Resolution results are cached per `(selector, ctx-hash, date)` with invalidation on `sim.artifact` events. **Determinism guarantee:** runtime callers receive and *pin* the resolved version set; re-evaluation passes pins explicitly (`DIG-RT-2`, Qualitron period pinning).

### 5.3 API (excerpt; full spec `contracts/openapi/platform-vkas.yaml`)
`POST /artifacts` (draft) · `POST /artifacts/{url}/{ver}:submit|approve|activate|retire|rollback` · `GET /artifacts:resolve?selector&ctx&asOf` · `GET /artifacts/{url}:diff?from&to` (logical diff: CQL AST/text, Questionnaire items, value-set membership delta, metadata) · `POST /promotions` (env→env set promotion with gate results attached). Rollback = activate prior version with new effective dating + audit reason; never deletes.

## 6. Provenance service & evidence packages `[PLAT]`

### 6.1 Trace schema (`contracts/schemas/trace.schema.json`)

```json
{
  "trace_id": "trc_01J…",
  "tenant": { "tenant_id": "t_acmehealth", "lob": "MA" },
  "subject": { "type":"case_decision|advisory|measure_result|completeness", "ref":"case_01J…#det_2" },
  "governing_artifacts": [ {"canonical_url":"…/coverage_rule/knee-arthroscopy","version":"3.2.0",
                            "source":"internal_supplement","supplements":"…/licensed/mcg/A-0341"} ],
  "inputs": [ {"kind":"fhir","ref":"QuestionnaireResponse/qr_991"},
              {"kind":"document_span","ref":"doc_77","page":4,"region":[112,40,480,88],
               "excerpt_hash":"sha256:…"} ],
  "logic_path": [ {"step":"criteria.cql#ConservativeTherapyTried","result":true,
                   "value_sets":[{"url":"…/vs/pt-codes","version":"2026-01"}]} ],
  "actors": [ {"type":"service","id":"digicore-runtime","at":"…"},
              {"type":"model","id":"model:claude-x","prompt":"…/prompt/pa-summary","prompt_version":"1.4.0",
               "confidence":0.87,"at":"…"},
              {"type":"human","id":"u_8f3c…","action":"accepted","at":"…"} ],
  "outcome": { "kind":"recommendation","value":"meets_criteria" }
}
```

Profiles: `rules_trace` (Digicore — `logic_path` required), `ai_citation` (Revital — every summary assertion links one trace with ≥1 `document_span` input), `measure_evidence` (Qualitron). Write path: `trace.put()` from the platform lib; storage append-only; traces referenced by `trace_ref` from events, decisions, and `MeasureReport`s.

### 6.2 Evidence package exporter `[PLAT]`
`POST /evidence-packages {subject: case_id, purpose: appeal|audit|regulator}` → async assembly: case event stream + decisions + all traces (resolved artifact versions included as content snapshots) + documents (or redacted renditions per purpose) + approvals + AI interaction records → signed manifest (hash tree) → ZIP/FHIR-bundle hybrid in object store with expiring access. This single exporter satisfies the appeals, NCQA/URAC, and CMS-audit stories across all modules.

## 7. Identity, AuthZ & the adverse-action guard `[PLAT]`

### 7.1 Roles & permissions
Role templates (VKAS-versioned `authz_policy` artifacts): `um_intake`, `um_nurse_reviewer`, `medical_director`, `appeals_specialist`, `policy_analyst`, `clinical_informaticist`, `terminology_mgr`, `compliance_analyst`, `quality_analyst`, `tenant_admin`, plus internal roles. Permissions are `(action, resource_type, scope_constraints)` tuples; custom roles compose permissions, never bypass constraints.

### 7.2 OPA integration
OPA runs as sidecar/embedded lib; policies + data (role→permission maps, license/state data) ship as VKAS-promoted bundles. Standard query: `allow {input: {principal(sim claims), action, resource{type, tenant, lob, attrs}}}`.

### 7.3 The adverse-action guard (normative policy, abridged)

```rego
package sim.guards.adverse_action

default allow = false
allow {
  input.action == "decision.record"
  input.resource.outcome in {"deny","partial_deny","modify"}
  input.principal.sim.principal_type == "human"
  "medical_director" in input.principal.sim.roles        # or per-tenant configured sign-off role
  license_valid_for(input.principal, input.resource.region)
  input.resource.rationale != ""
  input.resource.trace_ref != ""
}
```

Enforced at the Case Service command handler (not the UI). Temporal's auto-determination activity literally has no code path to `decision.record` with adverse outcomes; if criteria fail, it emits `Triaged{to: clinical_review}`. Tests in `specs/ENS-WF/adverse-guard.spec.md` assert: service principal denied, model_agent denied, nurse without sign-off role denied, missing trace denied. (`ENS-WF-5`, `ENS-AI-3`, Revital §4 non-goal.)

## 8. Canonical data model & FHIR mapping `[PLAT]`

- **Clinical resources** (Condition, Observation, MedicationStatement, DocumentReference, QuestionnaireResponse, Coverage, Patient-as-Member, Practitioner/Role, Organization): persisted as profiled FHIR JSON in `fabric.resource (tenant_id, resource_type, id, version, profile, content JSONB, provenance_ref, last_updated)` with GIN indexes on the search-parameter projections we actually use (member, code, date, category). This *is* the evidence fabric store Qualitron reads.
- **Operational aggregates** (Case, ServiceLine, Task, Clock, Decision, Communication, Appeal): relational (§4.4 et al.), with **mapping functions** in `platform/libs/fhir-mapping`:
  - `toFhir(case) → Bundle{Claim(use=preauthorization, PAS profile), ClaimResponse, Task, Communication…}`
  - `fromPas(bundle) → IntakeCommand` · `fromX12_278(interchange) → IntakeCommand` (via canonical, lossless)
- **Losslessness tests are property-based:** generators produce valid PAS bundles / 278s; round-trip `fromX→canonical→toX` must preserve the required-element set (manifest in `contracts/fhir/required-elements.json`). These suites are cheap for agents to extend per new field and run on every PR.
- **Master data:** member/coverage/provider sync connectors upsert into `fabric.resource` with `source: core_admin` provenance + freshness stamps; staleness beyond SLA flags cases for eligibility re-check rather than blocking intake.


## 9. Enstellar detailed design `[ENS]`

### 9.1 Intake & channel service
Channel adapters normalize into a single `IntakeCommand`:

```
IntakeCommand { channel: PAS|X12_278|PORTAL|FAX_OCR, raw_ref (object store),
                correlation_id, tenant ctx, member_hint, coverage_hint,
                service_lines[], providers{requesting, servicing}, urgency,
                attachments[doc_ref], questionnaire_responses[], submitter }
```

Pipeline per message: persist raw (`ENS-INT-2`) → schema/IG validation (facade already validated FHIR; X12 validated by translator) → member/coverage resolution against fabric (fuzzy match w/ score; below threshold ⇒ `IntakeException` task) → **dedup/link**: candidate key = `(member, servicing_provider_npi, primary_code, date_window±3d)` + explicit linkage fields (PAS `Claim.related`, 275 `TRN` to 278); match ⇒ attach to existing case (`RfiSatisfied` or `EvidenceAdded`), else `CaseCreated`. Sync PAS returns `ClaimResponse` (queued/pended/approved) within the synchronous budget; async via `$inquire` + Subscriptions.

### 9.2 Workflow service — metadata-driven state machine on Temporal
**Workflow definition artifact** (`workflow_def`, VKAS; `contracts/schemas/workflow-definition.schema.json`):

```yaml
id: https://artifacts.simintero.io/t_acmehealth/workflow_def/pa-standard
version: 2.1.0
states: [INTAKE, COMPLETENESS, AUTO_DET, TRIAGE, REVIEW, PENDED_RFI, PEER_TO_PEER, DETERMINED, NOTIFIED, CLOSED, APPEALED]
transitions:
  - from: COMPLETENESS
    on: CompletenessEvaluated
    guard: "gaps.length == 0"
    to: AUTO_DET
  - from: COMPLETENESS
    on: CompletenessEvaluated
    guard: "gaps.length > 0"
    to: PENDED_RFI
    actions: [issue_rfi, pause_clock]
  - from: AUTO_DET
    on: AutoDeterminationEvaluated
    guard: "result == 'meets_all' && policy.auto_approve_eligible"
    to: DETERMINED
    actions: [record_approval]          # approvals only; adverse path structurally absent
  - from: AUTO_DET
    on: AutoDeterminationEvaluated
    guard: "else"
    to: TRIAGE
routing:                                 # evaluated at TRIAGE
  rules:
    - match: { urgency: expedited }      → queue: expedited, license_region_required: true
    - match: { service_category: ortho } → queue: ortho-nurses
assignment: { strategy: skill_license_load, supervisor_override: true }
sla_clock_profile: …/clock_profile/ma-cms-0057@^1
```

**Execution model:** one Temporal workflow per case (`workflowId = case_id`) runs a **generic interpreter** that loads the pinned `workflow_def` version at case start (recorded in `CaseCreated`). External stimuli are Temporal **signals** (`evidence.added`, `rfi.satisfied`, `reviewer.action`, `clock.fired`); guards are CEL expressions evaluated against case projection (no arbitrary code in artifacts); actions are a fixed, audited **activity catalog** (`call_digicore_evaluate`, `request_revital_analysis`, `issue_rfi`, `create_task`, `send_notification`, `record_decision`, `start_appeal_case`…). Activities are idempotent (idempotency key = `case_id+seq+action`) and retried per Temporal policy — this plus the event log delivers `ENS-WF-6` replayability. Definition upgrades: in-flight cases finish on their pinned version; migration tooling can signal opt-in re-pin per tenant policy.

### 9.3 Regulatory Clock service
`clock_profile` artifact: `{jurisdiction, lob, clocks: [{type: standard|expedited|appeal_l1…, limit: ISO8601 duration, calendar: calendar|business@cal_ref, start_on: event, pause_on: [RfiIssued], resume_on: [RfiSatisfied], warn_at: [75%, 90%], breach_action: escalate}]}`. Implementation: durable Temporal timers per active clock; pause = cancel timer + bank elapsed; resume = re-arm with remainder. Composition rule: when multiple profiles apply (federal + state), the engine arms **all**, and the earliest deadline drives warnings — satisfying "stricter state limits coexist" without merge logic. Emits `sim.clock` events; breach prediction feeds worklist sort and SLA dashboards.

### 9.4 Sequence — pend → RFI → review → decision (Journey 2)

```
EHR/portal      Facade/Translator   Intake        Case/WF(Temporal)      Digicore RT        Revital            Reviewer
   │ PAS $submit ──►│ validate ──────►│ resolve ────►│ CaseCreated         │                  │                  │
   │                │                 │ member/link  │ COMPLETENESS:       │                  │                  │
   │                │                 │              │  evaluate ─────────►│ requirements     │                  │
   │◄─ ClaimResponse(pended) ─────────┼──────────────│  gaps>0 ⇒ PENDED_RFI│ +trace           │                  │
   │   + RFI (Communication/portal)   │              │  pause clocks       │                  │                  │
   │ 275/portal docs ►│ ─────────────►│ link to case►│ RfiSatisfied signal │                  │                  │
   │                │                 │              │ resume clocks       │                  │                  │
   │                │                 │              │ request analysis ───┼─────────────────►│ analyze-case     │
   │                │                 │              │ TRIAGE→assign       │                  │ (async)          │
   │                │                 │              │ task in queue ──────┼──────────────────┼─────────────────►│ works case:
   │                │                 │              │                     │ evaluate(pinned) │ summary+citations│ trace panel,
   │                │                 │              │ DeterminationRecorded◄──────────────────┴──────────────────│ decision
   │◄─ notification + queryable status◄──────────────│ NOTIFIED, clocks closed, events → Qualitron/audit/search   │
```

### 9.5 Appeals
`AppealOpened` creates a **linked case** (`appeal_of: case_id`) with its own `workflow_def` + appeal-level clock profile; original decision's trace + pinned artifact versions are attached read-only (the Digicore "reproduce a past decision" journey is a VKAS resolve with the original pins). Independent-review routing excludes original deciders via assignment constraint `exclude_actors: original_case.deciders`.

### 9.6 Reviewer Workspace BFF
One `GET /workspace/cases/{id}` aggregate: case header + timeline (projection), service lines, member/coverage snapshot, documents (Document Service, policy-filtered), rules trace (latest evaluate trace), Revital advisory block (typed `advisory`, with citations + confidence + model/prompt versions + accept/override controls), available actions (computed from workflow state × OPA). Writes go through command endpoints that emit signals — the BFF holds no business logic.

## 10. Digicore detailed design `[DIG]`

### 10.1 Authoring & validation pipeline
Policy Studio edits produce draft VKAS artifacts. On save: CQL parse → semantic check (model = US Core/canonical) → compile to ELM (stored beside source) → terminology bind check (`$validate-code`/`$expand` against pinned value-set versions) → relation lint (dangling refs, applicability conflicts via §5.2 dry-run) → unit simulation (attached synthetic tests). The same pipeline runs headless in CI for artifact PRs (artifacts seeded in `/artifacts` are code-reviewed like code).

### 10.2 Runtime Decision Service (hot path)
Stateless evaluators per cell. `POST /runtime/evaluate`:
1. Resolve artifact set via VKAS (or accept caller pins) → pin list.
2. Assemble evaluation context: case data mapped to FHIR-shaped tuples (data-requirements-driven fetch from fabric/case projection — only what the ELM declares).
3. Execute compiled ELM (engine pool, warmed; expansions pre-cached per value-set version — cache key includes version so determinism holds).
4. Emit `rules_trace` (logic path with intermediate define results, value-set versions, inputs) via trace lib; return `{recommendation|requirements, gaps, pins, trace_ref}`.
Budgets: p50 ≤ 300ms / p99 ≤ 1s; CRD hook responses ≤ CDS Hooks guidance. Perf spike (SAD R-2) is the first Digicore milestone; fallback design (pre-materialized decision tables for auto-determination subset) sketched in `docs/adr/adr-11-decision-tables.md`.

### 10.3 Simulation & impact
Inputs: candidate artifact version + scenario set. Synthetic: declarative test cases `{context, evidence fixtures, expect}` stored as artifact relations; run on change (CI + Studio). Historical: replay against **in-boundary de-identified case corpus** (built by a Phase-1 ETL from `ens.case_event` with the de-id pipeline; refreshed nightly); output = outcome-distribution diff (approve/deny/RFI deltas, affected-population estimate by LOB/region) attached to the VKAS approval as a gate artifact. Blast-radius threshold breaches require an extra approval gate (configurable per tenant).

## 11. Revital & Model Gateway detailed design `[REV][PLAT]`

### 11.1 Model Gateway `[PLAT]`
`POST /inference {task_kind, prompt_ref@version, model_binding_ref@version, inputs{…}, tenant ctx}`:
- Resolves binding → provider+endpoint **for the caller's boundary** (config: `pooled/dedicated → commercial endpoints; enclave → authorized endpoints`); refuses cross-boundary.
- Entitlement + kill-switch check (`ai.*` flags; per-workflow disable honored by callers *and* re-checked here).
- **PHI minimization filter:** structured allow-list per task_kind (only the fields the prompt declares); free-text redaction pass (names/MRN/SSN patterns + tenant-configured) before egress; no-train headers/contract flags per provider.
- Logs `ai.interaction` (model+prompt versions, input refs — not payloads —, output hash, latency, cost) → audit + FinOps metering.
- Provider adapter interface: `complete(req) / embed(req)`; adding a model = new `model_binding` artifact + adapter config, no app change.

### 11.2 Pipeline (Temporal workflow `revital-analyze-case`)
Activities: `fetch_documents` → `parse_segment` (layout-aware; per-page text + region map persisted as spans) → `extract_entities` (LLM structured-output with JSON-Schema validation + retry-on-invalid; output = US Core resources + Provenance to spans; terminology normalize) → `fetch_evidence_requirements` (Digicore C-1) → `map_evidence_to_criteria` (deterministic matcher over extracted resources vs. requirement expressions; gaps/conflicts) → `summarize_grounded` (RAG over spans; **citation enforcement**: post-validation rejects any assertion lacking a span ref; uncited assertions are dropped or trigger regeneration, then abstention) → `triage_advise` (classifier/LLM with calibrated confidence; below threshold ⇒ `abstain`) → `persist_advisory` (typed advisory record + traces) → signal Enstellar.
Failure semantics: any activity failure degrades to partial advisory with explicit `unavailable` blocks — never blocks the human workflow (`ENS-AI-3`).

### 11.3 Evaluation & rollout
Gold sets per task (extraction P/R, citation validity %, groundedness score, calibration ECE) stored as eval artifacts; `eval-runner` executes on every prompt/model artifact change; VKAS gate `eval` must pass thresholds + clinical-validation approval for clinical-output changes. Online: override rate, acceptance-vs-accuracy, drift (population stats on inputs/outputs) per model/prompt/tenant; canary cohorts via entitlements; auto-rollback = VKAS rollback on metric breach alert.

## 12. Qualitron design (interface depth — Phase 3) `[QUA]`
Consumes: `sim.case.lifecycle` + `sim.evidence` (backbone), `fabric.resource` (store), supplemental ingestion (validated, std/non-std classified, provenance-stamped into fabric). Executes Digicore-authored `Measure`/`Library` with period-pinned VKAS resolution; population evaluation as batch Temporal workflows over Bulk-pattern extracts; `MeasureReport` + `measure_evidence` traces; gaps → Task Service (queue: `quality-outreach`) → re-evaluate on closure evidence events. No new substrate is required — that is the design test of ADR-6: if Qualitron needs new plumbing, the fabric was built wrong.


## 13. API design conventions `[PLAT]`

- **Style:** resource-oriented REST for platform/module APIs; FHIR semantics only at the facade; GraphQL only in the workspace BFF (read aggregation).
- **Versioning:** URI major (`/v1/`), additive within major; contract semver in `/contracts` is authoritative; breaking change ⇒ new major + deprecation window enforced by contract tests.
- **Errors:** RFC 9457 problem+json with `code` from a shared registry (`SIM-ENS-1042`), `correlation_id`, never PHI in messages.
- **Idempotency:** all mutating endpoints accept `Idempotency-Key`; command handlers dedupe on `(tenant, key)` for 48h.
- **Pagination:** cursor-based (`page[after]`, opaque, tenant-scoped); list endpoints always bounded.
- **Async:** long operations return `202 + operation_id`; status at `/operations/{id}`; completion also signaled via events/webhooks.
- **AuthN/Z:** every endpoint declares `action` + `resource_type` in its OpenAPI extension (`x-sim-authz`); middleware derives the OPA query from the spec — undeclared endpoints fail closed in CI.

## 14. C-1 Digicore Runtime contract — normative excerpt

```yaml
POST /v1/runtime/evaluate
requestBody:
  caseContext: { tenant ctx, lob, product, region, as_of: date }
  request: { service_lines: [{code, system, qty, place_of_service}], urgency }
  evidence: { resource_refs: [fabric refs], questionnaire_responses: [refs] }
  pins: { artifacts?: [{canonical_url, version}] }     # present on re-evaluation/appeal
responses:
  200:
    recommendation: meets_all | partial | not_met | indeterminate
    requirement_gaps: [{requirement_id, description, satisfied_by?: null}]
    pins: [{canonical_url, version}]                   # ALWAYS returned; caller MUST persist
    trace_ref: trc_…
    latency_budget_class: realtime | standard
  409: { code: SIM-DIG-CONFLICT, resolution_trace }    # applicability conflict (§5.2)
```

Consumer-driven contract tests: Enstellar publishes its expectations (pins persisted on case; 409 handled as `IntakeException` task); Revital publishes its `evidence-requirements` expectations. Pact broker gates both teams' merges.

## 15. Security implementation details `[PLAT]`

- **PHI-safe logging:** logging lib accepts only typed log objects; fields tagged `@phi` in shared types are auto-tokenized (`mrn: tok_ab12…`, reversible only via audited vault lookup). A semgrep ruleset blocks `console.log`/raw string interpolation of request bodies; CI fails on violations. Log schema: `{ts, level, svc, tenant_id, cell, correlation_id, event, fields…}`.
- **Crypto:** per-tenant DEKs (KMS envelope); `fabric.resource.content`, documents, and case-event payload columns encrypted with tenant DEK at the storage layer wrapper; key rotation re-wraps DEKs, not data; decommission = DEK destruction (crypto-shred) after retention/legal-hold checks.
- **Non-prod:** masked-clone tooling produces structurally-real, PHI-free datasets from prod schemas (synthetic substitution, referential integrity preserved); raw prod data never leaves prod cells.
- **De-identification pipeline** (for simulation/eval corpora): Safe Harbor field suppression + date shifting (consistent per member) + free-text scrubbing with QA sampling; outputs tagged `deid:v{n}` and usable only in-boundary.
- **Secrets:** external-secrets operator → cloud secret manager; no secrets in env files; per-boundary key namespaces (no reuse across cells — Enstellar A.2).
- **Threat-model anchors** (full STRIDE doc separate): tenant-context forgery (mitigated: signature + token exchange only at edge), RLS bypass (FORCE RLS + least-priv roles + CI harness), prompt injection via documents into Revital (mitigated: structured-output validation, no tool-use from document content, citation enforcement, advisory-only outputs), cross-boundary inference (gateway-enforced endpoint resolution + egress allow-lists per cell).

## 16. Observability implementation `[PLAT]`

- OpenTelemetry everywhere; trace context joined to `correlation_id` (case spine) via span attribute; baggage carries `tenant_id, cell, module` (PHI-free).
- Metric naming: `sim_<module>_<noun>_<verb>` (`sim_ens_case_state_transitions_total{from,to}`, `sim_dig_evaluate_latency_seconds`, `sim_rev_override_ratio`, `sim_clock_breach_warnings_total`). Business KPIs emitted from domain services (SAD §16) with tenant label; per-tenant SLO burn alerts.
- Dashboards as code (`infra/observability/`); support console queries: by case_id / correlation_id / FHIR resource id / document id / event id → unified lookup service joining event log + Temporal histories + DLQs + traces.

## 17. Testing strategy `[ALL]`

| Layer | What | Tooling / notes |
|---|---|---|
| Unit | Reducers, guards (CEL), resolvers, mappers | Vitest/JUnit/pytest; aggregate reducers are pure ⇒ trivially testable |
| Property | FHIR↔canonical↔X12 round-trips; VKAS resolution monotonicity; clock pause/resume arithmetic | fast-check/jqwik; generators in `platform/libs/testing` |
| Contract | Every C-* and platform API | Pact broker; provider verification in CI; breaking-change detector on `/contracts` |
| RLS/isolation | Every table, every service role | Generated harness (§3.3); cross-tenant probe suite also runs nightly against staging |
| Determinism | Digicore evaluate / Qualitron measures: same inputs+pins ⇒ byte-identical trace | Golden-file suite; runs on engine or terminology upgrades |
| Workflow | Temporal replay tests (workflow-code changes vs. recorded histories); journey tests (Journeys 1–4 as executable scenarios against ephemeral env w/ synthetic tenant) | Temporal test framework |
| Conformance | Inferno/Touchstone for pinned IGs (CRD/DTR/PAS/US Core/Bulk/SMART) | CI stage; ig-lock.json drives which kits run |
| AI eval | Gold-set gates per §11.3; red-team suite for injection via documents | eval-runner; results attached to VKAS gate |
| Security | SAST, deps, secrets, container, IaC; semgrep PHI-logging rules | Fail-closed gates |
| Load | Pooled-cell fairness (noisy-neighbor), evaluate-latency at p99, Bulk export scale | k6/Gatling; budgets from SAD §16 |

**Synthetic data:** `artifacts/synthetic/` ships two synthetic tenants (MA + Medicaid), Synthea-derived members, a starter policy pack (one service category end-to-end), DTR questionnaires, document fixtures (PDF therapy notes with known extractable facts for Revital gold sets). Every journey test, demo, and agent task runs on this — PHI never required for development.

## 18. Provisioning & migration flows `[PLAT]`

- **Tenant provisioning (Journey 3):** control plane `POST /tenants` (template + tier) → cell selection/stamp → Keycloak realm config + IdP federation stub → schema/namespace prep + DEK mint → entitlements → seed packs (workflow defs, clock profiles, role templates, starter policies via VKAS import) → readiness checks (RLS probe, conformance smoke, e2e synthetic case) → `active`. Fully scripted; rollback = decommission path. Target: < 1 day Phase 1, < 1 hour Phase 2.
- **Pooled→dedicated migration:** stamp dedicated cell → logical replication of tenant's rows (RLS-filtered publications per schema) + object-store copy + Kafka topic re-materialization from event store → dual-write window with read-from-old → gateway cutover (registry update) → verify (row counts, event-hash spot checks, journey smoke) → drop tenant rows from pooled cell (crypto-shred DEK scope). Rehearsed on synthetic tenant per SAD R-4.
- **Config promotion (Journey 2):** VKAS promotion set (rules + questionnaires + workflow defs + measures) diffed sandbox→UAT→prod with gate results (simulation, approvals) attached; blast-radius gate; rollback is a promotion of prior versions.

## 19. Performance design notes

- Worklists: projection tables with covering indexes per queue + SLA sort key (`next_deadline`), updated by consumers — no fan-out queries at read time.
- Evaluate path: ELM compile at publish (not request); expansion cache warmed on artifact activation; data-requirements-driven fetch keeps context assembly O(declared needs).
- Timeline: single ordered read of `case_event` + trace hydration on demand.
- Document pipeline: parse/extract async always; reviewer never blocks on Revital (advisory panel streams in).
- Budgets enforced in CI perf smoke: evaluate p99 < 1s @ 50 rps/cell baseline; PAS sync ack < 2s p95; worklist read < 300ms p95.

## 20. AI-assisted engineering workflow (the build system for this design) `[ALL]`

### 20.1 Spec-driven units of work
Every requirement group becomes `specs/<REQ-AREA>/<n>-<slug>.spec.md`:

```markdown
# Spec ENS-WF/3 — Routing & assignment
Source: Enstellar PRD ENS-WF-3 · SAD §8.1 · DDD §9.2
Intent: …
Invariants:
 - Assignment never selects a reviewer lacking required license for case region
 - Supervisor override emits Assigned{override:true} with actor
Interfaces touched: workflow-definition.schema.json#routing, Task API
Acceptance tests: journey routing.feature; unit guards; RLS untouched (no new tables)
Out of scope: …
```

An agent (Claude Code) is pointed at the spec; definition of done = acceptance tests green + contract tests green + invariants encoded as tests. Humans review the *spec mapping*, not raw diffs alone. PRD ACs map 1:1 into acceptance tests — the module PRDs' AC discipline is the test plan.

### 20.2 CLAUDE.md (root — abridged normative content)
```
- Read /contracts before writing any cross-module code; regenerate clients, never hand-write DTOs.
- Tenancy: use platform/libs/tenant-context; NEVER pass tenant_id manually across services;
  NEVER write SQL without going through the pooled tx wrapper (it sets sim.tenant_id).
- New table checklist: RLS policy + FORCE, tenant_id NOT NULL, add to rls-harness manifest.
- PHI: use typed loggers; never interpolate request/payload objects into strings.
- Events: all state changes via outbox.append; consumers idempotent on event_id.
- Adverse-action path: do not create any code path that records deny/partial/modify outside
  the guarded command handler. If a task seems to need it, STOP and flag a human.
- Artifacts over branches: tenant-variable behavior goes in /artifacts + an engine, never in code.
- Run: pnpm verify (lint+deps-rules+unit), pnpm rls-harness, pnpm contracts:check before PR.
```
Module-level CLAUDE.md files add domain rules (e.g., Digicore: "ELM execution must accept pins; never resolve 'latest' inside the engine"). Subagents defined in-repo: `conformance-runner` (Inferno against local facade), `contract-reviewer` (diffs `/contracts`, flags breaking changes), `rls-auditor`, `mapper-propgen` (extends round-trip generators when fields are added), `threat-model-assistant`.

### 20.3 Agent task routing (what agents do vs. humans)
- **Agent-led:** channel adapters, mappers + property tests, projections, console UIs, connector scaffolds, IG-conformance fixes, test data packs, dashboards-as-code.
- **Human-led, agent-assisted:** canonical model evolution, OPA policies (esp. §7.3), clock semantics, VKAS resolution algorithm changes, Revital prompt/eval design, anything in the adverse-action or PHI-egress path. These directories carry CODEOWNERS requiring senior review, and the root CLAUDE.md instructs agents to halt-and-ask there.
- All commits record authorship provenance (agent/human/pair) in trailers for audit of the SDLC itself.

## 21. Open design items

| # | Item | Owner | Needed by |
|---|---|---|---|
| D-1 | CEL vs. embedded CQL for workflow guards (consistency vs. simplicity) | ENS+PLAT | Phase 0 exit |
| D-2 | Snapshot cadence & schema for case aggregates (perf vs. simplicity) | ENS | Phase 1 |
| D-3 | Debezium vs. poller for outbox relay per service | PLAT | Phase 0 |
| D-4 | OCR provider per boundary (Textract vs. self-hosted in enclave) | PLAT | Phase 2 |
| D-5 | Fabric search-parameter projection set v1 (which FHIR search params we index) | PLAT+QUA | Phase 1 |
| D-6 | Pact broker vs. schema-diff-only for contract gating | PLAT | Phase 0 |
| D-7 | Per-tenant DEK granularity for Kafka payloads (envelope at producer vs. topic-level) | PLAT+SEC | Phase 1 |
| D-8 | De-id pipeline certification approach (expert determination vs. Safe Harbor only) | SEC+DIG | Phase 1 (simulation corpus) |

---

*Companions to produce next: full OpenAPI for C-1/C-2 and platform APIs; workflow-definition and clock-profile JSON Schemas; Phase 0 engineering plan with the spec backlog seeded from this document.*
