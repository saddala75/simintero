# Simintero — Complete Build Status: Platform & All Products

> Direct codebase audit as of commit `56bb2b6` (2026-06-13). Status reflects what is actually implemented in source, not what is designed or intended.

---

## Executive Summary

The platform substrate and integration connectors are **production-grade and fully implemented**. Enstellar (UM) has a **complete backend** with three screens of production-quality reviewer UI. Digicore and Automation are more complete than previously documented — both have substantial real implementations. Revital has a full Temporal pipeline. Claims is functional. Qualitron has partial execution logic. Analytics and Search are scaffolded. Four of seven web apps are functional; three are placeholder UIs.

---

## 1. Platform Substrate

### ✅ Complete

| Component | Location | What it does |
|---|---|---|
| **tenant-context** | `platform/libs/tenant-context/ts/` | `ctx()` getter + `withTenantContext()` async runner via AsyncLocalStorage. Exports DB helpers and middleware. Production-quality. |
| **outbox** | `platform/libs/outbox/ts/` | `createOutbox(db)` for transactional event append to `shared.outbox`. `topicFor()` maps schema refs → Redpanda topics covering case, evidence, artifact, AI, clock, and tenant domains. |
| **authz-client** | `platform/libs/authz-client/ts/` | `authorize()` calls OPA at configurable URL/timeout. Validates principals against `sim/guards/adverse_action/allow`. Uses tenant context for `tenant_id`, `roles`, `principal_type`. |
| **generated** | `platform/libs/generated/` | Read-only TypeScript type stubs for c2-revital-advisory, platform-vkas, platform-control-plane, platform-model-gateway, c1-digicore-runtime. Types only, no implementation. |
| **db-migrations** | `platform/services/db-migrations/migrations/` | 15 Flyway migrations covering all product schemas with RLS on all sensitive tables. See breakdown below. |
| **control-plane** | `platform/services/control-plane/` | Express app on `:4040`. `/v1/tenants` (CRUD + lifecycle), `/v1/tenants/:id/entitlements`, `/v1/cells`, `/v1/operations`, `/v1/support`. Uses CellAssigner, OperationTracker, TenantLifecycle, TenantEventPublisher. |
| **model-gateway** | `platform/services/model-gateway/` | Express app on `:4060`. `/inference` (InferenceDispatcher → VKAS_URL), `/kill-switch` (KillSwitchChecker), `/finops` (billing tracking). Enforces `ai.automation.live=false` default. |
| **document-service** | `platform/services/document/` | Express app on `:4070`. `/ingest`, `/span`, `/metadata`, `/redact`, `/redaction-view`. FileObjectStore backend (filesystem, configurable). |
| **OPA** | docker-compose | `openpolicyagent/opa` image. Policies in `platform/services/opa-policies/`. |
| **Redpanda** | docker-compose | Kafka-compatible event bus. Running. |
| **Temporal** | docker-compose | Workflow orchestration + UI. Running. |

**Migration inventory:**

| Migration | Schema | Contents |
|---|---|---|
| V001 | `ctrl` | cells, tenants, entitlements — control-plane metadata |
| V001b | `ctrl` | Seed cells |
| V002 | `shared` | outbox (event relay), processed_events (dedup), `fabric.resource` (FHIR evidence) |
| V003 | `vkas` | Versioned knowledge artifact store |
| V004 | `ens` | Enstellar cases, workflows, intake |
| V005 | `docs` / `revital` | Documents, evidence, annotations |
| V006 | `qual` | Quality measures, gaps |
| V007 | `search` | Index events, search logs |
| V008 | `analytics` | Metrics, reporting |
| V009 | `claims` | Claim tracking, submissions |
| V010 | `automation` | Rules, disposition log |
| V011 | `market` | Market bundles, bundle artifacts |
| V012 | `claims` | Clearinghouse columns extension |
| V013 | Various | Redaction view extensions |
| V014–V015 | `ens` | Enstellar intake and case aggregates (intake commands, service lines, pins, case events) |

