# Simintero Platform — System Architecture Document

| | |
|---|---|
| **Document** | Simintero Platform Architecture (SAD) |
| **Version** | 0.1 — Draft for architecture review board |
| **Source PRD** | `simintero_multitenant_saas_prd_v2.md` (+ Enstellar, Digicore, Qualitron, Revital module PRDs) |
| **Audience** | Engineering, platform/SRE, security, product, implementation leadership |
| **Status** | Proposed — decisions marked **[ADR-n]** require ratification |

---

## 1. Purpose & scope

This document defines the target-state technical architecture for Simintero: a payer-focused, multi-tenant SaaS platform delivering interoperability and UM workflow (Enstellar), executable policy (Digicore), quality and care-gap intelligence (Qualitron), and governed AI review assistance (Revital) on one product foundation with three deployment tiers (pooled, dedicated, government enclave).

It translates the PRD's "one product, one control plane, multiple data planes" mandate into concrete structural decisions: the platform substrate every module builds on, the contracts between modules, the canonical data model, the eventing backbone, the FHIR/standards layer, the AI service architecture, the isolation model, and the engineering operating model (including an AI-assisted, contract-first development approach designed for agentic coding tools).

**In scope:** logical, data, integration, security, deployment, and operational architecture; technology selections with build-vs-buy rationale; phase alignment to the PRD roadmap (Phase 0–4).
**Out of scope:** detailed API specifications (separate Interface Control Documents per §9), infrastructure-as-code detail, pricing/packaging.

## 2. Architecture goals & constraints

Derived from the PRD's product principles and NFRs:

| # | Goal | Architectural consequence |
|---|---|---|
| AG-1 | One codebase, three deployment tiers, zero divergence | All tier variation is **configuration + topology**, never code branches. Tier-awareness is a platform concern, invisible to domain logic. |
| AG-2 | Configuration over customization | Workflows, rules, questionnaires, measures, clocks, templates are **metadata artifacts** executed by engines — never per-tenant code. |
| AG-3 | Explainability & auditability by design | Immutable event/audit backbone and a **single provenance schema** spanning rules trace, AI citations, and measure evidence. |
| AG-4 | Human-in-the-loop for sensitive decisions | Adverse-action sign-off enforced **structurally** (workflow guards + policy engine), not by UI convention. |
| AG-5 | Standards-first, legacy-compatible | FHIR R4/US Core/Da Vinci as the external contract; X12 translated at the edge through a lossless canonical model. |
| AG-6 | Strict tenant isolation in shared infrastructure | Defense-in-depth: token-scoped tenancy → service-level authorization → row-level security → encryption, per §15. |
| AG-7 | 99.9% availability, <2s UI median, <1s API median, sub-second rules evaluation | Read-optimized projections, compiled rule execution (ELM), async-by-default for heavy work. |
| AG-8 | Operable as an enterprise SaaS | Tenant-aware observability, replay, support consoles, and FinOps telemetry are first-class platform services, not afterthoughts. |

**Constraints:** HIPAA/BAA from day one; SOC 2 Type II targeted within 12 months of GA; HITRUST and FedRAMP-aligned enclave deferred until contractually required; PHI never crosses a deployment boundary (including AI inference); licensed clinical content (InterQual/MCG) integrated by reference only.

## 3. Key architecture decisions (ADR summary)

Each decision below has a full ADR in the repo (`/docs/adr/`); this is the ratification list.

| ADR | Decision | Rationale (condensed) | Alternatives rejected |
|---|---|---|---|
| ADR-1 | **Modular monolith per domain, deployed as ~12–15 services — not microservices-per-capability** | Team size and Phase 0/1 scope make a 50-service mesh an operational liability. Domain modules (Enstellar, Digicore, Revital, Qualitron) are separate deployables with hard API/event boundaries; internal decomposition stays in-process until scale demands extraction. | Fine-grained microservices (premature); single monolith (kills independent module release & tier topology) |
| ADR-2 | **Control plane / data plane split; data planes are cells** | The PRD's three tiers map cleanly onto cell-based architecture: pooled = multi-tenant cell, dedicated = single-tenant cell, enclave = cell in a separate boundary (e.g., GovCloud). One control plane governs all cells. | Per-tier codebases (explicitly a PRD non-goal); pure logical isolation only (fails dedicated/enclave triggers) |
| ADR-3 | **Event backbone (Kafka-compatible) with transactional outbox; case lifecycle is event-sourced** | The PRD requires immutable event history, replay, Qualitron's consumption of Enstellar's stream, and support-console diagnostics — all natural consequences of an event-sourced case model. | CRUD + audit table (loses replay/reconstruction); full ES everywhere (overkill outside case/policy lifecycles) |
| ADR-4 | **PostgreSQL with row-level security (RLS) as primary store; tenant_id mandatory on every row, every event, every log line** | Proven HIPAA-grade isolation pattern; RLS enforced at the DB as the last line of defense behind service-level authz. Pooled→dedicated migration = schema-identical database move. | Database-per-tenant in pooled tier (operational sprawl at scale); NoSQL primary (weak relational/audit fit) |
| ADR-5 | **Buy/adopt the heavy substrate: Temporal (durable workflow), HAPI FHIR (facade/persistence), cqf-ruler-lineage CQL/ELM engine, Ontoserver or HAPI tx (terminology), Keycloak (identity), OPA (policy/authz)** | These are multi-year builds with mature OSS/commercial options. Simintero's IP is the domain layer (UM lifecycle, policy governance, governed AI, quality fabric), not infrastructure. | Build-everything (PRD Phase 0/1 timeline impossible); workflow-as-library only (loses durability/replay) |
| ADR-6 | **One canonical data model, FHIR-aligned (US Core profiles), shared by all four modules — the "evidence fabric" is this model + the event stream + the document store, not a fifth system** | Qualitron's strategic premise ("measure data in place") and the cross-module evidence package both die if module data models diverge. | Per-module models with sync (guaranteed divergence); raw FHIR resources as internal model (too lossy for UM operations — see §10) |
| ADR-7 | **Single provenance/trace schema across rules trace (Digicore), AI citations (Revital), and measure evidence (Qualitron)** | The flagship audit/appeal evidence package is only buildable if every "why" record shares one shape. | Three trace formats stitched at export (brittle, lossy) |
| ADR-8 | **AI inference through a platform Model Gateway; Revital owns no model endpoints directly** | Boundary-resolved endpoints, no-train enforcement, PHI minimization, key management, and per-tenant disable are platform-wide controls. This is also what makes the enclave viable (same app, authorized endpoints). | Per-module LLM clients (governance bypass risk; enclave rework) |
| ADR-9 | **Versioned Knowledge Artifact Service (VKAS) — one engine for versioning, effective-dating, approval, promotion, rollback — used by policy, workflow definitions, measures, prompts, and templates** | Four modules independently need identical artifact-lifecycle machinery; building it once is the single highest-leverage de-duplication in the platform. | Each module builds its own (4× cost, 4 audit schemas, inconsistent governance) |
| ADR-10 | **Contract-first, monorepo, spec-driven development optimized for agentic AI coding** | Inter-module contracts as versioned OpenAPI/FHIR/AsyncAPI specs with generated clients and contract tests are simultaneously the platform's integration discipline and the highest-leverage structure for AI coding agents (§19). | Polyrepo + informal contracts (drift; agents lack global context) |

