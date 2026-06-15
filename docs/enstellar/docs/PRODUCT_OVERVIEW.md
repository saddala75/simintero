# Enstellar — Product Overview

**Prepared:** June 2026  
**Status:** Current as of completion of design-partner readiness milestone (all SP1–SP6 merged to `main`)  
**Audience:** Product, business development, implementation, technical leadership

---

## Table of Contents

1. [What Is Enstellar?](#1-what-is-enstellar)
2. [The Problem It Solves](#2-the-problem-it-solves)
3. [Who It's For](#3-who-its-for)
4. [What Has Been Built](#4-what-has-been-built)
5. [Architecture Overview](#5-architecture-overview)
6. [Feature Inventory: Built vs. Planned](#6-feature-inventory-built-vs-planned)
7. [Standards & Regulatory Compliance](#7-standards--regulatory-compliance)
8. [Security, Privacy & AI Governance](#8-security-privacy--ai-governance)
9. [Known Limitations & Tech Debt](#9-known-limitations--tech-debt)
10. [What Must Be Done to Go to Market](#10-what-must-be-done-to-go-to-market)
11. [Release Roadmap](#11-release-roadmap)
12. [Competitive Positioning](#12-competitive-positioning)

---

## 1. What Is Enstellar?

Enstellar is the **interoperability and workflow-execution module** of the Simintero payer operating platform. It is a configurable, standards-based engine that turns inbound clinical and administrative transactions into governed, traceable cases and drives them through a complete lifecycle to a determination.

**Prior authorization (PA) — the full utilization management lifecycle including the pathway to adverse determinations — is the first fully-specified use case.** The same engine is designed from the ground up to extend to adjacent workflows (concurrent review, referrals, claims attachments, payer-to-payer exchange, gold-carding) by configuration rather than re-platforming.

The platform is **payer-side**: it exposes standards-based endpoints that provider EHR systems connect to; it does not replace claims adjudication or author coverage criteria.

Within the Simintero ecosystem, Enstellar:
- **Consumes Digicore** for coverage requirements discovery, documentation templates, and runtime decision logic.
- **Consumes Revital** for advisory AI document summarization and evidence extraction — surfaced to reviewers under strict human-in-the-loop governance.
- **Feeds Qualitron** with the event, evidence, and outcome stream for quality measurement and analytics.

---

## 2. The Problem It Solves

### For Payers

Prior authorization is operationally expensive, liability-prone, and under unprecedented regulatory pressure. Payers face:

- **CMS-0057-F compliance** (electronic PA mandates for MA/Medicaid/Exchange/CHIP plans) with explicit API requirements for CRD, DTR, PAS, Patient Access, Provider Access, and Payer-to-Payer exchange.
- **State PA reform laws** stacking on top of federal mandates with stricter timeframes.
- **NCQA/URAC accreditation** requirements on decision turnaround, documentation, and appeal timeliness.
- **AI-in-UM regulatory exposure** — the use of AI in coverage decisions is under active scrutiny; payers need auditable, human-in-the-loop governance, not black-box automation.
- **Provider abrasion** — high rates of portal logins, fax follow-up, and resubmissions consume provider staff time and damage payer-provider relationships.
- **Per-tenant code forks** — most legacy PA systems require custom development for each line of business, state, or client, creating unmaintainable sprawl.

### For Providers (Indirect)

Enstellar reduces the electronic friction providers experience with PA by implementing the Da Vinci CRD/DTR/PAS standards natively, enabling EHR-integrated PA workflows that replace manual portal submission and fax.

---

## 3. Who It's For

### Primary Buyers

- **Health plans (payers)** operating Medicare Advantage, Medicaid managed care, commercial, or Exchange lines of business who need to modernize prior authorization operations and meet CMS-0057-F requirements.
- **Payer platform vendors** (Facets, QNXT, HealthEdge, Epic Payer, etc.) looking to offer a standards-compliant PA module rather than building one.

### End Users (Personas)

| Persona | Primary Activities |
|---|---|
| UM Intake / Coordinator | Monitors queues, resolves intake/completeness issues, manages provider communication |
| UM Nurse / Clinical Reviewer | Reviews cases against criteria with AI-assisted summaries; pends, requests information, approves within scope, or escalates |
| Medical Director / Physician Reviewer | Adjudicates escalations, conducts peer-to-peer, renders adverse determinations requiring clinical sign-off |
| Appeals & Grievances Specialist | Manages appeal intake, regulatory clocks, independent review, and overturn/uphold outcomes *(planned — P3)* |
| Payer Administrator | Configures workflows, queues, SLA targets, routing rules, and templates |
| Implementation Consultant | Configures LOB/program workflows, connectors, and conformance profiles per tenant |
| Support Engineer | Investigates stuck cases/transactions, replays events, traces incidents |

### Design Partner Profile

The immediate go-to-market target is a **UM team at a payer (or a pilot customer of a payer platform vendor)** that wants to run real PA end-to-end — from EHR-integrated CRD/DTR/PAS submission through human clinical review, determination, and provider notification — without appeals, on a hosted pilot instance.

---

## 4. What Has Been Built

The following represents the **current state of the codebase** as merged to `main` as of 2026-06-09. Every item in this section corresponds to implemented, tested code.

### 4.1 Foundation Layer

**Canonical Model & Code Generation**  
A JSON Schema–based shared canonical case model compiled at build time to Pydantic models (Python), TypeScript types, and Java records. All three language tiers bind to this single source of truth. Round-trip tests (serialize → deserialize → assert equal) validate fidelity in all three languages. Fields: `case`, `request`/`service_line`, `member`/`coverage`, `provider`, `decision`, `identifier`.

**Event Contracts**  
An AsyncAPI 2.6.0 catalog (`packages/event-contracts/asyncapi.yaml`) documents all 19 Kafka event channels. Every event is wrapped in a typed `EventEnvelope` carrying `event_id`, `tenant_id`, `case_id`, `correlation_id`, `type`, `occurred_at`, `actor`, `payload`, and `schema_version`. All channels are partitioned by `tenant_id`; no event crosses a tenant boundary. The `case.adverse.structured` channel is fully documented with payload schema and the `actor.type: [user]` invariant enforced at schema level.

**Identity & Authorization**  
- Keycloak 24 as the identity provider with a fully-configured `enstellar-realm.json` (realm, clients, roles, user federation points).
- **SMART on FHIR** (OAuth2 authorization-code with launch context and SMART scopes) for user-facing app launch.
- **SMART Backend Services** (client-credentials with asymmetric JWT client auth, registered JWKS) for system-to-system calls.
- A shared `enstellar_authz` Python package used by all Python services: JWT validation, tenant context extraction, FastAPI dependency injection, and scope enforcement.
- Java/Spring Security enforcement in the interop tier (Spring Security + HAPI interceptors).
- No FHIR endpoint is reachable without a valid, scoped token.

**Event Bus + Transactional Outbox**  
Kafka/Redpanda-backed event bus. The transactional outbox pattern (outbox table → relay poller → Kafka producer) guarantees at-least-once delivery of events with idempotent consumers. Outbox relay runs as a background task in the workflow engine.

### 4.2 FHIR Interoperability Layer (`services/interop`)

Built with **Java 21 + Spring Boot 3 + HAPI FHIR R4**.

**FHIR API Proxy**  
`FhirProxyFilter` transparently proxies all `/fhir/**` requests to a backing `hapiproject/hapi:v7.4.0` instance. On writes, it injects a `meta.security` tag containing the tenant ID. On searches, it appends a `_security` parameter to scope results to the calling tenant. Direct reads return 403 if the resource's security tag does not match the caller's tenant. This resolved TD-01 (custom FHIR storage) and enables full HAPI-native FHIR conformance.

**US Core 5.0.1 + Da Vinci PAS 2.0.1 IGs**  
Both implementation guides load into HAPI at startup via environment variable configuration (`hapi.fhir.implementationguides[*]`). Validated against a real HAPI Testcontainers instance in `HapiIgLoadIT`.

**PAS Operations (`Claim/$submit`, `Claim/$inquire`)**  
- `POST /fhir/Claim/$submit`: accepts a PAS-profiled FHIR Bundle, stores the raw bundle in MinIO, dispatches a normalization call to the workflow engine, and returns an appropriate `ClaimResponse` (synchronous approved response for auto-determinations; queued/pended acknowledgment for others).
- `POST /fhir/Claim/$inquire`: returns the current `ClaimResponse` for a case via its stored decision record.
- Decision records are persisted in a `decision_store` JPA table by a `DecisionEventConsumer` that listens on the `case.decision.recorded` Kafka topic.

**CapabilityStatement**  
Published at `/fhir/metadata`. Generated from runtime configuration (not hand-written). Reflects declared US Core + PAS profiles, supported search parameters, and SMART authorization endpoints.

**CRD — Coverage Requirements Discovery (CDS Hooks 2.0)**  
`GET /cds-services` — discovery endpoint listing available hooks (`order-select`, `order-sign`, `appointment-book`).  
`POST /cds-services/{hook-id}` — invokes the Digicore client for the submitted context (patient, coverage, request); maps the result to CDS Hooks cards including:  
- PA-required advisory card with coverage requirement details.
- DTR launch link card (SMART app launch URL) when documentation templates apply.  
Cards include the governing rule reference from Digicore.

**DTR — Documentation Templates and Rules**  
- `GET /fhir/Questionnaire/{id}` — serves payer DTR questionnaires sourced from Digicore.
- `POST /fhir/QuestionnaireResponse` — accepts completed questionnaire responses, assembles them into a PAS Bundle via `PasBundleAssembler`, and submits to `PasClaimSubmitProvider`.
- `/dtr/launch` — SMART app launch entry point.
- A custom `QuestionnaireRenderer` React component renders FHIR Questionnaire items in the browser (LHC-Forms was not used — unavailable on npm at build time).

**X12 Translator (sub-module `x12-translator`)**  
X12 278 (request/response) and 275 (attachments) intake. Produces a canonical case model functionally identical to an equivalent PAS FHIR submission. Round-trip regression suite validates fidelity. Raw X12 is retained in object store.

**Tenant Isolation**  
`TenantContextFilter` (Spring filter, order 10) extracts tenant ID from JWT on every request and populates `TenantContext`. `FhirProxyFilter` uses this to enforce per-tenant resource scoping. Integration tests assert that a tenant A token cannot read or search tenant B resources.

**Conformance Testing Infrastructure**  
A custom Inferno Docker image (`infra/compose/inferno/Dockerfile`) bundles US Core 5.0.1 and Da Vinci PAS 2.0.1 test kits as gems. `ConformanceTestAuthFilter` (property-guarded: `interop.conformance-test-mode=true`, never enabled in staging/prod) provides a static bearer token bypass for Inferno. `make conformance` runs both suites against the live stack and writes JSON results.

### 4.3 Workflow Engine (`services/workflow-engine`)

Built with **Python 3.12 + FastAPI + asyncpg + Alembic + Kafka**.

**State Machine**  
A configurable state machine drives the full PA lifecycle: `received` → `normalizing` → `completeness_check` → `auto_determination` → `queued` → `clinical_review` → `pend_rfi` → `escalated` → `determination` → `closed`. Transitions emit tenant-scoped `case.state.transitioned` events. Guards enforce invariants at every transition (e.g., adverse transitions require recorded human sign-off). State machine is metadata-driven; standard configuration changes do not require code changes.

**Adverse Transition Guard (Non-negotiable invariant)**  
The `ADVERSE_STATES` set is defined once in `guards.py` and imported everywhere. No code path may issue or be the sole basis for a denial/partial/adverse action without a recorded human (clinician) sign-off. The guard is tested by both unit tests and property-based fuzz tests that verify the invariant under arbitrary inputs. This test suite is declared sacred — no weakening is permitted.

**Normalization**  
`normalization/mapper.py` maps incoming PAS FHIR Bundles to canonical `Case` objects. `normalization/storage.py` persists the canonical case to PostgreSQL. Raw PAS bundles are stored in MinIO via `MinioRawBundleStore` in the interop tier with provenance links.

**Auto-Determination (Approve-only path)**  
When the Digicore decision service returns a favorable determination and all criteria are met, the workflow engine can automatically transition a case to `determination` with an `approved` outcome. This path is configured per workflow/LOB. The auto-determination path **never** produces a denial or adverse outcome — that path requires a human reviewer. Decision trace is pinned to the Digicore artifact version and is reproducible from event history.

**Triage & Assignment**  
Rules-based routing that assigns cases to queues and reviewers based on specialty, LOB, urgency, reviewer license/credential, and workload. The triage agent (agent layer) provides advisory routing suggestions; the engine makes the authoritative assignment.

**Pend / Request for Information (RFI)**  
`POST /cases/{id}/rfi` transitions a case to `pend_rfi`, pauses the SLA clock, and emits `case.rfi.sent`. The clock resumes when documentation is received. SLA clock pause/resume behavior is tested against representative rules. Integration tests validate that the clock-pause invariant holds.

**SLA Clocks**  
Configurable decision-timeframe clocks per LOB/urgency (expedited/standard/post-service). Clock model: each clock has `started_at`, `paused_at`, `paused_duration_s`, `deadline`, `is_breached`. SLA breach detection emits an alert event. Business-day calendars are configurable. Breach raises an escalation event.

**Escalation**  
`escalation/service.py` handles escalation routing to medical director / physician reviewer. Escalation state is tracked in the `signoff_queue` table (migration 0005). The adverse determination sign-off flow requires the escalation path for non-auto-approvals.

**Human Sign-off for Adverse Determinations**  
`signoff/service.py` manages the sign-off queue. An adverse determination transition requires a queued sign-off entry with a recorded actor ID (always derived from `auth["sub"]`, never from the request body). The `case.adverse.structured` event carries full structured payload: `determination_type`, `finding_sections`, `reason_code`, `citations`, `clinical_rationale`. Both `case.state.transitioned` and `case.adverse.structured` events are emitted in the same transaction.

**Communications / Notifications**  
`comms/service.py` generates provider and member communications using tenant-configurable templates (notification templates seeded via migration 0006). The `decision_recorded` consumer triggers communication generation on determination. Communications are delivered via configured channels.

**Case Criteria & AI Suggestions Storage**  
- `case_criteria` table (migration 0007): stores completeness gap analysis results from the Completeness agent, linked to case with `agent.assist.produced` provenance event.
- `case_suggestions` table (migration 0008): stores triage/routing suggestions from agents. Accept/Reject actions are recorded with `reviewer_id`, `reviewed_at`, and `agent.suggestion.reviewed` provenance event.

**Worklist API**  
`GET /worklist` — returns paginated cases sorted by SLA breach risk for a reviewer's assigned queue. `GET /queues/{id}/stats` — returns aggregate governance stats: `ai_determinations`, `adverse_human_signed_pct`, `sla_compliance_expedited_pct`. Accessible via the BFF.

**Database Migrations**  
8 Alembic migrations manage the workflow schema: outbox tables, workflow tables (cases, events, transitions, signoff queue), clocks, notification templates, case criteria, and case suggestions.

### 4.4 Agent Layer (`services/agent-layer`)

Built with **Python 3.12 + FastAPI + LangGraph**.

**Completeness Agent**  
`agents/completeness.py` — receives a case context (service lines, coverage, submitted documents, Digicore documentation requirements, Revital extracted evidence). Outputs a gap list with source citations and a draft RFI (advisory only). The guardrail engine gates all outputs before they are stored or acted upon.

**Triage Agent**  
`agents/triage.py` — receives case context and outputs a queue/reviewer routing suggestion with confidence score and citations. The workflow engine is always authoritative; the agent's output is advisory.

**Guardrail Engine**  
`guardrails/engine.py` + `guardrails/rules.py` — the gatekeeper between AI agent outputs and any downstream action. Rules include:  
- Block any agent output that resembles a denial or adverse recommendation.  
- Block any output that would directly modify case state.  
- Enforce PHI non-presence in model request payloads (asserted in tests).  
- Validate confidence thresholds and citation requirements.  
Outputs that fail guardrails are not stored. Abstained outputs are stored with `status=unknown`.

**Model Access Port**  
`model_access/` — an abstraction layer (base class, Anthropic adapter, Ollama adapter, factory) that resolves the inference endpoint from configuration. Models are config, not code. Commercial models (Claude via Anthropic API) and open-weight local models (via Ollama/vLLM) are supported. No model call participates in a coverage determination.

**Eval Harness**  
`evals/` — a full evaluation framework with:  
- Synthetic dataset (`evals/dataset/synthetic.py`) and file-based dataset loader.
- Metrics: completeness groundedness, precision, recall, abstention accuracy, routing accuracy, guardrail block rate, guardrail false-positive rate.
- Runner with mock and real-model adapters (`make eval` / `make eval-real`).
- Report module with JSON + Markdown output and run-over-run delta tracking.
- Latest results (mock adapter): 7/7 metrics PASSED (all at 1.00 / 0.00).
- **Note:** Real-model evals (against live Claude API) are not yet run as part of CI — this is SP7, held as post-pilot scope.

### 4.5 Integration Connectors (`services/integration-connectors`)

**Digicore Client**  
`digicore/client.py` — calls `POST /api/v1/decisions` with a canonical case context. Response: `{ decision, requirements, structured_trace }`. Circuit breaker + retry with exponential backoff. PHI-minimized before any call per config. For the pilot, calls against the mock Digicore service (`infra/compose/mocks/digicore/`).

**Revital Client (Advisory AI)**  
`revital/client.py` — calls `POST /api/v1/summarize` for advisory document summarization and evidence extraction. PHI minimization (`phi_minimizer.py`) strips/replaces PHI fields before the call per configured policy. Advisory contract enforced: Revital output never directly drives a state transition. Provenance event recorded on every call (model version, inputs, output hash, confidence). For the pilot, calls against the mock Revital service.

**Circuit Breaker**  
`circuit_breaker.py` — shared circuit breaker implementation used by both Digicore and Revital clients. Configurable threshold, timeout, and half-open retry.

### 4.6 Portal BFF (`services/portal-bff`)

Built with **Python 3.12 + FastAPI**. The BFF is the only backend the React UI talks to. It enforces auth, mediates calls to the workflow engine and FHIR layer, and never exposes internal URLs to the browser.

**Endpoints implemented:**
- `GET /bff/worklist` — reviewer worklist with SLA sorting.
- `GET /bff/cases/{id}` — full case detail (header, service lines, events timeline).
- `GET /bff/cases/{id}/criteria` — completeness gap list from the agent layer.
- `POST /bff/cases/{id}/criteria/suggestions/{id}/action` — Accept/Reject an AI suggestion.
- `GET /bff/cases/{id}/documents` — document list (proxied/pre-signed URLs, no raw FHIR internal URLs exposed).
- `POST /bff/cases/{id}/rfi` — initiate RFI (transitions case to `pend_rfi`, pauses clock).
- `POST /bff/cases/{id}/decision` — submit a determination (approve/adverse with structured payload).
- `GET /bff/queues/{id}/stats` — governance statistics.
- `GET /bff/crd/order-select` — trigger CRD coverage check.
- `GET /bff/dtr/launch` — DTR SMART app launch entry point.

### 4.7 Reviewer & Admin UI (`apps/web`)

Built with **TypeScript + React 18 + Vite + TanStack Query**.

**Pages implemented:**
- `WorklistPage` — reviewer worklist with SLA badges (`SlaCell`), queue filter, and case assignment. `WorklistTable` with SLA-aware sorting.
- `CasePage` — full case workspace: `CaseHeader` (case metadata, status, LOB), `ServiceLinesPanel` (service line items), `EventsTimeline` (unified event history from all sources), AI criteria accordion (completeness gaps with real data from Completeness agent), AI suggestion cards with Accept/Reject buttons and provenance recording, document panel with real document list.
- `EhrOrderSimPage` — EHR order simulator for design-partner demos: submits an order and triggers the CRD hook, showing the returned CDS cards (PA-required / DTR-launch).
- `DtrFormPage` — renders the DTR `Questionnaire` using a custom `QuestionnaireRenderer`, submits the completed `QuestionnaireResponse`, and transitions to PAS submission.
- `LandingPage` — product landing page.
- `DecisionForm` — approve/escalate determination capture (nurse reviewer scope).
- `MdAdverseForm` — full medical-director adverse determination form: captures `determination_type`, `finding_sections`, `reason_code`, `citations`, `clinical_rationale`, and submits the full structured adverse payload.

**Key frontend behaviors:**
- All API calls go through the BFF; no direct FHIR or workflow-engine calls.
- TanStack Query manages loading/error/mutation state throughout.
- RFI modal transitions case to `pend_rfi` and live-updates the worklist badge from "In review" to "Awaiting info".
- Governance stats rail shows live aggregates (not hardcoded).
- Auth via Keycloak OIDC.

### 4.8 Infrastructure & Local Stack

**Docker Compose (`infra/compose/docker-compose.yml`)**  
Full local development stack:

| Service | Image/Build | Purpose |
|---|---|---|
| `workflow-db` | postgres:16-alpine | Workflow engine PostgreSQL |
| `hapi-db` | postgres:16-alpine | HAPI FHIR PostgreSQL |
| `hapi` | hapiproject/hapi:v7.4.0 | Backing FHIR server |
| `interop` | build | Spring Boot FHIR proxy + PAS/CRD/DTR |
| `workflow-engine` | build | Python case lifecycle engine |
| `agent-layer` | build | Python LangGraph agent service |
| `portal-bff` | build | Python BFF |
| `web` | build | React reviewer UI |
| `redpanda` | redpandadata/redpanda:v24.1.7 | Kafka-compatible event broker |
| `minio` | minio/minio | Object store (raw bundles, attachments) |
| `opensearch` | opensearchproject/opensearch:2.14.0 | Case/event search |
| `redis` | redis:7-alpine | Cache |
| `keycloak` | quay.io/keycloak/keycloak:24.0.4 | Identity / SMART auth server |
| `ollama` | ollama/ollama | Local LLM inference (open-weight models) |
| `mock-digicore` | build | Mock coverage criteria / decision service |
| `mock-revital` | build | Mock AI summarization service |

All production Dockerfiles run as non-root users. `make smoke` verifies all critical health endpoints after `make up`.

**Conformance Profile**  
`docker-compose.conformance.yml` overlays to add the `inferno` service (custom image) and expose the stack for Inferno test suites. `make conformance` runs US Core v5.0.1 and Da Vinci PAS v2.0.1 suites.

**CI (GitHub Actions)**  
Three workflows:
- `ci.yml` — runs on every push/PR: compose validation, Makefile lint, event-contracts tests, workflow-engine tests, authz tests, interop/HAPI tests, canonical model round-trips (Python/TypeScript/Java), BFF tests, web type-check + Playwright, Revital client tests, agent-layer tests + evals, X12 translator tests, comms subsystem tests.
- `nightly.yml` — nightly: security scans (Semgrep SAST, gitleaks secrets, Trivy image CVEs, OWASP dependency check, pip-audit, npm audit), E2E full-stack (`make e2e`), conformance (`make conformance`). 45-minute timeout, 30-day artifact retention.
- `eval.yml` — on `workflow_dispatch`: runs `make eval` (mock adapter) and `make eval-real` (live Claude API, requires secret).

**Security Scanning**  
`make scan` runs: Semgrep (SAST, `--error`), gitleaks (secrets + history scan with baseline), Trivy (container image CVEs, HIGH/CRITICAL), OWASP Dependency Check (JVM), pip-audit (Python), npm audit. Suppression baselines committed to repo. Every suppression entry requires an expiry date. Non-root production images.

**End-to-End Test Suite**  
`make e2e` pipeline:
1. `e2e-seed`: seeds FHIR fixtures and a PA case via the live stack, writes `e2e-fixture-manifest.json`.
2. pytest path B: direct PAS `$submit`/`$inquire` flow (API-level).
3. Playwright path A: browser-driven CRD → DTR form → PAS submission → worklist → case review.
4. `e2e-teardown`: deletes seeded fixtures (idempotent).

Keycloak issuer fix in place (`KC_HOSTNAME_URL` + `KEYCLOAK_ISSUER_URI`). `e2e-reviewer` user and `roles_flat_mapper` configured in Keycloak realm.

---

## 5. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Provider / EHR Systems                                          │
│  (Epic, Cerner, AthenaHealth, etc.)                              │
└────────────┬────────────────────┬───────────────────────────────┘
             │ CDS Hooks          │ FHIR PAS / SMART App
             ▼                    ▼
┌────────────────────────────────────────────────────────────────┐
│  services/interop  (Java 21 / Spring Boot / HAPI FHIR R4)      │
│                                                                  │
│  FhirProxyFilter → hapiproject/hapi v7.4.0 (US Core + PAS IGs) │
│  PasClaimSubmitProvider  PasClaimInquireProvider                │
│  CdsServicesController (CRD)  DtrLaunchController (DTR)         │
│  X12Translator (278/275 intake)  DecisionEventConsumer          │
│  SecurityConfig (SMART on FHIR / Backend Services)              │
└──────────────────────────┬─────────────────────────────────────┘
                           │ Kafka  (case.intake.received + decisions)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  services/workflow-engine  (Python 3.12 / FastAPI / asyncpg)     │
│                                                                   │
│  State Machine (transitions, guards, clocks)                      │
│  Auto-Determination Engine (approve-only; trace pinned)           │
│  RFI / Pend / SLA clocks  Escalation  Sign-off queue             │
│  Normalization (FHIR→canonical)  Outbox relay  Comms service      │
│  Criteria & Suggestions storage  Worklist API  Queue stats        │
└────────┬─────────────────────────┬────────────────────────────────┘
         │ HTTP                    │ HTTP
         ▼                         ▼
┌─────────────────┐     ┌────────────────────────────────────────┐
│ services/       │     │  services/agent-layer                   │
│ integration-    │     │  (Python 3.12 / FastAPI / LangGraph)    │
│ connectors      │     │                                          │
│                 │     │  Completeness Agent  Triage Agent        │
│ Digicore client │     │  Guardrail Engine                        │
│ Revital client  │     │  Model Access Port (Anthropic / Ollama)  │
│ Circuit breaker │     │  Eval Harness (mock + real)              │
│ PHI minimizer   │     └────────────────────────────────────────┘
└─────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  services/portal-bff  (Python 3.12 / FastAPI)                │
│  (only backend the web UI talks to; enforces auth + tenant)  │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTPS
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  apps/web  (TypeScript / React 18 / Vite / TanStack Query)   │
│                                                               │
│  WorklistPage  CasePage  EhrOrderSimPage  DtrFormPage        │
│  DecisionForm  MdAdverseForm  EventsTimeline                 │
└──────────────────────────────────────────────────────────────┘

Shared data layer (all tenants scoped; no cross-tenant access):
  PostgreSQL (workflow DB + HAPI DB)
  Kafka / Redpanda  (event streaming)
  MinIO / S3  (raw bundles, attachments)
  OpenSearch  (case/event search)
  Redis  (cache)
  Keycloak  (identity / SMART auth server)
  Ollama  (local open-weight LLM)
```

**Deployment model (current):** containerized Docker Compose on a VM — suitable for the design-partner pilot. Helm charts and Terraform IaC are scaffolded (`.gitkeep` in place) but not implemented.

---

## 6. Feature Inventory: Built vs. Planned

### 6.1 Built and Working

| Feature Area | Status | Notes |
|---|---|---|
| PAS `$submit` (FHIR PA submission) | ✅ Built | US Core + PAS profiles; HAPI-backed |
| PAS `$inquire` (status/lookup) | ✅ Built | Returns ClaimResponse from decision store |
| CRD (CDS Hooks 2.0) | ✅ Built | order-select, order-sign, appointment-book |
| DTR (Questionnaire/QuestionnaireResponse) | ✅ Built | Serve + ingest; QuestionnaireRenderer in UI |
| X12 278/275 intake | ✅ Built | Canonical case identical to FHIR path |
| FHIR R4 proxy + US Core conformance | ✅ Built | HAPI v7.4.0 backing; IGs loaded |
| SMART on FHIR (app launch) | ✅ Built | Keycloak, scoped OAuth2 |
| SMART Backend Services (system-to-system) | ✅ Built | JWT client auth, JWKS |
| Canonical model (Java/Python/TS) | ✅ Built | JSON Schema → codegen → round-trip tested |
| Event bus + outbox | ✅ Built | Transactional, idempotent, at-least-once |
| Multi-tenant scoping | ✅ Built | All data, events, logs scoped by tenant_id |
| State machine (full PA lifecycle) | ✅ Built | Metadata-driven transitions |
| Auto-determination (approve-only) | ✅ Built | With rules trace + audit; no auto-adverse |
| Adverse transition guard (human sign-off) | ✅ Built | Non-negotiable invariant; property-tested |
| Pend / RFI | ✅ Built | SLA clock pause/resume; structured RFI |
| SLA clocks | ✅ Built | Configurable per LOB/urgency; breach detection |
| Triage & assignment | ✅ Built | Rules-based + agent-advisory routing |
| Escalation to medical director | ✅ Built | Sign-off queue + structured adverse capture |
| Communications / notifications | ✅ Built | Template-driven; triggers on determination |
| Digicore integration | ✅ Built (mock) | Real API contract; mocked for pilot |
| Revital integration (AI advisory) | ✅ Built (mock) | PHI-minimized; provenance recorded; mocked for pilot |
| Completeness agent | ✅ Built | Gap list + draft RFI (advisory); guardrail-gated |
| Triage agent | ✅ Built | Queue/reviewer suggestion (advisory) |
| Guardrail engine | ✅ Built | Blocks adverse outputs; PHI enforcement |
| Model access port | ✅ Built | Anthropic + Ollama adapters; models are config |
| Agent eval harness | ✅ Built | 7 metrics; mock adapter passing; real-model evals post-pilot |
| Reviewer worklist UI | ✅ Built | SLA-sorted; live queue stats |
| Case workspace UI | ✅ Built | Full lifecycle actions from single view |
| AI criteria panel (live) | ✅ Built | Real completeness gap data from agent |
| AI suggestions with Accept/Reject | ✅ Built | Provenance recorded per action |
| RFI modal (UI) | ✅ Built | Transitions case; live worklist update |
| MD adverse form (structured) | ✅ Built | Full structured payload to decision trace |
| EHR order simulator | ✅ Built | Demo/pilot: triggers CRD, shows cards |
| DTR form page | ✅ Built | Custom renderer; submits to PAS |
| Events timeline | ✅ Built | Unified history in case workspace |
| Document panel (live) | ✅ Built | Real document list; proxied URLs |
| AsyncAPI event catalog | ✅ Built | 19 channels; `case.adverse.structured` fully documented |
| Inferno conformance CI gate | ✅ Built | US Core 5.0.1 + PAS 2.0.1; nightly |
| Security scan pipeline | ✅ Built | Semgrep, gitleaks, Trivy, OWASP, pip-audit |
| Full-stack E2E tests | ✅ Built | Two paths: direct PAS (pytest) + CRD→DTR (Playwright) |
| Containerized local stack | ✅ Built | make up / make smoke; all services healthy |
| PHI redaction in logs | ✅ Built | Structured PHI-redacted logging throughout |

### 6.2 Planned / Not Yet Built

| Feature Area | Phase | Notes |
|---|---|---|
| **Appeals & grievances lifecycle** | P3 (next) | Appeal intake, regulatory clocks by LOB/state, independent reviewer assignment, overturn/uphold, case reopening |
| **Patient Access API** | P4 | CMS-0057-F; US Core + PDex + CARIN BB |
| **Provider Access API** | P4 | CMS-0057-F; PDex + ATR + Bulk Data |
| **Payer-to-Payer API** | P4 | CMS-0057-F; PDex + SMART Backend Services |
| **Provider Directory API (Plan-Net)** | P4 | CMS-0057-F; unauthenticated public read |
| **Bulk Data Access (`$export`)** | P4 | Flat FHIR; NDJSON; for Provider Access + P2P |
| **FHIR Subscriptions (status notifications)** | P4 | R4 Subscriptions Backport IG |
| **Real Digicore integration** | Pilot→prod | Mock in place; real API contract ready |
| **Real Revital integration** | Pilot→prod | Mock in place; PHI-minimized contract ready |
| **Agent evals vs. real Claude API in CI** | SP7 / post-pilot | Harness built; real-model CI job not wired |
| **Gold-carding / provider-trust waivers** | v2.0 | Configuration-layer feature |
| **Concurrent/inpatient review** | v2.0 | Engine designed to support; not configured |
| **Referral management** | v2.0 | Engine designed to support; not configured |
| **Claims attachments (CDex)** | v2.0 | CDex Task-based requests; out of v1 scope |
| **UDAP (B2B dynamic registration)** | Future | Being evaluated for Provider Access / P2P trust |
| **TEFCA / QHIN participation** | Future | Roadmap; no implementation started |
| **Helm charts** | Pre-prod | Scaffolded (.gitkeep); not implemented |
| **Terraform IaC** | Pre-prod | Scaffolded (.gitkeep); not implemented |
| **Provider-facing status portal UI** | Future | API endpoints exist; no standalone UI built |
| **PA public-metrics reporting** | P1.1 | Data exists in events; reporting surface not built |
| **Multi-LOB/state clock profiles (full set)** | Configuration | Clock model built; only sample profiles configured |
| **Peer-to-peer scheduling** | P1 roadmap | Workflow state exists; scheduling/calendar integration not built |
| **WCAG AA accessibility audit** | Pre-prod | UI built; no formal accessibility audit done |

---

## 7. Standards & Regulatory Compliance

### What Is Implemented

| Standard | Status | Notes |
|---|---|---|
| FHIR R4 (4.0.1) | ✅ | HAPI v7.4.0 backing |
| US Core 5.0.1 | ✅ | IG loaded; Inferno suite in CI |
| Da Vinci PAS 2.0.1 | ✅ | IG loaded; Inferno suite in CI; $submit/$inquire |
| Da Vinci CRD (CDS Hooks 2.0) | ✅ | order-select, order-sign, appointment-book |
| Da Vinci DTR | ✅ | Questionnaire + QuestionnaireResponse |
| SMART on FHIR (app launch) | ✅ | Keycloak; OAuth2 + SMART scopes |
| SMART Backend Services | ✅ | JWT client auth; JWKS |
| X12 278 (request/response) | ✅ | Canonical round-trip |
| X12 275 (attachments) | ✅ | Canonical round-trip |
| CMS-0057-F — Prior Authorization API | ✅ (CRD+DTR+PAS) | The burden-reduction trio is the core |
| CMS-0057-F decision timeframes | ✅ (engine) | Configurable clocks; expedited/standard |
| AsyncAPI 2.6.0 (event contracts) | ✅ | 19 channels documented |

### What Is Not Yet Implemented

| Standard | Status | Notes |
|---|---|---|
| CMS-0057-F — Patient Access API | ❌ P4 | US Core + PDex + CARIN BB; not started |
| CMS-0057-F — Provider Access API | ❌ P4 | PDex + ATR + Bulk; not started |
| CMS-0057-F — Payer-to-Payer API | ❌ P4 | PDex + SMART Backend; not started |
| CMS-0057-F — Provider Directory API | ❌ P4 | Plan-Net; not started |
| Da Vinci PDex | ❌ P4 | Payer data exchange; not started |
| Da Vinci Plan-Net | ❌ P4 | Provider directory; not started |
| Da Vinci ATR | ❌ P4 | Member attribution; not started |
| Da Vinci CDex | ❌ v2.0 | Clinical data exchange / attachments |
| Bulk Data Access ($export) | ❌ P4 | Required for Provider Access / P2P |
| FHIR Subscriptions (Backport IG) | ❌ P4 | PA status notifications |
| UDAP | ❌ Future | B2B trust / dynamic client registration |
| TEFCA / QHIN | ❌ Future | Nationwide exchange |

### Conformance Note

The current Inferno CI gate validates US Core 5.0.1 and PAS 2.0.1 on the proxy + HAPI backend. Advanced FHIR search features (`_include`, `_revinclude`, chained references, `_history`) depend on the backing HAPI instance passing those Inferno tests — which HAPI supports natively. TD-01 (custom FHIR storage) is resolved; HAPI is now authoritative for FHIR resource operations.

---

## 8. Security, Privacy & AI Governance

### What Is Enforced

- **No PHI in logs:** Structured logging throughout; PHI fields redacted before any log emission.
- **No PHI in model requests without redaction:** PHI minimizer (`phi_minimizer.py`) strips/replaces PHI before Revital calls, per configured policy. Asserted by test.
- **No cross-boundary inference:** Model access port resolves to tier-authorized endpoints. No cross-boundary egress.
- **No autonomous adverse determinations:** Enforced at the transition guard layer, tested by property-based fuzz tests. This invariant has zero tolerance for weakening.
- **No LLM call on the decision path:** AI agents are advisory tools invoked at designated workflow nodes. The guardrail engine gates all agent outputs before they can influence state.
- **Non-root containers:** All production Dockerfiles run services as non-root users.
- **Secrets management:** gitleaks scanning in CI + nightly with baseline; no secrets committed.
- **Supply chain:** Trivy image CVE scanning, OWASP Dependency Check (JVM), pip-audit, npm audit — all in nightly CI.
- **SAST:** Semgrep auto + project rules, error on HIGH/WARNING.
- **AI output provenance:** Model version, prompt/template version, inputs, output, and reviewer action (accept/override + reason) recorded per case interaction.
- **Per-tenant disable of AI:** The guardrail engine and all agent invocations are skippable per tenant/workflow configuration.
- **Tenant isolation:** All data, events, API responses, and log lines are scoped to `tenant_id`. Cross-tenant access is rejected at the FHIR proxy (403), workflow engine (query-level), and BFF (auth context).

### Known Security Gaps (Pre-Prod Blockers)

**TD-02 — CRD CDS Hooks unauthenticated for external callers (HARD pre-prod gate)**  
`/cds-services` uses `permitAll` transport and trusts `X-Tenant-Id` from the header, ignoring the CDS Hooks `fhirAuthorization` SMART Backend token. Acceptable for the pilot (all calls come through the in-house EHR simulator via the authenticated BFF). **Must be fixed before CRD is exposed to any real/external EHR.** Fix: validate `fhirAuthorization` JWT and derive tenant from validated token; register EHR clients → tenant mapping.

---

## 9. Known Limitations & Tech Debt

### TD-01 — Advanced FHIR Search (Resolved at storage layer, residual capabilities gap)

The custom FHIR storage layer (the original `fhir_resource` table + custom ResourceProviders) has been **removed** and replaced by the HAPI proxy. HAPI natively supports `_include`, `_revinclude`, `_sort`, `_count`, pagination, conditional create/update, and resource versioning. These capabilities now exist at the HAPI layer. The limitation is now only that the proxy doesn't add any additional search capability beyond what HAPI provides.

### TD-02 — CRD Auth (Critical Pre-Prod Gate)

Described in §8. Must be resolved before any real EHR connects to the CRD endpoint.

### Real Connector Integrations Are Mocked

Both Digicore (coverage criteria / decision service) and Revital (AI summarization) are connected via mock services for the pilot. The API contracts, circuit breakers, PHI minimizers, and integration patterns are production-grade. But until the real Digicore and Revital services are available and configured per the design-partner environment, the system cannot make real coverage determinations or real AI-assisted reviews.

### Agent Evals Against Real Models Not in CI

The eval harness is complete and the mock-adapter results pass all 7 metrics. `make eval-real` runs against the live Claude API but requires `ANTHROPIC_API_KEY` and is not wired into the nightly CI job (SP7). This means agent behavior with the real model has not been systematically validated against the eval dataset. This is a design-partner readiness gap for any claim about AI-assist quality.

### Appeals Lifecycle Not Built (P3)

The full appeals and grievances workflow is **designed** (state machine supports a reopening/appeal state; event contracts include `case.appealed`) but not implemented. The current platform handles the PA lifecycle through determination only.

### No Helm/Terraform

The `infra/helm/` and `infra/terraform/` directories are scaffolded but empty. Deployment beyond `docker-compose on a VM` requires additional infrastructure work.

### DTR: LHC-Forms Not Used

The DTR `QuestionnaireRenderer` is a custom React implementation. LHC-Forms (the standard HL7-endorsed questionnaire rendering library) was not available on npm at build time, so a custom renderer was written. This may have incomplete support for all Questionnaire item types and enableWhen logic in complex questionnaires. A migration to LHC-Forms is the recommended path before supporting complex payer questionnaires in production.

### X12 Companion Guide Variability

The X12 translator handles standard 278/275 formats. Trading-partner-specific companion guide variations (different loop structures, custom qualifiers, segment-level overrides) are modeled as configuration but have not been validated against any specific trading partner or clearinghouse. Real trading-partner X12 connectivity requires clearinghouse configuration.

---

## 10. What Must Be Done to Go to Market

This section distinguishes between what is needed to run the **design-partner pilot** versus what is needed for **GA**.

### For Design-Partner Pilot (Next Milestone)

These items are either already complete or are small-scope work:

| Item | Status | Effort |
|---|---|---|
| Real Digicore connection configured for pilot tenant | Blocked on Digicore availability | External dependency |
| Real Revital connection configured for pilot tenant | Blocked on Revital availability | External dependency |
| Pilot tenant Keycloak realm + user provisioning | ✅ Framework in place | Config work |
| VM provisioning + compose deployment | ✅ Dockerfiles + compose done | Ops work |
| E2E User credentials (`E2E_USER` / `E2E_PASSWORD`) configured as GitHub secrets | Config only | Minutes |
| Design-partner onboarding: LOB/clock/workflow config | Template available | Implementation consulting |
| Agent evals vs. real Claude API (SP7) | Harness ready; not run | 1–2 days |
| QA pass on CRD→DTR→PAS browser path end-to-end | Partially covered by Playwright; needs human verification | Days |
| Accessibility quick-audit on reviewer workspace | Not done | Days |
| Production Keycloak hardening (remove CI test overlay) | CI overlay still mounted | Config |

### For General Availability

Beyond the pilot, the following are required before marketing to additional payers:

| Item | Category | Notes |
|---|---|---|
| **TD-02 fix: CRD CDS Hooks authentication** | **Hard security gate** | Must validate SMART Backend token before any external EHR connects |
| **Appeals & grievances lifecycle (P3)** | Functional gap | No compliant product without appeals |
| **Helm charts + Terraform** | Operability | VM/compose not scalable; customers need K8s/cloud deployment |
| **CMS-0057-F Patient Access API (P4)** | Regulatory | Required for MA/Medicaid plans under 0057-F |
| **CMS-0057-F Provider Access API (P4)** | Regulatory | Required under 0057-F |
| **CMS-0057-F Payer-to-Payer API (P4)** | Regulatory | Required under 0057-F |
| **PA public-metrics reporting** | Regulatory | 0057-F requires public reporting of PA approval/denial/appeal rates |
| **Production Keycloak / IdP federation** | Security | Current realm is dev; production needs SAML/OIDC federation per payer IdP |
| **Multi-tenant admin UI** | Operability | No UI for payer admins to configure workflows, queues, templates, clocks |
| **Real connector integrations (Digicore + Revital)** | Functional | Mocked for pilot; must be real for production |
| **LHC-Forms migration for DTR** | Standards fidelity | Custom renderer may not handle all Questionnaire complexity |
| **WCAG AA accessibility audit** | Compliance | Required for healthcare enterprise software |
| **SLA profiles for in-scope LOB/states** | Configuration | Clock model is generic; real CMS/state timeframes need profiled |
| **Agent evals vs. real models in CI (SP7)** | Quality gate | Required before claiming AI-assist quality |
| **Performance / load testing** | Non-functional | No load tests run; <2s UI / <1s FHIR targets not validated under load |
| **Disaster recovery & backup procedures** | Operability | Not documented or tested |
| **BAA + HIPAA compliance documentation** | Legal | Required for any production PHI handling |
| **SOC 2 Type I/II** | Enterprise sales | Required by most payer procurement processes |
| **Core admin platform connector (Facets/QNXT/etc.)** | Integration | Eligibility, coverage, claims linkage depend on this |
| **Document/fax intake (OCR handoff)** | Intake channel | Portal and X12 channels are built; fax/OCR integration not started |

---

## 11. Release Roadmap

| Phase | Scope | Status |
|---|---|---|
| **P0 — Foundation + Walking Skeleton** | Monorepo, CI, identity, event bus, FHIR API, PAS happy path, normalization, workflow skeleton, auto-determination | ✅ Complete |
| **P1 — PA Core (Full UM lifecycle, no appeals)** | Worklists + UI, pend/RFI/clocks, agent layer + guardrails, Revital client, triage + escalation + sign-off, comms + X12 intake | ✅ Complete |
| **P2 — UI Backend Wiring** | Criteria/suggestion panels wired to real agents, RFI modal, governance stats, document panel, adverse structured payload | ✅ Complete |
| **Design-Partner Readiness** | CRD, DTR, Conformance CI (Inferno), Security gate, E2E test suite, Deployability | ✅ Complete (SP7 post-pilot) |
| **P3 — Appeals & Grievances** | Appeal intake, regulatory clocks by LOB/state, independent reviewer, overturn/uphold, reopening | ❌ Not started |
| **P1.1 — PA Public Metrics** | Approval/denial/appeal-overturn rates, average decision time, CMS reporting surface | ❌ Not started |
| **P4 — CMS API Set** | Patient Access, Provider Access, Payer-to-Payer, Provider Directory, Bulk Data, Subscriptions | ❌ Not started |
| **v2.0 — Adjacent Use Cases** | Concurrent review, referrals, claims attachments (CDex), gold-carding | ❌ Not started |

---

## 12. Competitive Positioning

### What Enstellar Does Well (Differentiated)

1. **Standards-first, not CMS-compliance-first.** The interoperability layer is built on the underlying FHIR R4 / US Core / Da Vinci IGs, not as a checkbox for CMS-0057-F. This means the same engine is reusable for non-mandated exchange (PCDE, CDex, Provider Access) without re-platforming. Competitors built to specific rules often require significant rework when those rules change or when a customer needs an adjacent use case.

2. **Governed AI, not autonomous AI.** Enstellar's AI architecture is designed for regulatory defensibility. Agents are advisory tools with typed, cited, guardrail-gated outputs. The "no autonomous adverse determination" invariant is encoded at the engine level, not as a policy document. This is the right architecture for an environment where AI-in-UM is under active legislative scrutiny.

3. **Deterministic decision path.** No LLM call participates in a coverage determination. The rules trace is reproducible: every determination links to the exact policy version, criteria, questionnaire, and evidence path. This is auditable at the case level, not just at the aggregate.

4. **Multi-tenant without per-tenant forks.** Tenant context propagates through every request, query, event, and log line. Workflows, queues, SLA targets, routing, templates, and conformance profiles are metadata-driven per tenant. Two tenants with different PA workflows run on the same codebase.

5. **Deployment-tier aware.** The platform runs identically across pooled (shared infrastructure), siloed (per-customer dedicated infra), and boundary (FedRAMP, Medicaid data boundary) tiers. Connectors and inference endpoints resolve per boundary. This is a commercial requirement for selling into Medicaid and government programs.

6. **All PA entry paths.** Both EHR-integrated CRD→DTR→PAS (provider workflow reduction) and direct PAS/X12 (legacy channel support) are built and E2E tested. Most PA vendors support one or the other; Enstellar supports both, which is a practical requirement given the EHR adoption reality.

### Where Enstellar Is Not Yet Competitive

1. **No appeals module.** Any enterprise PA platform RFP will require a complete appeals and grievances lifecycle (P3). This is a significant functional gap relative to incumbent PA platforms.

2. **CMS full API set incomplete.** CMS-0057-F compliance requires Patient Access, Provider Access, and Payer-to-Payer APIs in addition to the Prior Auth API. Enstellar has only the Prior Auth API (CRD/DTR/PAS). A payer under 0057-F cannot claim compliance with Enstellar alone at this stage.

3. **No production deployment option.** VM/compose is a pilot vehicle, not an enterprise deployment option. Helm/Terraform and SRE runbooks are needed for production.

4. **No core admin connector.** Eligibility, accumulator, and claims linkage depend on integration with the payer's core admin platform (Facets, QNXT, HealthEdge, etc.). Without this, the system cannot perform eligibility-aware coverage discovery for real member/plan combinations.

5. **No SaaS admin layer.** Tenant configuration, user provisioning, workflow authoring, and SLA profile management require direct database access or scripting today. An admin UI is needed before a payer's implementation team can self-serve.