### ⚠️ Unconnected External Dependencies

| Service | Env Var | Impact if missing |
|---|---|---|
| Keycloak (IdP) | `KEYCLOAK_URL`, `KEYCLOAK_CLIENT_SECRET` | SSO login disabled; connector built but no defaults |
| EDI Clearinghouse | `CLEARINGHOUSE_URL`, `CLEARINGHOUSE_API_KEY` | Claims EDI integration disabled; claims still write to DB |
| VSAC (value sets) | `VSAC_API_KEY` | Value set expansion falls back to public endpoint; production needs API key |
| VKAS | `VKAS_URL` | Artifact store used by Digicore registry; must be wired |

---

## 2. Integration Connectors

All four connectors are **fully implemented** with real HTTP clients, error handling, and token caching. They are libraries — not services. They are imported by the services that need them.

| Connector | Location | What it does |
|---|---|---|
| **keycloak** | `integration/connectors/keycloak/` | `createUser`, `assignRealmRole`, `createTenantGroup`, `addUserToGroup`, `getTenantGroup`. Token caching with 30-second buffer. |
| **clearinghouse** | `integration/connectors/clearinghouse/` | `submitClaim` (X12 payload), `getRemittance`, `pollAck` (30s max, 2s polling). Handles 409/404. |
| **vsac** | `integration/connectors/vsac/` | `expandValueSet` (OID+version), `getValueSetMetadata`. Basic auth. Hand-rolled XML regex parsing. |
| **cds-hooks** | `integration/connectors/cds-hooks/` | Two registered hooks: `pa-authorization-check` (calls control-plane `/entitlements/pa-required`), `coverage-check` (calls FHIR facade). Graceful empty-cards on error. |

### ❌ Not Yet Built

| Gap | Notes |
|---|---|
| **FHIR facade** | Listed in docker-compose as `fhir-facade`; implementation depth unknown — cds-hooks coverage-check calls it |
| **X12 translator** | Listed in docker-compose as `x12-translator`; implementation depth unknown |
| **VSAC proxy** | `vsac-proxy` in compose; VSAC connector exists but proxy service unclear |

---

## 3. Enstellar — Utilization Management

> Most complete product. Real event-sourced backend, governed AI, full reviewer UI.

### ✅ Complete

#### Intake (`modules/enstellar/intake/`)

Express server with POST `/internal/intake/commands`. Full implementation: validates command → member resolution (0.85 confidence threshold) → 3-day dedup window → seeds Patient/Coverage/Practitioner to `fabric.resource` → atomic INSERT `ens.case` + `ens.service_line` + `shared.outbox`. Emits `CaseCreated` event.

#### Case Aggregate (`modules/enstellar/case/`)

Event-sourced aggregate root. Implemented commands:
- `CreateCase` — creates case with full aggregate state
- `RecordDecision` — **OPA adverse-action guard before write**; atomic INSERT `ens.determination` + `ens.case_event` + outbox; advisory lock for concurrency
- `RecordRFI`, `SatisfyRFI`, `LinkCase`, `AppendPin` — all fully implemented

Projections: `getWorklist()` and `getCaseDetail()` both implement cursor pagination (base64 of `created_at`) and tenant RLS via GUC.

DB: `ens.case_event` (append-only with trigger), `ens.determination` (`adverse_outcome_requires_human` constraint), `ens.rfi`, `ens.task`, `ens.case_pin`.

#### Clock Worker (`modules/enstellar/clock/`)

Temporal workflow `ClockWorkflow` with signals (`pauseClockSignal`, `resumeClockSignal`, `satisfyClockSignal`). Pure `advanceClockState()` state machine. Activities: `computeDeadlineActivity`, `resolveClockProfile`, `emitWarning`, `emitBreach`. The emit activities tolerate 501/404 from case-service with `console.warn` — Phase 1 labeled stub, but the workflow machine is production-complete.

#### Comms (`modules/enstellar/comms/`)