## 4. System context (C4 Level 1)

```
                                ┌──────────────────────────────────────────────┐
   Provider / EHR systems ──────┤                                              │
   (CRD hooks, DTR SMART app,   │                                              │
    PAS $submit/$inquire)       │                                              │
                                │                                              │
   Clearinghouses / X12 ────────┤                                              ├───── Core admin platforms
   (278/275, 27x)               │                SIMINTERO                     │      (Facets, QNXT, HealthEdge:
                                │           payer operating platform           │       eligibility, member/provider,
   Provider portal & fax/OCR ───┤                                              │       claims linkage, accumulators)
                                │   Enstellar · Digicore · Qualitron · Revital │
   Members / Patient Access ────┤        on the Platform Substrate             ├───── Licensed content vendors
   (SMART on FHIR apps)         │                                              │      (InterQual, MCG — by reference)
                                │                                              │
   Other payers ────────────────┤                                              ├───── Terminology authorities
   (Payer-to-Payer PDex)        │                                              │      (VSAC/UMLS, code systems)
                                │                                              │
   Regulators / auditors ───────┤                                              ├───── Identity providers
   (PA metrics, evidence pkgs)  │                                              │      (tenant SAML/OIDC)
                                └──────────────┬───────────────────────────────┘
                                               │
                                  Model providers (commercial endpoints;
                                  authorized/GovCloud endpoints in enclave)
```

**Actors:** UM intake coordinators, nurse reviewers, medical directors, appeals specialists, policy analysts, clinical informaticists, quality/Stars analysts, payer administrators (external); SaaS ops, implementation, support, SRE, AI-ops (internal).

## 5. Tenancy & deployment architecture

### 5.1 Control plane / data plane

```
┌─────────────────────────── CONTROL PLANE (one, global) ───────────────────────────┐
│  Tenant Registry · Entitlement Service · Tier/Cell Assignment · Provisioning API  │
│  Release Orchestrator (tier-aware) · Feature Flags · Billing/Usage Aggregation    │
│  Fleet Observability Rollup · Support Policy Engine · Config Promotion Pipeline   │
│  ── contains NO PHI; metadata only; reachable from all cells via mTLS ──          │
└────────────┬──────────────────────────┬───────────────────────────┬───────────────┘
             │                          │                           │
   ┌─────────▼──────────┐    ┌──────────▼─────────┐    ┌────────────▼─────────────┐
   │   POOLED CELL(s)   │    │  DEDICATED CELL    │    │   ENCLAVE CELL           │
   │  multi-tenant      │    │  single tenant     │    │  separate boundary       │
   │  shared app + DB   │    │  isolated runtime  │    │  (e.g., GovCloud/Azure   │
   │  (RLS isolation)   │    │  + data plane      │    │   Gov), authorized       │
   │  N tenants/cell,   │    │  same artifacts,   │    │   inference endpoints,   │
   │  cell capacity cap │    │  own maint. window │    │   segmented ops views    │
   └────────────────────┘    └────────────────────┘    └──────────────────────────┘
        Every cell runs the IDENTICAL release artifact set (containers + config).
        Tier differences are: topology, endpoint resolution, release cadence policy.
```

Principles:

- **A cell is the unit of blast radius, capacity, and tier.** Pooled cells host N tenants behind RLS; when a tenant trips a dedicated-tier trigger, migration = provision a new cell + replicate that tenant's data (schema-identical) + cut over routing at the gateway. No application change.
- **The control plane never stores PHI.** It holds tenant metadata, entitlements, tier assignments, release state, and aggregated (de-identified) usage/health telemetry. This keeps the control plane outside the enclave's compliance boundary while still governing it — for the enclave, the control plane issues *desired state* and receives *attestations/health summaries*; enclave operators apply changes within the boundary (federated operations per the PRD).
- **Routing:** a global edge layer resolves `tenant → cell` from the Tenant Registry; tenant context is bound into the access token (see §14) and propagated as a signed claim on every hop.
- **Naming:** this document standardizes on the module PRDs' terms — **pooled / dedicated / enclave** (the platform PRD's "shared/dedicated tenant/government enclave" map 1:1). One taxonomy should be ratified and used everywhere.

### 5.2 Environment model

Per tenant: **sandbox → UAT → production** tenant variants (PRD requirement), implemented as logically distinct tenants linked in the registry, so the Config Promotion Pipeline can diff/promote artifacts between them. Platform-side: dev → staging → prod per cell fleet, with the staging fleet running a canary pooled cell populated by synthetic tenants.

## 6. Logical architecture (C4 Level 2)