`issueRfi()` fully wired: renders template → atomic INSERT `ens.communication` + outbox. `TemplateRenderer` handles memberName, caseId, rfiDueDate. `sendViaFax()`, `sendViaPortal()` channels exported. `sendDeterminationLetter()` exported but implementation completeness uncertain.

#### Workspace BFF (`modules/enstellar/workspace-bff/`)

GraphQL Yoga + Express on `:3021`. Auth middleware validates JWT. RLS via GUC injection.

| Resolver / Mutation | Status |
|---|---|
| `worklist` query | ✅ Full — RLS, cursor pagination, state/urgency/LOB filters |
| `case` query | ✅ Full — loads case + service lines |
| `advisory` query | ✅ Real — fetches from Revital, returns null on failure |
| `trace` query | ⚠️ Stub — returns empty trace on 404/501/network error |
| `recordDecision` mutation | ⚠️ Partial — POSTs to case-service; returns `stub-det-id` on 501 or network error |
| `routeCase` mutation | ⚠️ Stub — POSTs to task service (`:8091`); returns `stub-task-not-deployed` on network error |

#### Reviewer Workspace Frontend (`apps/web/reviewer-workspace/`)

Three screens, all wired to live BFF GraphQL — no mock data layer:

| Screen | File | Real hooks |
|---|---|---|
| UM Home / Worklist | `src/pages/Worklist.tsx` | `useWorklist()` → `WORKLIST_QUERY` |
| Clinical Review | `src/pages/CaseReview.tsx` | `useCaseDetail()`, `useAdvisory()`, `useRulesTrace()` |
| Adverse Determination | `src/pages/DeterminationView.tsx` | `RECORD_DECISION_MUTATION` |

Design system fully implemented: Bricolage Grotesque / Hanken Grotesk / JetBrains Mono fonts; `--pine`, `--teal`, `--aqua`, `--amber`, `--red` color tokens. Stats band, tabbed queue table, 3-column content grid, criteria accordion, AI advisory card, 5-step determination composer with gate column.

### ⚠️ Partially Stubbed / Incomplete

| Gap | Detail |
|---|---|
| **Task service** | `routeCase` posts to `:8091`; service does not exist; stubbed in BFF catch block |
| **RFI tracking UI** | `ens.rfi` table exists, `routeCase(toQueue:'rfi')` is stubbed; no RFI creation/tracking frontend flow |
| **Peer review queue** | `routeCase(toQueue:'peer_review')` stubbed; no peer review workflow |
| **Workflow definition resolver** | `resolveWorkflowDef` returns hardcoded `PA_STANDARD_MA_STUB v0.1.0-stub` when VKAS unavailable |
| **Rules trace** | `trace` resolver returns empty; no live rules trace pipeline connected to BFF |
| **Determination letter delivery** | `sendDeterminationLetter()` exported from comms; delivery implementation uncertain |
| **Member lookup** | `member_ref` stored as plain text; no FHIR facade integration for live member data |
| **Keycloak SSO in UI** | Reviewer workspace uses hardcoded `SimCtx` defaults; no real SSO login flow |

---

## 4. Revital — Clinical Data Extraction

> Complete Temporal pipeline. Full DB schema. Deployed. NLP depth is the open question.

### ✅ Complete

#### Extraction Lib (`modules/revital/extraction/`)

`EntityNormalizer` converts raw clinical entities to normalized form with FHIR coding (`system:code`). Input: `RawEntity(resource_type, raw_text, coding_hint)`. Output: `NormalizedEntity(system, code, raw_text)`. Utility library consumed by pipeline.

#### Pipeline Service (`modules/revital/pipeline/`)

Temporal workflow `revitalAnalyzeCase` with 7 sequential activities:

1. `fetchDocuments` — retrieve document references
2. `parseSegment` — parse documents into spans
3. `extractEntities` — extract clinical entities from spans
4. `fetchEvidenceRequirements` — retrieve criteria requirements for case
5. `mapEvidenceToCriteria` — map extracted evidence to completeness criteria
6. `summarizeGrounded` — AI summarization of grounded evidence
7. `triageAdvise` — triage/advising logic
8. `persistAdvisory` — store results in `revital.analysis` table

POST `/v1/assist/analyses` checks `ai.inference.disabled` entitlement kill-switch before starting Temporal workflow.

DB: `revital.analysis` (analysis_id, case_ref, status, interaction, summary, extraction, completeness, triage, unprocessed_inputs) and `revital.feedback` — both with RLS.

In docker-compose as `revital-pipeline`. Has its own Dockerfile.

### ❌ Not Yet Built / Unclear

| Gap | Notes |
|---|---|
| **NLP engine** | No Presidio, spaCy, or clinical NLP service is wired in; actual entity extraction implementation is unknown |
| **AI model integration** | `summarizeGrounded` and `triageAdvise` activities presumably call model-gateway; not confirmed in source |
| **Revital UI** | No frontend application exists |
| **Eval module** | No evaluation/accuracy-tracking module visible |
| **Feedback loop** | `revital.feedback` table exists; no feedback ingestion endpoint confirmed |

---

## 5. Digicore — Clinical Criteria Authoring & Governance

> More complete than initially known. All four TypeScript modules are fully implemented plus a Java CQL execution runtime.

### ✅ Complete

#### Authoring (`modules/digicore/authoring/`)

Full implementation on port `:3011`:
- `POST /v1/authoring/compile` — CQL compilation via `CqlCompilerClient`
- `POST /v1/authoring/validate` — `TerminologyBindingValidator` against VSAC
- `POST /v1/authoring/draft` — `DraftArtifactCreator` → VKAS artifact
- `POST /v1/authoring/unit-test` — runs test scenarios against draft

#### Governance (`modules/digicore/governance/`)

Full implementation on port `:3014`:
- `POST /v1/governance/queue` — submits artifact for dual-gate review
- `POST /v1/governance/approve` — `GateEnforcer` requires both clinical + compliance approvals; blocks self-approval
- `POST /v1/governance/activate` — activates after both gates pass; emits outbox event via `OutboxNotificationClient`

#### Registry (`modules/digicore/registry/`)

Full implementation on port `:3010`:
- `GET /v1/registry/artifacts` — faceted search via `ArtifactSearchService` + `OpenSearchIndexer`
- `GET /v1/registry/artifacts/:canonical/:version` — detail with cache invalidation

DB migration: `V006__dig_registry.sql`

#### Simulation (`modules/digicore/simulation/`)

Full implementation on port `:3050`:
- `POST /v1/simulation/runs` — `ScenarioRunner` loads synthetic test cases from disk, calls runtime HTTP API, tracks regressions via `HistoricalReplayer`, produces `SimulationReport`

DB migration: `V007__dig_simulation.sql`

#### Runtime (`modules/digicore/runtime/`)

Java Spring Boot CQL execution engine on port `:8083`. Has its own `Dockerfile`. In docker-compose as `digicore-runtime`.

### ❌ Not Yet Built

| Gap | Notes |
|---|---|
| **Digicore UI** | No frontend; no `apps/web/digicore-*` console |
| **OpenSearch instance** | Registry requires OpenSearch — not in docker-compose |
| **VKAS wiring** | Authoring writes to VKAS; VKAS service not confirmed running in compose |
| **Criteria format spec** | No published schema for what a "criteria artifact" looks like end-to-end |

---

## 6. Qualitron — Quality Measurement

> Partially implemented. Execution workflow and gap detection have real logic; aggregation and reporting are minimal.

### ✅ Implemented

#### Execution (`modules/qualitron/execution/`)

Temporal workflow `qualitronRunMeasure` with activities: `fetchEligibleMembers`, `evaluateMeasure`, `persistMeasureReport`. Express server on `:3015`. POST `/v1/quality/runs`, GET `/v1/quality/runs/:runId`. Writes to `qual.measure_run` table. Has its own `Dockerfile`. In docker-compose as `qualitron`.