```
┌────────────────────────────── EXPERIENCE LAYER ──────────────────────────────────┐
│  Reviewer Workspace · Policy Studio · Quality Console · Admin Portal ·           │
│  Provider Status Views · SaaS Admin · Support Console · AI Ops Console          │
│  (Single design system; module UIs are apps in one shell with shared           │
│   timeline, search, notifications, saved views, export center)                  │
└──────────────┬───────────────────────────────────────────────────────────────────┘
               │  BFF / GraphQL gateway (tenant-scoped, RBAC-filtered)
┌──────────────▼───────────────────  DOMAIN LAYER  ────────────────────────────────┐
│                                                                                  │
│  ENSTELLAR (E)              DIGICORE (D)            QUALITRON (Q)   REVITAL (R)  │
│  ├ Intake & Channel Svc     ├ Artifact Registry     ├ Measure       ├ Ingestion  │
│  │  (PAS, X12, portal, fax) ├ Authoring Svc (CQL,   │  Execution    │  & Parsing │
│  ├ Case Service (event-     │  Questionnaire, CRD)  │  Svc (ELM)    ├ Extraction │
│  │  sourced canonical case) ├ Governance Svc        ├ Gap Detection ├ Grounded   │
│  ├ UM Workflow Svc          │  (approval, attest)   ├ Evidence      │  Summarizer│
│  │  (Temporal-backed        ├ Simulation/Impact Svc │  Aggregation  ├ Evidence-  │
│  │   state machine)         ├ Runtime Decision Svc  ├ Reporting &   │  to-Criteria│
│  ├ Regulatory Clock Svc     │  (CRD/DTR/$evaluate   │  Submission   │  Mapper    │
│  ├ Communication Svc        │   + trace)            ├ Projection    ├ Triage     │
│  ├ Appeals Svc              └ (publishes via VKAS)  └ Analytics     │  Advisor   │
│  └ Reviewer Workspace API                                           └ Eval & HF  │
│                                                                        Queue Svc │
└──────┬────────────────────────────┬──────────────────────────┬──────────┬────────┘
       │ commands/queries           │ artifacts                │ events   │ inference
┌──────▼────────────────────────────▼──────────────────────────▼──────────▼────────┐
│                              PLATFORM SUBSTRATE                                   │
│  Identity & Tenant Context  ·  Entitlements/Flags  ·  AuthZ (OPA policy engine)  │
│  Event Backbone (Kafka) + Schema Registry + Outbox  ·  Audit Service (immutable) │
│  VKAS — Versioned Knowledge Artifact Svc (version/effective-date/approve/        │
│         promote/rollback for ALL artifact types)                                 │
│  Provenance Service (one trace schema)  ·  Document Service (store, OCR,        │
│  classification, redaction, retention)  ·  Terminology Service ($expand/$validate│
│  -code, VSAC sync, ConceptMaps)  ·  Task & Worklist Service  ·  Notification Svc │
│  Search Service (tenant-partitioned index)  ·  Model Gateway (boundary-resolved  │
│  inference, registry, no-train, redaction)  ·  Scheduling/Business Calendars     │
└──────┬────────────────────────────────────────────────────────────────────────────┘
┌──────▼─────────────────────── INTEGRATION LAYER ──────────────────────────────────┐
│  FHIR Facade (R4, US Core, Da Vinci IGs; CapabilityStatement from runtime config) │
│  X12 Translator (278/275/27x ↔ canonical, lossless, raw retained) · CDS Hooks     │
│  SMART/OAuth2 AS · Bulk Data ($export) · Subscriptions · Connector Framework      │
│  (core admin, EHR, IdP, clearinghouse, VSAC, licensed content)                    │
└──────┬─────────────────────────────────────────────────────────────────────────────┘
┌──────▼──────────────────────────  DATA LAYER  ─────────────────────────────────────┐
│  PostgreSQL (RLS, per-cell) · Object store (documents, raw payloads, NDJSON)      │
│  Kafka log (immutable events) · OpenSearch (tenant-partitioned) · Redis (cache)   │
│  Analytics store (per-cell warehouse; control-plane rollup is de-identified)      │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Layer rules (enforced in CI by dependency checks):**
1. Domain modules may call **substrate services and each other's published contracts only** — never each other's databases, never each other's internal APIs.
2. The substrate has no knowledge of domain concepts beyond its generic schemas (artifact, event, document, task, trace).
3. The integration layer is the **only** place external wire formats (FHIR resources, X12, CDS Hooks) appear; domain logic works on the canonical model.
4. All writes that matter emit events through the outbox; anything a module "tells" another module travels by contract API (synchronous need) or event (everything else).

## 7. Platform substrate services

These are built once, owned by the platform team, and consumed by all modules. Each module PRD implicitly demands every one of these; this section is the de-duplication plan made concrete.

### 7.1 Identity, tenant context & authorization
- **Identity:** Keycloak (or equivalent) as the OIDC provider; per-tenant federation to customer SAML/OIDC IdPs; SMART on FHIR and SMART Backend Services profiles issued by the same AS, with **per-boundary issuers** (no cross-boundary token reuse, per Enstellar A.2).
- **Tenant context:** `tenant_id`, `line_of_business`, `program`, `product`, `region`, `cell_id` minted into the token at auth time and propagated as a signed context header service-to-service. Libraries (one per language in the monorepo) make context extraction automatic; a request without valid tenant context is rejected at the service mesh.
- **Authorization:** RBAC role templates + custom roles resolved to permissions; **OPA** sidecar/library evaluates `subject × action × resource × tenant-scope` with policies versioned in VKAS. Attribute-aware scoping (e.g., reviewer licensed in state X) expressed as OPA data. Adverse-action sign-off (AG-4) is an OPA-enforced workflow guard: the `issue_adverse_determination` action requires an authenticated human principal with the clinical sign-off role — structurally impossible for a service principal or AI pathway.

### 7.2 Event backbone & audit
- Kafka-compatible log per cell; **transactional outbox** in every service guarantees DB-write + event atomicity. Schema Registry (Avro/Protobuf or JSON-Schema) versions every event type; consumers pin schemas.
- Canonical envelope: `{event_id, correlation_id, causation_id, tenant context, occurred_at, actor (human|service|model), schema_ref, payload, provenance_ref?}`.
- **Audit Service** consumes the backbone plus explicit audit calls (reads of PHI are audited too) into an immutable, append-only store with hash-chaining for tamper evidence, retention/legal-hold policies per tenant, and the **evidence-package exporter** (assembles case events + rule traces + AI interactions + documents + approvals into one export — the appeals/audit flagship).
- Replay: the support console replays events or re-drives idempotent Temporal activities by `correlation_id` — satisfied because workflow steps are durable and idempotent by construction (ENS-WF-6).

### 7.3 VKAS — Versioned Knowledge Artifact Service (ADR-9)
One lifecycle engine for every governed artifact in the platform:

| Artifact type | Authored in | Executed by |
|---|---|---|
| Coverage rules, CQL libraries, CRD/DTR packages, value sets, concept maps | Digicore Policy Studio | Digicore Runtime / Enstellar |
| Workflow definitions, routing rules, SLA/clock profiles | Admin/implementation tooling | Enstellar (Temporal) |
| Measure definitions (`Measure` + `Library`) | Digicore (shared substrate) | Qualitron |
| Prompts, model bindings, retrieval configs, eval sets | AI Ops Console | Revital via Model Gateway |
| Notification/letter templates, compliance profiles | Admin tooling | Communication Svc |

Capabilities: canonical URL + semver identity, immutable published versions, draft→review→active→retired lifecycle, **effective/expiration dating with deterministic resolution** ("which version governed on date D for context C"), human-readable diff, approval workflow with role gates / segregation-of-duties / attestations, FHIR NPM-style packaging, **promotion pipeline (sandbox→UAT→prod, tier-aware) with blast-radius gates and rollback**. Digicore's governance UX, Enstellar's workflow versioning, Qualitron's measurement-period pinning, and Revital's prompt registry are all *views over VKAS* — they add domain semantics (simulation, clinical sign-off, eval gates) but share the engine, the audit trail, and the promotion tooling.

### 7.4 Provenance Service (ADR-7)
One trace schema: `{trace_id, tenant ctx, subject (case|measure_result|summary_assertion), governing artifacts [{canonical_url, version}], inputs [{resource_ref | document_span}], logic path, actor chain (incl. model+prompt versions), confidence?, timestamp}`. Digicore's rules trace, Revital's citation records, and Qualitron's measure-evidence records are profiles of this schema. Consequence: the case timeline, the evidence viewer, and the audit exporter are written **once** against one shape.

### 7.5 Document Service
Object-store-backed; ingestion adapters (FHIR `DocumentReference`/`Binary`, X12 275, portal upload, fax→OCR); classification, virus scan, text-layer extraction; **span-addressable storage** (page/region/offset addressing) so Revital citations and reviewer highlighting share an addressing scheme; access policy enforcement (minimum-necessary, redaction views); retention & legal hold; provenance link from every derived artifact back to source bytes. Raw inbound payloads (FHIR bundles, X12 interchanges) are also persisted here pre-transformation for replay/audit (ENS-INT-2).

### 7.6 Terminology Service
Single FHIR terminology server (Ontoserver or HAPI tx) per cell: `$expand`, `$validate-code`, `$translate`; VSAC synchronization; versioned, effective-dated value sets (managed through VKAS); ConceptMaps including licensed-content-identifier crosswalks. Consumers: Digicore authoring validation, Digicore/Qualitron runtime membership tests (with expansion caching for the sub-second path), Revital concept normalization, Enstellar intake validation.

### 7.7 Task & Worklist Service + Notification Service
Generic task model `{task, type, subject_ref, queue, assignment, SLA ref, state}` with queueing, routing-rule execution, capacity/skill/license-aware assignment, saved views, bulk actions. Enstellar's UM worklists and Qualitron's gap-closure outreach lists are both consumers — Qualitron never builds workflow (its PRD non-goal holds because the substrate provides it). Notification Service: template rendering (VKAS-versioned templates), channel adapters (email, webhook, portal, FHIR `Communication`), delivery tracking.

### 7.8 Search Service
OpenSearch, indexes partitioned by tenant and filtered by permission scope at query time; indexers consume the event backbone. Serves cross-module universal search (cases, policies, documents, tasks, gaps, events) — buildable only because all modules emit to one backbone with one provenance/ID scheme.

### 7.9 Model Gateway (ADR-8)
The only path to LLM/ML inference platform-wide: provider abstraction (add/swap models by configuration); **boundary-resolved endpoint selection** (commercial endpoints for pooled/dedicated, authorized endpoints inside the enclave — no cross-boundary inference, no key reuse); PHI minimization/redaction filters at the call boundary; no-train enforcement per provider contract; request/response logging into the audit chain with model+prompt versions; per-tenant/per-workflow kill switches (entitlement-driven); cost metering per tenant/module for FinOps. The Model & Prompt Registry is VKAS-backed; canary/cohort rollout and eval-gated promotion are gateway features Revital configures, not Revital code.

## 8. Module architectures

### 8.1 Enstellar — interoperability & workflow execution
- **Intake & Channel Service:** channel adapters (FHIR PAS via facade, X12 via translator, portal, fax/OCR via Document Service); assigns correlation ID; persists raw payload; de-duplicates/links related transactions (278+275, resubmissions) into one case; sync + async (PAS pended/`$inquire`/subscription) patterns.
- **Case Service:** owns the event-sourced canonical case aggregate (§10). Commands append events; projections serve reads (worklist rows, timeline, status APIs). Every entity carries full tenant/LOB/program/product/region context.
- **UM Workflow Service:** Temporal-backed execution of **VKAS-versioned workflow definitions** — states, transitions, guards, timers, actions as metadata (ENS-WF-1). Lifecycle stages (intake→completeness→auto-determination→triage→review→pend/RFI→peer-to-peer→determination→notification→appeals→closure) are first-class. Auto-determination path calls Digicore Runtime; **adverse outcomes structurally require the human sign-off guard (§7.1)**. Durable timers integrate with the Regulatory Clock Service.
- **Regulatory Clock Service:** clock profiles (CMS 72h expedited / 7-day standard, state laws, NCQA/URAC, ERISA) as VKAS artifacts: start/pause/resume rules (e.g., RFI pauses), business calendars, breach prediction and escalation events. Profiles compose (federal floor + stricter state).
- **Communication, Appeals, Reviewer Workspace API:** templates via Notification Service; appeals as linked cases with their own clock profiles and independent-review routing; workspace API aggregates case projection + Digicore trace + Revital advisory panel + documents + actions into one BFF response.

### 8.2 Digicore — rules & policy intelligence
- **Artifact Registry:** VKAS-backed registry with the policy taxonomy (internal rule, licensed-criterion reference, NCD/LCD reference, DTR package, CRD rule, CQL library, value set, concept map) and first-class inter-artifact relationships; faceted search via Search Service.
- **Authoring Service / Policy Studio:** dual-mode authoring (guided/structured for analysts; code-level CQL with LSP-style validation for informaticists) over the same artifacts; compile CQL→ELM in-tool; terminology binding validated live against the Terminology Service; SDC Questionnaire builder for DTR.
- **Licensed content integration:** reference + provenance + crosswalk model only — license scope recorded, content never reproduced; internal supplements carry explicit precedence; runtime trace names the governing source and version.
- **Governance Service:** domain semantics over VKAS approvals — clinical + compliance gates per artifact type/applicability, segregation of duties, attestations, control-evidence export (NCQA/URAC).
- **Simulation & Impact Service:** executes draft artifacts against synthetic suites (expected-outcome tests, run in CI on change) and **in-boundary de-identified historical case sets** (sourced from the event store); produces outcome-distribution shift / blast-radius reports that gate promotion.
- **Runtime Decision Service:** the hot path. Compiled ELM execution with pinned value-set expansions; deterministic version resolution (effective date × applicability mapping with precedence); returns decision/requirements + **Provenance-schema trace**. Deployed alongside Enstellar in every cell, sized for the synchronous real-time determination budget (sub-second). Serves CRD (CDS Hooks content), DTR package retrieval, and request evaluation.

### 8.3 Qualitron — quality & care-gap intelligence
- **Evidence Aggregation:** materializes member-level evidence from the shared fabric — the canonical store + event backbone (Enstellar exchange data, Revital-extracted resources with provenance) + supplemental data pipelines (validated, standard/non-standard classified). No separate integration layer against sibling modules: it is a consumer of the backbone (ADR-6 payoff).
- **Measure Execution:** runs Digicore-authored, VKAS-pinned `Measure`/`Library` (CQL/ELM) per measurement period; async population-scale evaluation (Bulk Data patterns, incremental re-evaluation on new evidence); produces `MeasureReport` (individual/subject-list/summary) with Provenance-schema evidence links.
- **Gap Detection & Closure:** DEQM gaps-in-care; prioritized outreach candidate lists; closure tasks created through the **Task Service** routed into Enstellar-visible queues; re-evaluation on closing evidence.
- **Reporting & Submission:** dashboards by product/population/provider/region; submission-ready output for the v1 target program; Stars projection; audit packages via the evidence exporter.

### 8.4 Revital — governed AI review augmentation
Pipeline (orchestrated by Enstellar handoff, executed as Temporal workflows for durability):
1. **Ingestion/Parsing:** documents from Document Service; classification, segmentation, layout-aware text extraction.
2. **Extraction:** clinical/administrative entities → US Core resources (`Condition`, `Observation`, `MedicationStatement`…) with `Provenance` to source spans; terminology normalization via Terminology Service (raw text retained beside codes).
3. **Evidence-to-Criteria Mapping:** checks extracted evidence against **Digicore-published documentation/evidence requirements** for the case's criteria; emits structured gaps/conflicts.
4. **Grounded Summarization:** RAG over retrieved spans; every assertion carries a citation `{document, page/region/span, confidence, model+prompt version}`; schema-validated structured outputs; **abstention semantics** below grounding/confidence thresholds ("insufficient evidence — defer to human"), never a fabricated answer.
5. **Triage Advisor:** advisory-only suggestion (likely-meets / needs-RFI / route-to-clinician) with calibrated confidence. Never a determination; cannot reach the adverse path (§7.1 guard).
6. **Feedback & Evaluation:** accept/edit/override + reason captured per interaction; gold-set offline eval (extraction P/R, citation validity, groundedness, calibration) gates promotion via the Model Gateway; online monitoring (override rate, drift) with canary/rollback; human-review queue for flagged/low-confidence outputs.

All inference flows through the Model Gateway (ADR-8). Customer PHI is never used to train shared models absent contractual opt-in; tenant-scoped adaptation, if ever offered, is an isolated, opt-in pathway.

## 9. Inter-module contracts (the platform's load-bearing walls)

Each contract is a versioned spec (OpenAPI / FHIR profiles / AsyncAPI) in `/contracts/`, with generated clients, consumer-driven contract tests (Pact-style) in CI, and semver discipline. **These four documents should be written before module build begins.**

### C-1 Digicore Runtime Contract (Digicore → Enstellar, Revital)
- `POST /runtime/coverage-discovery` — CRD evaluation: case context → PA-required?, alternatives, documentation pointers, governing rule refs.
- `GET /runtime/dtr-package/{canonical}|by-context` — Questionnaire + CQL Library package resolution.
- `POST /runtime/evaluate` — request context + evidence refs → `{recommendation, requirement gaps, trace (Provenance schema), artifact versions pinned}`. Deterministic; version resolution by case-relevant date + applicability.
- `GET /runtime/evidence-requirements/by-context` — extraction targets for Revital.
- SLOs: p50 < 300ms, p99 < 1s for evaluate; CRD within CDS Hooks expectations.

### C-2 Revital Advisory Contract (Revital → Enstellar)
- `POST /assist/analyze-case` (async; Temporal-tracked) → `{summary[{assertion, citations[]}], extracted_resources[] (US Core + Provenance), completeness {gaps[], conflicts[]}, triage {suggestion, confidence}, interaction_record {model_version, prompt_version, inputs, abstentions}}`.
- Hard invariants encoded in the schema: every assertion has ≥1 citation; outputs are advisory-typed (cannot be submitted as a determination); abstention is a first-class result.
- `POST /assist/feedback` — reviewer action + reason, joined to interaction_record.

### C-3 Platform Event Catalog (Enstellar et al. → Qualitron, Audit, Search, Analytics)
AsyncAPI catalog on the backbone; foundational topics: `case.lifecycle.*` (created, state-changed, pended, decided, appealed, closed — with decision + trace refs), `evidence.added` (document, QuestionnaireResponse, extracted resource, supplemental), `artifact.published|rolled-back` (VKAS), `ai.interaction.recorded`, `task.*`, `clock.breach-warning|breached`, `tenant.provisioned|tier-changed`. Qualitron's "shared evidence fabric" is, concretely, this catalog + the canonical store + the Document Service.

### C-4 VKAS & Provenance schemas
The artifact-lifecycle API (publish/resolve-effective-version/diff/promote/rollback) and the trace schema of §7.4 — consumed by all four modules and the audit exporter.

## 10. Canonical data model & the evidence fabric (ADR-6)

**Internal canonical model, FHIR-aligned:** core entities — `Tenant, User, Case, Request(ServiceLine), Member, Coverage, Provider(Role/Org), EncounterContext, Document, QuestionnaireResponse, Task, Event, Decision, Communication, Appeal, Artifact(ref), MeasureResult, ModelInteraction, Trace, AuditRecord`. Clinical entities are stored as profiled FHIR resources (US Core) where FHIR is the natural shape; operational entities (case, task, clock, decision) are relational aggregates **with defined bidirectional mappings** to their FHIR projections (`Claim` use=preauthorization, `ClaimResponse`, `Task`, `Communication`). Rationale: pure FHIR-resource persistence makes UM lifecycle operations (queues, clocks, assignment, event sourcing) awkward and slow; pure bespoke modeling loses the standards contract. The mapping layer lives in the integration layer only.

- **Losslessness:** FHIR→canonical→FHIR and X12→canonical→X12 round-trip without losing required elements; raw payloads always retained (Enstellar ENS-MDL-2).
- **The evidence fabric is not a fifth system.** It is: (a) the tenant-scoped canonical store (member-level clinical + administrative resources with provenance), (b) the immutable event log, (c) the Document Service. Qualitron reads it; Revital writes extracted resources into it; Enstellar populates it through exchange. **Member/provider/eligibility master data** is mastered in the payer's core admin platform and cached/synchronized into the fabric via connectors with freshness SLAs — Simintero is not the system of record for membership.
- **Event sourcing scope:** the Case aggregate (and Appeal) are event-sourced — reconstructable, replayable, audit-native. Policy/measure/prompt artifacts get immutable versioning via VKAS (equivalent guarantees, simpler machinery). Reference data is conventionally persisted with audit.

## 11. Eventing architecture

- Kafka per cell; topics tenant-tagged, partitioned for ordering by `case_id`; schema-registry-governed; consumer groups per service with replay offsets.
- **Outbox pattern everywhere:** service writes DB row + outbox record in one transaction; relay publishes. No dual-write bugs; supports the support console's "what was emitted for case X" query.
- Cross-cell: events do not cross cells (tenant data stays in-cell). Control-plane telemetry is a separate, de-identified rollup stream.
- DLQs + stuck-message diagnostics surfaced in the support console; idempotency keys on all consumers; Temporal owns long-lived orchestration so the backbone stays a log, not a workflow engine.

## 12. FHIR & standards architecture

- **FHIR Facade:** HAPI-based R4 server fronting the canonical model via the mapping layer; publishes a `CapabilityStatement` **generated from runtime configuration** (resources, profiles, search params, operations, security) — never hand-maintained.
- **IG pinning:** US Core/USCDI and Da Vinci IG versions (CRD, DTR, PAS, PDex, Plan-Net, ATR, PCDE, CDex, DEQM, SDC, Bulk, Subscriptions backport) pinned per deployment in VKAS; concurrent versions supported during ecosystem transitions.
- **Conformance CI:** Inferno + Touchstone test kits run in CI against every deployment configuration; a release cannot promote if a declared IG fails.
- **Auth:** SMART on FHIR (app launch, v1/v2 scopes) for user-facing apps incl. DTR SMART app; SMART Backend Services (asymmetric JWT, JWKS) for system/Bulk; UDAP on the roadmap for B2B trust; TLS 1.2+ everywhere, mTLS for designated partner endpoints.
- **X12 Translator:** 278/275 (and 27x where in scope) ↔ canonical with lossless bidirectional mapping; companion-guide variability as configuration; raw interchanges retained for audit/replay.
- **CMS-0057-F as a conformance profile:** Patient Access, Provider Access, Payer-to-Payer, Prior Auth (CRD+DTR+PAS), Provider Directory map onto the facade per the Enstellar appendix; decision timeframes and PA public-metrics reporting are clock-profile + reporting configurations, not code.

## 13. AI & agentic architecture

Beyond Revital's pipeline (§8.4), the platform takes a deliberate stance on agentic patterns:

- **Agents as governed workflow participants.** Any future agentic behavior (e.g., constrained automation of non-adverse, high-confidence dispositions — Revital v2.0) executes as Temporal workflows whose action space is explicitly enumerated and OPA-policed. An agent is a *principal type* in the authz model: it can never hold the clinical sign-off role, so adverse actions are unreachable by construction, not by prompt.
- **Tool-use surface:** agents interact with the platform exclusively through the same published contracts (C-1..C-4) as humans' applications — no privileged side doors. This makes agent behavior auditable with the same Provenance/audit machinery.
- **Determinism boundary:** anything that must be reproducible (rules evaluation, measure execution) is deterministic ELM, not LLM. LLMs handle unstructured→structured transformation and language tasks, always grounded, always cited, always behind the Model Gateway.
- **Evaluation as a release gate:** model/prompt changes promote through VKAS like any artifact — offline eval thresholds (accuracy, groundedness, calibration), clinical-validation sign-off for clinical outputs, canary by tenant/cohort, automatic rollback on metric breach.
- **Drift & trust telemetry:** override-rate vs. accuracy monitoring guards against automation bias; advisory framing, confidence, and citations are contract-enforced UI inputs.

## 14. Security architecture

**Posture:** zero-trust within the platform; HIPAA-ready with BAA across tiers; SOC 2 Type II program from GA; HITRUST/FedRAMP-aligned hardening reserved for the enclave pattern when contractually triggered.

- **Identity & access:** per §7.1; MFA enforced for privileged roles; just-in-time privileged access with approval workflows and break-glass (fully audited); periodic access reviews supported by exportable entitlement reports.
- **Tenant isolation (defense in depth):**
  1. Edge: tenant resolved and bound into token; routing only to the tenant's cell.
  2. Service: every request carries signed tenant context; OPA denies any resource access outside scope.
  3. Data: Postgres RLS on `tenant_id` with session-bound tenant GUC set from the verified context — application bugs cannot read across tenants; search indexes partitioned per tenant; object-store prefixes per tenant with scoped credentials.
  4. Crypto: encryption in transit (TLS 1.2+/mTLS) and at rest; **per-tenant data-encryption keys** under envelope encryption (KMS), enabling cryptographic shredding on decommission and clean dedicated-cell migration.
- **PHI controls:** minimum-necessary access policies on documents; PHI-aware structured logging (deny-list + tokenization — PHI never in logs/traces/metrics); data masking in non-production; de-identification pipeline for simulation/eval datasets (in-boundary only); Model Gateway redaction before inference; configurable retention, legal hold, and deletion workflows.
- **Secrets & supply chain:** centralized secrets manager, rotation, cert lifecycle; secure SDLC with dependency/secret/container scanning, SBOMs, signed images, IaC policy scanning. (Note: AI-generated code goes through the *same* gates — see §19.)
- **Detection & response:** anomalous-access monitoring (cross-tenant probe attempts are page-able events), audit-stream alerting, incident severity model with tenant-impact assessment and tier-aware communications.

## 15. Multi-tenant isolation — implementation summary

| Concern | Pooled cell | Dedicated cell | Enclave cell |
|---|---|---|---|
| Compute | Shared services, per-tenant rate/concurrency budgets; noisy-neighbor guards (queue fairness, per-tenant autoscaling signals) | Tenant-exclusive service fleet | Tenant-/program-exclusive in separate cloud boundary |
| Data | Shared Postgres with RLS + per-tenant DEKs; shared Kafka with tenant-tagged topics | Tenant-exclusive DB/log/store (same schemas) | As dedicated + boundary-resident keys, authorized services only |
| Inference | Commercial endpoints via Model Gateway | Commercial (optionally tenant-pinned) endpoints | Authorized endpoints (e.g., GovCloud) only |
| Release | Continuous (weekly train) | Tier policy: train or scheduled window | Operator-applied desired state; slower cadence |
| Support | Standard console, impersonation w/ consent + audit | Same + tenant-specific runbooks | Segmented ops view; cleared-personnel policies as required |
| Migration path | — | Cell provision + logical replication + gateway cutover (schema-identical by construction) | New boundary provision from the same release artifacts |

## 16. Observability & operations

- **Three pillars, tenant-tagged at source:** structured logs, distributed traces (correlation_id = case/transaction spine), metrics — every signal carries tenant + cell + module labels (PHI-free).
- **Business KPIs as first-class telemetry:** turnaround time, queue aging, completeness rate, clock-breach risk, AI override rate, rules-eval latency — emitted from domain services, powering both customer dashboards and SRE error budgets.
- **Consoles (internal tooling from the PRD, mapped):** Provisioning Console (templates, seed packs, tier selection, readiness checks, rollback) and Config Promotion (diff, approval gates, history, blast radius) sit on control plane + VKAS; Workflow Replay & Diagnostics (search by any identifier, replay, decision-trace inspection, queue state) sits on the event backbone + Temporal; Support Console (scoped impersonation, redaction-enforced views, diagnostic bundles); AI Ops Console (registry, evals, drift, feedback queue, rollout) sits on Model Gateway + VKAS.
- **FinOps:** per-tenant/per-module cost telemetry (compute, storage, queue, inference) → unit economics and tier-aware margin reporting; inference metering feeds entitlements/billing hooks.
- **SLOs:** 99.9% GA availability; UI p50 <2s; API p50 <1s; rules evaluation p99 <1s; degraded-mode behavior for partner outages = queue-and-retry, never silent drop.

## 17. Technology stack & build-vs-buy

| Layer | Selection (primary / alternative) | Build vs buy rationale |
|---|---|---|
| Workflow durability | **Temporal** (self-hosted per cell) / Camunda 8 | Durable timers, replay, idempotent activities are years of work; UM state machines, clocks, Revital pipelines, provisioning all ride it |
| FHIR server/facade | **HAPI FHIR** (+ custom mapping layer) / Firely | Mature R4 + validation; differentiation is in the canonical mapping, not the server |
| CQL/ELM execution | **cqf-ruler / CQL engine lineage**, hardened for multi-tenancy + latency | Reference-grade Clinical Reasoning; Simintero adds determinism pinning, caching, trace |
| Terminology | **Ontoserver** (commercial) / HAPI tx | VSAC sync + performance; licensing cost « build cost |
| Identity | **Keycloak** / Auth0-okta for control plane | SMART + SAML/OIDC federation patterns well-trodden |
| AuthZ | **OPA** (+ entitlement service) | Policy-as-code, versionable in VKAS, auditable |
| Events | **Kafka** (MSK/Confluent or Redpanda per cell) | Industry default; schema registry ecosystem |
| Primary store | **PostgreSQL** (+ RLS) | §15; boring, provable, HIPAA-friendly |
| Search | **OpenSearch** | Tenant-partitioned indexes, security plugins |
| Documents/raw | **S3-compatible object store** + OCR (Textract or equivalent; boundary-resolved) | Commodity |
| LLM access | **Model Gateway (build, thin)** over commercial APIs (incl. Claude) + boundary-authorized endpoints | The gateway IS product IP (governance); models are not |
| UI | React + design system; module apps in one shell | Shared timeline/search/notification components |
| Infra | Kubernetes per cell; Terraform; GitOps (ArgoCD); service mesh (mTLS, authz) | Cell stamping must be push-button for dedicated-tier economics |

**Build (the IP):** canonical model + mapping layer, VKAS, Provenance Service, Model Gateway governance, UM workflow definitions + clock profiles, Policy Studio + simulation, evidence fabric semantics, measure execution hardening, Revital pipeline, consoles.

## 18. Environments, CI/CD & release

- **Monorepo** (`/platform`, `/modules/{enstellar,digicore,qualitron,revital}`, `/contracts`, `/artifacts`, `/infra`, `/docs/adr`) with enforced dependency rules (§6) and CODEOWNERS per domain.
- **Pipeline:** PR → unit + contract tests (consumer-driven, against `/contracts`) → integration on ephemeral env → conformance suite (Inferno/Touchstone for touched IGs) → security gates (SAST, deps, secrets, container) → staging fleet (synthetic tenants, canary pooled cell) → tier-aware promotion (pooled train weekly; dedicated per policy; enclave desired-state handoff).
- **Two promotion pipelines, deliberately separate:** *code* (above) and *knowledge artifacts* (VKAS sandbox→UAT→prod per tenant, with simulation/blast-radius gates). A policy change is a tenant-governed promotion, not a deploy — the PRD's Journey 2 exactly.
- **Feature flags** (entitlement-integrated) decouple deploy from release; canary by cell, then tenant cohort.

## 19. Engineering operating model — AI-assisted, contract-first (ADR-10)

This architecture is deliberately shaped so that agentic coding tools (Claude Code et al.) are force multipliers rather than chaos generators. The structural choices that matter:

1. **Contracts as the source of truth.** `/contracts` holds OpenAPI/AsyncAPI/FHIR profiles + JSON Schemas (provenance, events, advisory outputs). Clients and server stubs are generated; agents implement *against* specs and are graded by contract tests. This converts the hardest multi-team coordination problem into a machine-checkable artifact — for humans and AI alike.
2. **Spec-driven development.** Each requirement group (e.g., `ENS-WF`, `DIG-SIM`) becomes a spec file (intent, invariants, acceptance criteria from the PRDs, test plan) before implementation. Agents consume the spec, produce implementation + tests; humans review against the spec, not from scratch. The module PRDs' AC discipline plugs directly into this.
3. **Repo conventions for agents:** `CLAUDE.md` at root and per-module — architecture rules (layer/dependency constraints of §6), tenancy invariants ("every query is tenant-scoped; never bypass the context library"), PHI rules ("never log payload fields; use the redaction helpers"), testing norms, and pointers to contracts/ADRs. Subagent definitions for recurring roles: conformance-checker (runs Inferno locally), contract-reviewer, migration-writer, threat-model assistant.
4. **Guardrails that don't trust the author — human or AI:** the CI gates of §18 (contract tests, dependency rules, RLS tests, security scans, conformance) are the actual enforcement. Property-based tests on the lossless mappers (FHIR↔canonical↔X12 round-trips) and determinism tests on rules evaluation are especially high-value because they are cheap for agents to run continuously.
5. **Synthetic-first test data.** A maintained synthetic tenant + Synthea-style clinical data pack lets agents (and CI) exercise full PA journeys with zero PHI exposure — also the seed for Digicore simulation suites and Revital eval sets.
6. **Where agents are and aren't used:** high leverage — connector/adapters, mappers, CRUD/projection scaffolding, test generation, IG conformance fixes, console UIs. Human-led with agent assist — canonical model design, authz policy, clock semantics, clinical-safety logic, anything touching the adverse-action path. All AI-generated code passes the same review + gates; provenance of authorship recorded in commits.

## 20. NFR traceability

| PRD NFR | Architectural answer |
|---|---|
| 99.9% availability | Cell isolation (blast radius), Temporal durability, queue-and-retry degradation, multi-AZ per cell |
| UI <2s / API <1s medians | BFF aggregation, read projections, caching; async for heavy work |
| Sub-second rules eval | Compiled ELM, pinned expansion caches, co-located runtime per cell |
| No cross-tenant degradation | Per-tenant budgets/fairness in pooled cells; dedicated tier as relief valve |
| Immutable audit + evidence export | §7.2 hash-chained audit + one Provenance schema + exporter |
| WCAG AA | Design-system level enforcement + CI accessibility checks |
| Tier flexibility w/o code divergence | One release artifact set; cells differ by topology/config only (§5) |
| Conformance | Inferno/Touchstone in CI; CapabilityStatement from runtime config |

## 21. Phase alignment (PRD roadmap → build order)

- **Phase 0 (substrate — sacred, do not dilute):** identity/tenant context/OPA, event backbone + outbox + audit, Document Service, Terminology Service, VKAS v1, Provenance schema, canonical model v1 + case aggregate, Temporal foundation, provisioning console v1, observability baseline, contracts C-1..C-4 ratified. *Exit test:* a synthetic tenant can be provisioned and a skeletal case created, evented, and replayed.
- **Phase 1 (compliance & workflow MVP):** Enstellar intake (PAS + portal first; X12 fast-follow), UM workflow + clocks for **one LOB/state profile**, worklists/workspace; Digicore registry + authoring + governance + runtime for one service-category policy pack; SaaS admin lifecycle/entitlements; support console v1. *Thin vertical slice end-to-end before widening.*
- **Phase 2 (enterprise operability):** replay/diagnostics depth, config promotion GA, Revital v1 (ingest→extract→ground→advise) behind the Model Gateway, dedicated-cell automation, SLA dashboards, security ops hardening.
- **Phase 3 (quality & scale):** Qualitron v1 on the (now real) fabric, FinOps, multi-region options, enclave reference pattern, connector expansion.
- **Phase 4:** cross-module search/analytics GA, claims/appeals/program-integrity expansion, constrained automation tiers, market bundles.

## 22. Risks & open architectural decisions

| # | Risk / open item | Recommendation |
|---|---|---|
| R-1 | Phase 0 scope creep (substrate becomes a platform-for-platform's-sake) | Time-box; every substrate feature must be demanded by the Phase 1 vertical slice |
| R-2 | CQL engine latency at real-time-determination scale | Spike early: compiled-ELM benchmark with pinned expansions against the p99 <1s budget; fallback = pre-materialized decision tables for the auto-determination subset |
| R-3 | Canonical-model churn destabilizing all modules | Version the model like a contract; additive-only within a major; mapping layer absorbs FHIR IG drift |
| R-4 | Pooled→dedicated migration unproven until needed | Rehearse with a synthetic tenant before first enterprise deal closes |
| R-5 | Enclave pulled forward by a deal | The Model Gateway + cell pattern contains the blast radius; do NOT pre-build FedRAMP controls speculatively |
| R-6 | Licensed-content integration legal/technical shape unknown | Resolve vendor + license model before Digicore §8.3 build; the reference/crosswalk design assumes plan-held licenses |
| R-7 | Open: control-plane SaaS vendor vs self-host for Temporal/Kafka in regulated cells | Decide per-tier; enclave almost certainly self-host |
| R-8 | Open: opt-in/opt-out consent mastery (Provider Access/P2P) — Enstellar vs SaaS admin | Recommend platform substrate (consent is cross-module) |
| R-9 | Open: analytics warehouse pattern (per-cell only vs federated query) | Start per-cell; revisit at Phase 3 |

---

*Companion documents to produce next: ICD-1..4 (the contracts of §9), Canonical Data Model spec, Threat Model, VKAS design doc, Phase 0 engineering plan.*