#### Gaps (`modules/qualitron/gaps/`)

`detectGap()` checks numerator/denominator/exclusion status. `createOutreachTask()` creates tasks for members missing numerator. `handleMeasureReportCompleted()` event handler. ~300 LOC. Note: `MIN_EVIDENCE_CONFIDENCE = 0.0` carries `// HUMAN_REVIEW: gap detection thresholds require quality measurement specialist review`.

### ⚠️ Partial / Stub

| Component | Status |
|---|---|
| **Aggregation** | Event consumer routing only; ~100 LOC; no Express server; no Dockerfile |
| **Reporting** | `measuresRouter` + `gapsRouter` stubs only; GET endpoints return nothing useful |

### ❌ Not Yet Built

| Gap | Notes |
|---|---|
| **HEDIS/CMS measure definitions** | No measure specs; `evaluateMeasure` activity calls a generic evaluation; no actual HEDIS logic |
| **Member attribution engine** | No member-to-provider attribution logic |
| **DB migrations** | Qualitron modules use pre-existing `qual` schema but have no dedicated migrations |
| **Quality console UI** | `apps/web/quality-console` is a placeholder (see Frontend section) |
| **Gap detection thresholds** | `MIN_EVIDENCE_CONFIDENCE = 0.0` flagged for clinical review before production |

---

## 7. Claims

> Functional service with real DB writes and optional clearinghouse integration.

### ✅ Complete

#### Claims Service (`modules/claims/service/`)

Express app. `POST /v1/claims` creates `ens.case (case_type='claim')` + `claims.claim` (claim_number, service dates, total_billed_usd). If `CLEARINGHOUSE_URL` + `CLEARINGHOUSE_API_KEY` are set, submits X12 payload and stores `ack_status`, `control_number`.

`IRORoutingWorkflow` (Temporal): emits `sim.claims.iro` outbox event with `appeal_case_ref` + `iro_vendor_id` (ENV-configurable, default `'iro-stub'`), updates case state to `IRO_PENDING`.

DB: `claims.claim`, `claims.appeal` (types: `standard/expedited/iro`) — both with RLS.

In docker-compose as `claims-service` with its own Dockerfile.

### ⚠️ Flagged for Review

**IRO assignment logic must be reviewed by compliance and legal before production.** The `iro_vendor_id` defaults to `'iro-stub'` — must be replaced with real vendor routing before any production use.

### ❌ Not Yet Built

| Gap | Notes |
|---|---|
| **Claims UI** | No frontend app for claims processing |
| **Remittance processing** | Clearinghouse connector has `getRemittance()`; no remittance handler in claims service |
| **Denial/appeal workflow** | `claims.appeal` table exists; no appeal creation API confirmed |

---

## 8. Cross-Cutting Services

### Automation (`modules/automation/service/`)

**✅ Fully implemented.** Express on `:3017`. `POST /v1/automation/disposition` runs OPA gate + checks tenant entitlement (`ctrl.entitlement`). Enforces dry-run by default. Security constraint: blocks adverse outcomes (`deny/partial_deny/modify`) regardless of confidence. All live-mode automation gated by entitlement. Has Dockerfile. In docker-compose as `automation-service`.

### Market Bundles (`modules/market-bundles/service/`)

**✅ Fully implemented.** Express on `:3018`. `POST /v1/market/bundles` (always creates as `status: draft`), `POST /v1/market/bundles/:bundleRef/activate` (requires `reviewer_id` — mandatory), `GET /v1/market/bundles/:bundleRef`. DB: `market.bundle`, `market.bundle_artifact` with RLS. Has Dockerfile. In docker-compose as `market-bundles-service`.

Security constraint: **bundles must not be promoted from `draft` to `active` without clinical review.** The API enforces `reviewer_id` presence but does not validate the reviewer's credentials.

### Search

**⚠️ Partially implemented.**

- **Indexer** (`modules/search/indexer/`): `IndexClient` interface + `CaseLifecycleHandler`, `EvidenceHandler`, `QualEvidenceHandler`. Documents indexed by content hash (SHA-256) — never raw text.
- **Query API** (`modules/search/query-api/`): `GET /v1/search?q=&entity_types=&limit=` — ILIKE substring match on hashed queries against `search.index_event`. Returns entity_id, entity_type, indexed_at. Has Dockerfile. In docker-compose as `search-service` on `:3019`.

Gap: No OpenSearch integration confirmed — indexing appears to write to `search.index_event` table, not a dedicated search engine.

### Analytics (`modules/analytics/service/`)

**❌ Stub.** Source is `export {}` — 1 line. Has Dockerfile. Runs in docker-compose on `:3020`. No implementation.

---

## 9. Frontend Applications

| App | Location | Status | Backend wired |
|---|---|---|---|
| **reviewer-workspace** | `apps/web/reviewer-workspace/` | ✅ Production-ready | GraphQL BFF on `:3021` |
| **provisioning-console** | `apps/web/provisioning-console/` | ✅ Production-ready | Control-plane `:3030`, Registry `:3010` |
| **saas-admin** | `apps/web/saas-admin/` | ✅ Functional | Control-plane (tenant list, detail, cells, env groups) |
| **ai-ops-console** | `apps/web/ai-ops-console/` | ⚠️ Partial | Workflow search `/api/workflows`, DLQ inspector, activity timeline; 30s polling |
| **support-console** | `apps/web/support-console/` | ❌ Placeholder | Input fields only; no API calls |
| **analytics-console** | `apps/web/analytics-console/` | ❌ Placeholder | Fetch calls to `/api/analytics/*` but no backend serving those routes |
| **quality-console** | `apps/web/quality-console/` | ❌ Placeholder | Fetch calls to `/api/quality/*` but no backend serving those routes |

**provisioning-console:** 4-step tenant wizard with validation and async submission. Creates tenants with infrastructure/compliance/tier configuration. Real `controlPlaneClient`.

**saas-admin:** Tenant list with filters (status, tier, env_kind), pagination (limit=50, offset-based), real data fetching with error handling.

---

## 10. Integration Testing

Cucumber BDD framework (`integration/e2e/`). Steps implemented:

| Step file | Coverage |
|---|---|
| `claims.steps.ts` | Claim submission, appeal filing, `case_ref` capture |
| `bundles.steps.ts` | Bundle provisioning (verifies `status='draft'`), activation with `reviewer_id` validation |
| `search.steps.ts` | Case indexing, search query, `entity_type`/`entity_id` filtering |

Framework is wired (`cucumber.yml`, `src/steps/`). `SimWorld` multi-tenant test context with `SERVICE_BASE` mapping services on `:3010–3021`. Feature files exist but coverage is sparse — all services depend on compose being up.

All 7 web apps have Vitest unit test configs. 24 unit/component test files total.

---

## 11. Deployment & Infrastructure

Everything runs via a single `docker-compose.yml` for local development. Production deployment is managed via Kubernetes + Helm + ArgoCD with Terraform for cell provisioning.

**Services with Dockerfiles (our code):**
document-service, model-gateway, control-plane, enstellar-case, enstellar-workflow-worker, enstellar-clock-worker, enstellar-comms, workspace-bff, revital-pipeline, qualitron (execution), claims-service, automation-service, market-bundles-service, search-service (query-api), analytics-service, vsac-proxy, cds-hooks, fhir-facade, x12-translator, digicore-runtime (Java).

### Kubernetes / Helm (`infra/k8s/`)

24 Helm charts, one per service, under `infra/k8s/`. Each chart has `Chart.yaml`, `values.yaml`, and `templates/` with deployment + service manifests. A shared base-service chart lives at `infra/k8s/charts/base-service/`.

**Services with Helm charts:**
document-service, model-gateway, control-plane, enstellar-case, enstellar-comms, enstellar-workflow-worker, enstellar-clock-worker, workspace-bff, revital-pipeline, qualitron, claims-service, automation-service, market-bundles-service, search-service, analytics-service, digicore-runtime, fhir-facade, x12-translator, reviewer-workspace, saas-admin, provisioning-console, support-console, ai-ops-console, + shared network policies and K8s jobs (Flyway migrate, Temporal init).

**Network policies** (`infra/k8s/network-policies/`): default-deny-all, allow-db-clients, allow-same-namespace, allow-opa-clients.

**K8s config maps** (`infra/k8s/config/`): `sim-temporal-config.yaml`, `sim-platform-config.yaml`.

### ArgoCD (`infra/argocd/`)

ArgoCD `ApplicationSet` (`infra/argocd/applicationset.yaml`) manages GitOps deployment of all 24 charts. Services are split across two cells:

| Cell | Target cluster | Services |
|---|---|---|
| **pooled** | `pooled-cluster.simintero.io` | All Node.js services, Temporal workers, web apps |
| **enclave** (FedRAMP) | `enclave-cluster.simintero.io` | fhir-facade, x12-translator, digicore-runtime |

Auto-sync with `prune: true` and `selfHeal: true`. `ServerSideApply=true`.

`infra/argocd/cells/` and `infra/argocd/modules/` contain additional per-cell ArgoCD resources.

### Terraform (`infra/terraform/`)

Two defined cells:
- `cells/us-east-1-pooled-01/` — pooled cell (Node.js services)
- `cells/us-gov-west-1-enclave-01/` — enclave cell (FedRAMP, Java/PHI services)

Shared `modules/cell/` Terraform module with `main.tf`, `variables.tf`, `outputs.tf`.

### Enclave Checklist

`infra/cell-stamp/enclave-checklist.md` — FedRAMP enclave readiness checklist exists.

**Missing infrastructure:**
- No observability stack confirmed (Grafana / Prometheus / Loki / Jaeger)
- No secret management confirmed (Vault, AWS Secrets Manager, etc.)
- No PHI audit log enforcement outside model-gateway
- Only 1 ADR documented (`ADR-12-enclave-cell-pattern.md`)

---

## 12. Master Status Table

| Layer | Component | Status | Confidence |
|---|---|---|---|
| **Platform** | DB migrations (V001–V015, all schemas, RLS) | ✅ Complete | High |
| **Platform** | tenant-context, outbox, authz-client libs | ✅ Complete | High |
| **Platform** | control-plane, model-gateway, document-service | ✅ Complete | High |
| **Platform** | keycloak, clearinghouse, vsac, cds-hooks connectors | ✅ Complete | High |
| **Platform** | Temporal, Redpanda, OPA, PostgreSQL | ✅ Running | High |
| **Platform** | Keycloak live SSO, VSAC API key, Clearinghouse URL | ❌ Not wired | High |
| **Platform** | FHIR facade, X12 translator, VSAC proxy | ❓ Unknown depth | Low |
| **Platform** | Helm charts (24) + ArgoCD ApplicationSet + Terraform cells | ✅ Complete | High |
| **Platform** | Observability, secret management | ❌ Not confirmed | High |
| **Enstellar** | Intake, case aggregate, event sourcing | ✅ Complete | High |
| **Enstellar** | Clock worker (Temporal workflow) | ✅ Complete | High |
| **Enstellar** | Comms (issueRfi) | ✅ Complete | High |
| **Enstellar** | Comms (determination letter delivery) | ⚠️ Uncertain | Medium |
| **Enstellar** | Workflow worker (state machine) | ✅ Complete | High |
| **Enstellar** | Workflow worker (resolveWorkflowDef) | ⚠️ Hardcoded stub | High |
| **Enstellar** | Workspace BFF (worklist + case queries) | ✅ Complete | High |
| **Enstellar** | Workspace BFF (recordDecision, routeCase mutations) | ⚠️ Partially stubbed | High |
| **Enstellar** | Workspace BFF (trace resolver) | ⚠️ Stub | High |
| **Enstellar** | Reviewer workspace UI (3 screens, all hooks live) | ✅ Complete | High |
| **Enstellar** | Task service (RFI routing, peer review) | ❌ Not built | High |
| **Enstellar** | Member FHIR lookup integration | ❌ Not built | High |
| **Revital** | Temporal pipeline (7 activities, full DB schema) | ✅ Complete | High |
| **Revital** | NLP / clinical entity extraction engine | ❓ Unknown depth | Low |
| **Revital** | AI model integration (summarization, triage) | ❓ Assumed via model-gateway | Low |
| **Revital** | Feedback loop, eval metrics, UI | ❌ Not built | High |
| **Digicore** | Authoring (CQL compile, validate, draft) | ✅ Complete | High |
| **Digicore** | Governance (dual gate SOD, approval, activation) | ✅ Complete | High |
| **Digicore** | Registry (faceted search, versioning) | ✅ Complete | High |
| **Digicore** | Simulation (scenario runner, regression tracking) | ✅ Complete | High |
| **Digicore** | CQL runtime (Java Spring Boot) | ✅ Complete | High |
| **Digicore** | OpenSearch instance (required by registry) | ❌ Not in compose | High |
| **Digicore** | Authoring / governance UI | ❌ Not built | High |
| **Qualitron** | Execution (Temporal workflow, measure run) | ✅ Functional | Medium |
| **Qualitron** | Gaps (gap detection, outreach tasks) | ✅ Functional | Medium |
| **Qualitron** | Aggregation | ⚠️ Stub | High |
| **Qualitron** | Reporting | ⚠️ Stub | High |
| **Qualitron** | HEDIS/CMS measure definitions | ❌ Not built | High |
| **Qualitron** | Member attribution engine | ❌ Not built | High |
| **Qualitron** | Quality console UI | ❌ Placeholder | High |
| **Claims** | Claims service (submit, X12 integration, IRO routing) | ✅ Functional | High |
| **Claims** | Remittance processing, denial/appeal workflow, UI | ❌ Not built | High |
| **Automation** | Disposition API with OPA gate, dry-run enforcement | ✅ Complete | High |
| **Market Bundles** | Bundle lifecycle (draft → activate with reviewer_id) | ✅ Complete | High |
| **Search** | Query API + indexer interface | ⚠️ Partial | Medium |
| **Analytics** | Service | ❌ Stub (1 LOC) | High |
| **Frontend** | reviewer-workspace | ✅ Production-ready | High |
| **Frontend** | provisioning-console | ✅ Production-ready | High |
| **Frontend** | saas-admin | ✅ Functional | High |
| **Frontend** | ai-ops-console | ⚠️ Partial | Medium |
| **Frontend** | support-console, analytics-console, quality-console | ❌ Placeholder | High |
| **Testing** | Worklist unit tests, BDD framework wired | ✅ Exists | Medium |
| **Testing** | E2E scenario coverage | ⚠️ Sparse | Medium |

---

## 13. What to Build Next (Priority Order)

1. **Task service** — unblocks RFI routing, peer review, and the `routeCase` mutation stub that currently limits the reviewer workflow
2. **Keycloak SSO integration in reviewer-workspace** — the connector is built; the UI login flow is hardcoded
3. **Rules trace pipeline** — `trace` resolver is a stub; without it the criteria accordion in Clinical Review shows nothing live
4. **OpenSearch** — add to docker-compose; required for Digicore registry and search indexer
5. **Digicore UI console** — the backend is complete; there is no frontend to author or govern criteria
6. **HEDIS/CMS measure definitions** — Qualitron execution runs but has nothing to evaluate
7. **Observability** — Grafana/Prometheus/tracing; zero visibility into production right now
8. **Analytics service** — currently 1 line of code; analytics-console is waiting
9. **Quality console + support console** — placeholder UIs with no real API connections
10. **CI/CD pipeline** — no automated build/test/deploy
