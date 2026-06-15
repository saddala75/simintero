# PRD: Enstellar — Interoperability & Workflow Execution

**Module:** Enstellar (E·01) · part of the Simintero payer operating platform
**Document type:** Product Requirements Document (balanced — product requirements with a technical FHIR/standards appendix)
**Status:** Draft for review
**Primary audience:** Product, engineering, clinical/UM SMEs, implementation, compliance
**Version:** 0.1

---

## 1. Purpose

Enstellar is the operational front door of the Simintero platform — the interoperability and workflow-execution layer that turns inbound clinical and administrative transactions into governed, traceable cases and drives them through a configurable lifecycle to a decision. This PRD defines Enstellar as a **general-purpose interoperability-and-workflow engine**, with **end-to-end prior authorization (PA), including appeals, as the first fully-specified use case**, and a standards layer broad enough to serve the wider set of payer interoperability and utilization-management workflows over time.

A deliberate framing decision runs through this document: **CMS-0057-F is one conformance target, not the product.** Enstellar's standards layer is built on the underlying HL7 FHIR and Da Vinci implementation guides (CRD, DTR, PAS, PDex, and others), which serve burden-reduction, exchange, and UM goals independent of any single rule. CMS-0057-F, state prior-authorization laws, gold-carding mandates, NCQA/URAC accreditation requirements, and commercial/ERISA appeal rules are all expressed as **configurable conformance profiles and regulatory clocks** over the same engine.

## 2. Product summary

Enstellar ingests requests and supporting documentation through multiple channels (FHIR APIs, X12, provider portal, and document/fax intake), normalizes them into a shared case model, discovers coverage and documentation requirements (via Digicore), assists review with governed AI (via Revital), orchestrates the full UM lifecycle through human decisioning, communicates status and determinations to providers and members, handles appeals and grievances, and emits a complete, tenant-scoped audit and event trail consumable by Qualitron and downstream systems.

It is multi-tenant and **deployment-tier aware** (pooled, siloed, or dedicated compliance boundary), with tenant context propagated through every request, query, event, and log line, and with connectors and inference endpoints resolvable per boundary.

## 3. Goals

- **G1.** Provide a configurable, auditable workflow engine that executes the full UM lifecycle — intake through determination, communication, and appeals — without per-tenant code forks.
- **G2.** Deliver a standards-first interoperability layer (FHIR R4 / US Core / Da Vinci / SMART / Bulk Data, plus X12 translation) that satisfies CMS-0057-F **and** is reusable for non-mandated exchange and UM use cases.
- **G3.** Reduce administrative burden and turnaround time — support real-time/automated determination for low-complexity requests while routing complex cases to clinicians with full context.
- **G4.** Reduce provider abrasion through transparent status, structured documentation requests, and electronic exchange that replaces fax and portal scraping.
- **G5.** Preserve explainability and auditability — every recommendation, rule applied, document used, and decision is traceable to inputs, versions, and the acting user.
- **G6.** Meet regulatory and accreditation decision timeframes across lines of business through configurable SLA/clock management, not hard-coded rules.
- **G7.** Be extensible by configuration to adjacent workflows (concurrent review, claims attachments, referrals, payer-to-payer and provider data exchange) without re-platforming.

## 4. Non-goals

- Authoring clinical coverage criteria or policy logic — that is **Digicore**; Enstellar consumes published rule artifacts.
- Performing the AI summarization/extraction itself — that is **Revital**; Enstellar orchestrates and displays its advisory outputs with governance.
- Replacing the payer's core claims/administrative platform — Enstellar integrates with it (eligibility, accumulators, claims linkage), it does not adjudicate claims.
- Fully autonomous adverse determinations — denials and other clinically/financially sensitive actions require human sign-off (see §10).
- Building provider-side request authoring tooling as a separate product — Enstellar exposes standards-based endpoints that provider/EHR systems connect to; it is payer-side.

## 5. Strategic context & positioning

Enstellar is the platform's wedge and its operational hub. Within Simintero it:

- **Consumes Digicore** for coverage requirements discovery, documentation templates (Questionnaire + CQL), terminology, and runtime decision logic, with full rules trace.
- **Consumes Revital** for advisory document summarization, evidence extraction, completeness/conflict flags, and triage suggestions — surfaced to reviewers under human-in-the-loop controls.
- **Feeds Qualitron** with the event, evidence, and outcome stream for quality measurement, care-gap signals, and analytics.
- **Honors the deployment-tier model** — runs identically in pooled, siloed, and boundary topologies; external connectors and inference endpoints resolve to tier/boundary-authorized services.

Prior authorization is v1 because it carries the clearest, most time-bound demand (regulatory and provider-abrasion pressure) and exercises the full engine. The same engine is designed to extend to the broader UM and exchange surface (§7.2).

## 6. Personas

**External (Enstellar users)**
- **UM intake / coordinator** — monitors queues, resolves intake and completeness issues, manages provider communication.
- **UM nurse / clinical reviewer** — reviews cases against criteria, evidence, and AI summaries; pends, requests information, approves within scope, or escalates.
- **Medical director / physician reviewer** — adjudicates escalations, conducts peer-to-peer, renders adverse determinations requiring clinical sign-off.
- **Appeals & grievances specialist** — manages appeal intake, timelines, independent review, and overturn/uphold outcomes.
- **Provider-facing operations user** — supports provider intake, status inquiries, and attachment completeness.
- **Payer administrator** — configures workflows, queues, SLA targets, routing, templates, and entitlements (often via SaaS admin layer).

**Internal (operate Enstellar)**
- **Implementation consultant** — configures LOB/program workflows, connectors, and conformance profiles per tenant.
- **Support engineer** — investigates stuck cases/transactions, replays events, traces incidents (via internal tooling).
- **Interoperability/integration engineer** — manages FHIR endpoints, X12 connectivity, IdP federation, and conformance testing.

## 7. Use cases

### 7.1 Primary (v1) — Prior authorization, full UM lifecycle including appeals

The v1 scope is the complete lifecycle, not a happy path:

1. **Coverage discovery** — is PA required for this service/member/plan; what documentation is needed (CRD).
2. **Documentation gathering** — payer-supplied templates and rules drive structured documentation capture (DTR).
3. **Submission & intake** — request + attachments received via FHIR (PAS), X12 278/275, portal, or document channel; normalized to a case.
4. **Completeness & validation** — required data/attachments checked; auto-pend with structured RFI if incomplete.
5. **Automated/real-time determination** — low-complexity requests meeting criteria are approved in real time where configured.
6. **Triage & assignment** — remaining cases routed to queues/reviewers by rules (specialty, LOB, urgency, license).
7. **Clinical review** — reviewer works the case with criteria trace (Digicore) and advisory AI summary/extraction (Revital).
8. **Pend / request for information (RFI)** — structured information requests to providers with clocks paused/managed per rules.
9. **Peer-to-peer & medical-director escalation** — scheduling, documentation, and adverse-determination sign-off.
10. **Determination** — approve / partial / deny / modify, with rationale, criteria citations, and decision trace.
11. **Notification & communication** — provider and member notifications, determination letters, and status updates across channels.
12. **Appeals & grievances** — appeal intake, regulatory clocks by LOB/state, reconsideration, independent/external review, overturn/uphold, and reopening.
13. **Closure, audit & reporting** — full artifact retention, event emission, and metrics (incl. CMS PA public-metrics reporting).

### 7.2 Adjacent / future use cases (designed-for extensibility, not v1 build)

Concurrent/inpatient review and discharge planning · referral management · claims attachments (post-service documentation) · Provider Access data exchange · Payer-to-Payer data exchange at enrollment · Patient Access data exposure · gold-carding / provider-trust waiver programs · payment-integrity pre-pay documentation. These reuse the same intake, normalization, workflow, eventing, and standards layers; Enstellar must not hard-code assumptions that prevent them.

## 8. Functional requirements

Requirements use IDs `ENS-<area>-<n>`. Acceptance criteria (AC) are given for major requirement groups. "Must" = v1; "should" = v1 if feasible; "may" = future.

### 8.1 Intake & channel management — `ENS-INT`

- **ENS-INT-1 (must).** Accept PA requests and supporting documentation via: FHIR PAS (`Claim/$submit`, `$inquire`), X12 278 (request/response) and 275 (attachments), authenticated provider portal entry, and document/fax intake with OCR handoff.
- **ENS-INT-2 (must).** Each inbound transaction is assigned a tenant-scoped correlation ID and persisted in raw form before transformation (for replay and audit).
- **ENS-INT-3 (must).** Support synchronous and asynchronous intake patterns, including PAS async with status polling/subscription.
- **ENS-INT-4 (should).** De-duplicate and link related transactions (e.g., 278 + 275 attachment, resubmissions) into a single case.
- **AC:** Given a valid PAS bundle, a case is created with a correlation ID and the raw payload retained; given an equivalent X12 278, the resulting case model is functionally identical regardless of channel.

### 8.2 Normalization & shared case model — `ENS-MDL`

- **ENS-MDL-1 (must).** Normalize all intake into a canonical case model: `case`, `request` (service/item lines), `member/coverage`, `requesting & servicing providers`, `encounter context`, `documents`, `questionnaire responses`, `tasks`, `events`, `decisions`, `communications`, `appeals`.
- **ENS-MDL-2 (must).** Preserve bidirectional mapping between canonical model and source representations (FHIR resources, X12 segments) with no lossy collapse of clinically/operationally significant fields.
- **ENS-MDL-3 (must).** Propagate tenant, line of business, program, product, and region context on every entity.
- **ENS-MDL-4 (must).** Version artifacts and maintain immutable event history; the case model is event-sourced or equivalently reconstructable.
- **AC:** A case round-trips FHIR→canonical→FHIR and X12→canonical→X12 without loss of required elements; tenant context is present on every persisted record and emitted event.

### 8.3 Coverage discovery & documentation — `ENS-DOC`

- **ENS-DOC-1 (must).** Integrate Digicore-published **CRD** content to answer, at or before request time, whether PA is required and what documentation/rules apply (CDS Hooks–based; see Appendix A).
- **ENS-DOC-2 (must).** Serve **DTR** artifacts (FHIR `Questionnaire` + CQL) and accept `QuestionnaireResponse`, supporting both SMART-app and EHR-integrated execution.
- **ENS-DOC-3 (must).** Validate submitted documentation against the active documentation requirements and produce structured gaps.
- **ENS-DOC-4 (should).** Support `CDex`-style task-based documentation requests for clinical data/attachments not satisfied by DTR.
- **AC:** When PA is not required for a service/plan, CRD returns "no auth required" with the governing rule reference; when required, the provider receives the correct documentation template and a completed `QuestionnaireResponse` is accepted and attached to the case.

### 8.4 Workflow orchestration engine — `ENS-WF`

- **ENS-WF-1 (must).** Provide a **configurable state machine** spanning the full UM lifecycle (§7.1 steps 4–13). States, transitions, guards, timers, and actions are metadata-driven per tenant/LOB/program — no code branches for standard variations.
- **ENS-WF-2 (must).** Support intake, completeness check, auto-determination, triage/assignment, clinical review, pend/RFI, peer-to-peer, escalation, determination, notification, appeals, reopening, and closure as first-class lifecycle stages.
- **ENS-WF-3 (must).** Configurable **assignment & routing**: by specialty, LOB, urgency, reviewer license/credential, workload, and business calendar; with manual reassignment and supervisor override.
- **ENS-WF-4 (must).** **Queues & worklists** with SLA-aware sorting, filters, saved views, and bulk actions; reviewer, team, and supervisor views.
- **ENS-WF-5 (must).** **Auto-determination path** for configured low-complexity scenarios that fully meet criteria, with mandatory human review retained for any adverse action.
- **ENS-WF-6 (must).** Idempotent, replayable steps; failed external calls and stuck messages are diagnosable and re-runnable without data corruption (supports internal replay tooling).
- **ENS-WF-7 (should).** Versioned workflow definitions with safe promotion (sandbox→UAT→prod) and rollback, consistent across deployment tiers.
- **AC:** A tenant can change a routing rule or SLA target via configuration and see it take effect without a deploy; a denial cannot be issued by the automated path without a recorded human sign-off; a failed downstream call leaves the case in a recoverable, retryable state.

### 8.5 Rules & decision integration — `ENS-RUL`

- **ENS-RUL-1 (must).** Consume Digicore runtime decision services and present a **rules trace panel**: which policy version, criteria, questionnaire, and evidence path produced a recommendation or requirement.
- **ENS-RUL-2 (must).** Pin the rule/policy version used per case and retain it for audit even after the rule is superseded.
- **AC:** For any determination, a reviewer (and later an auditor/appeals specialist) can see the exact criteria version and evidence that drove it.

### 8.6 AI-assist integration (governed) — `ENS-AI`

- **ENS-AI-1 (must).** Surface Revital outputs — case summary with source citations, extracted entities, completeness/conflict flags, triage suggestion, confidence — as **advisory** within the reviewer workspace.
- **ENS-AI-2 (must).** Record, per case interaction, the model and prompt/template versions, inputs referenced, the AI output, and the user action taken (accept/override + reason).
- **ENS-AI-3 (must).** Allow AI assistance to be disabled at tenant or workflow level; never let AI output alone trigger an adverse determination.
- **ENS-AI-4 (must).** Resolve inference to tier/boundary-authorized endpoints (no cross-boundary inference).
- **AC:** Every AI-touched case shows its model/prompt versions and the reviewer's action; disabling AI for a workflow removes AI surfaces without breaking the workflow.

### 8.7 Document & attachment management — `ENS-ATT`

- **ENS-ATT-1 (must).** Ingest, store, and associate attachments (FHIR `DocumentReference`/Binary, X12 275, portal/fax) with completeness tracking and access-policy enforcement (redaction, minimum-necessary).
- **ENS-ATT-2 (must).** Hand off documents to Revital for parsing/extraction and retain provenance linking extracted evidence to source documents.
- **AC:** An attachment received via any channel is viewable in the case with source provenance and governed access controls.

### 8.8 Communication & notification — `ENS-COM`

- **ENS-COM-1 (must).** Generate provider and member communications: RFI requests, determination notifications, and letters, using tenant-configurable templates with required regulatory content per LOB/state.
- **ENS-COM-2 (must).** Deliver status and determinations via FHIR (`Communication`/`CommunicationRequest`, PAS `$inquire`, subscriptions), portal, and configured channels (email/webhook).
- **ENS-COM-3 (must).** Maintain provider-facing status transparency (received, pended, RFI outstanding, in review, decided) with timestamps.
- **AC:** A determination produces a compliant notification artifact and an electronically queryable status update within the configured SLA.

### 8.9 Case management UI — `ENS-UI`

- **ENS-UI-1 (must).** Reviewer workspace with: case header/context, service lines, member/coverage, documents viewer, rules trace, AI advisory panel, RFI/communication actions, decision capture, and a **unified case timeline** of every event.
- **ENS-UI-2 (must).** Worklist/queue management with SLA views, assignment, and bulk actions.
- **ENS-UI-3 (should).** Provider-facing status views (within Enstellar or via exposed status APIs/portal).
- **AC:** A reviewer can complete a standard case end-to-end (review → decision → notification) within the workspace without leaving for source systems.

### 8.10 Appeals & grievances — `ENS-APP`

- **ENS-APP-1 (must).** Appeal/grievance intake linked to the originating case, with classification (standard/expedited, appeal/grievance, level).
- **ENS-APP-2 (must).** **Regulatory clocks by LOB/state/program** (e.g., MA reconsideration timelines, Medicaid fair-hearing rules, commercial/ERISA timelines) as configurable profiles — not hard-coded.
- **ENS-APP-3 (must).** Independent/secondary reviewer assignment with conflict-of-interest controls; capture overturn/uphold/modify with rationale.
- **ENS-APP-4 (must).** Support external/independent review referral and case reopening; full audit linkage to the original determination and evidence.
- **AC:** An expedited appeal starts the correct clock for the member's LOB/state, routes to an independent reviewer, and records the outcome linked to the original decision with complete history.

### 8.11 Interoperability APIs — `ENS-API`

- **ENS-API-1 (must).** Expose and consume the FHIR interoperability surface defined in §9 and detailed in Appendix A.
- **ENS-API-2 (must).** Publish a `CapabilityStatement` per deployment describing supported resources, profiles, operations, and search parameters.
- **ENS-API-3 (must).** Enforce SMART on FHIR / SMART Backend Services authorization and scope checks on all FHIR endpoints (Appendix A).
- **AC:** Endpoints pass the relevant conformance test kits (Inferno/Touchstone) for declared IGs.

### 8.12 Eventing, status & observability — `ENS-EVT`

- **ENS-EVT-1 (must).** Emit a tenant-scoped, immutable event for every state transition, external call, rule evaluation, AI interaction, and user action, with correlation IDs spanning channels.
- **ENS-EVT-2 (must).** Support search by case ID, transaction ID, FHIR resource ID, document ID, tenant, and correlation ID (feeds internal replay/diagnostics tooling).
- **ENS-EVT-3 (must).** Track and expose business and operational status per case and in aggregate.
- **AC:** Any case can be reconstructed from its event history; a support engineer can locate a transaction by any identifier and inspect its full path.

### 8.13 Regulatory clocks, SLA & compliance — `ENS-CLK`

- **ENS-CLK-1 (must).** Configurable decision-timeframe clocks per LOB/state/program/urgency (e.g., expedited 72 hours, standard 7 calendar days under CMS-0057-F; stricter state limits where applicable), including pause/resume on RFI per governing rules and business calendars.
- **ENS-CLK-2 (must).** SLA breach detection, escalation, and alerting (tenant- and boundary-aware).
- **ENS-CLK-3 (must).** Produce data for required public/operational PA metrics (approval/denial/appeal-overturn rates, average decision time) per reporting profile.
- **AC:** Changing a state's standard-decision limit is a configuration action; clocks correctly pause on RFI and resume per rule; metrics reports reconcile to case data.

### 8.14 Configurability & multi-tenancy — `ENS-CFG`

- **ENS-CFG-1 (must).** Workflows, queues, routing, templates, SLA/clock profiles, conformance profiles, and channel settings are metadata-driven per tenant — no per-tenant forks.
- **ENS-CFG-2 (must).** Scope all configuration and data by tenant hierarchy (tenant → LOB → program → product → group → region).
- **ENS-CFG-3 (must).** Run identically across pooled, siloed, and boundary tiers; connectors and inference/exchange endpoints resolve per boundary.
- **AC:** Two tenants with different PA workflows, templates, and clocks run on the same codebase/release with no code divergence.

## 9. FHIR & standards requirements (summary)

Enstellar's standards layer is **broad by design** (the technical detail is in Appendix A). v1 establishes the foundation and the PA path; the full CMS API set and exchange surface phase in (§16).

- **Foundation:** FHIR **R4** with **US Core** profiles; USCDI alignment; `CapabilityStatement` published per deployment.
- **Authorization:** **SMART on FHIR** (app launch, scoped OAuth2) for user-facing apps; **SMART Backend Services** (client-credentials, signed JWT) for system-to-system and Bulk; **UDAP** considered for B2B endpoint trust / dynamic registration (forward-looking).
- **Prior-auth burden-reduction trio (Da Vinci):** **CRD** (Coverage Requirements Discovery, CDS Hooks), **DTR** (Documentation Templates & Rules, Questionnaire + CQL), **PAS** (Prior Authorization Support, FHIR↔X12 278).
- **Exchange (Da Vinci / CMS):** **PDex** (payer data exchange), **Plan-Net** (provider directory), **ATR** (member attribution), **PCDE** (coverage decision exchange), **CDex** (clinical data exchange/attachments).
- **CMS-0057-F API set (a conformance target, phased):** Patient Access API, Provider Access API, Payer-to-Payer API, Prior Authorization API, Provider Directory API.
- **Scale & async:** **Bulk Data Access** (`$export`, NDJSON) for Provider Access and Payer-to-Payer; **Subscriptions** (Backport IG) for status notifications.
- **Legacy:** **X12** 278 (request/response), 275 (attachments), and related 27x; FHIR↔X12 translation per PAS mapping.
- **Future exchange:** **TEFCA/QHIN** participation and broader clinical exchange as roadmap; IG-version pinning to manage USCDI/FHIR evolution.

## 10. Security, privacy & AI governance

- HIPAA-aligned handling with BAA support across all tiers; minimum-necessary and role-based access on case data and attachments.
- All FHIR/API access authenticated and scoped (Appendix A); mTLS for partner/system endpoints where applicable.
- PHI-aware logging, redaction, and attachment access policies; full read/write/configuration audit.
- **Human-in-the-loop for adverse actions:** automated paths may approve within configured scope but may never issue a denial, partial denial, or other adverse determination without recorded clinician sign-off (consistent with AI-in-UM regulatory expectations).
- AI features disableable per tenant/workflow; model/prompt versioning recorded per case (§8.6).

## 11. Non-functional requirements

- **Performance:** core reviewer UI actions < 2s median; standard FHIR reads < 1s median; PAS submit acknowledgment near-real-time; real-time determination path returns synchronous decisions for eligible requests within seconds.
- **Throughput/scale:** sustain bursty PA and transaction volumes without cross-tenant degradation in pooled and siloed topologies; Bulk Data exports scale to population-level extracts asynchronously.
- **Availability:** 99.9% for GA endpoints excluding scheduled maintenance; degraded-mode handling for partner outages (queue and retry, never silent drop).
- **Auditability:** immutable event/audit records with exportable evidence packages per case.
- **Conformance:** declared IGs pass Inferno/Touchstone; `CapabilityStatement` accurate to runtime behavior.
- **Accessibility:** WCAG AA for user-facing interfaces.

## 12. Integration requirements

- **Digicore** — CRD content, DTR Questionnaire/CQL, terminology, runtime decision services, rule versions.
- **Revital** — document parsing/extraction, summarization, triage; advisory governance contract.
- **Qualitron** — event/evidence/outcome feed.
- **Core admin platform** (Facets, QNXT, HealthEdge, Epic Payer, etc.) — eligibility/coverage, member/provider data, claims linkage, accumulators.
- **EHR / provider systems** — CRD hooks, DTR app launch, PAS submission, status.
- **Identity providers** — SAML/OIDC federation; SMART/OAuth2 authorization server(s).
- **Document/attachment sources** — portal, fax/OCR, DocumentReference/Binary.
- **Notification channels** — email, webhook, portal, optional messaging partners.
- **Provider directory & terminology services** — Plan-Net, code systems/value sets.

## 13. Metrics & KPIs

- Median and 90th-percentile decision turnaround time by workflow/urgency/LOB.
- % of requests auto/real-time determined; manual-touch rate after intake.
- First-submission documentation completeness rate; RFI rate.
- SLA/regulatory-clock compliance rate and breach count.
- Appeal rate and overturn rate (a signal on determination quality).
- AI assist adoption, acceptance, and override rates.
- API conformance pass rate, endpoint uptime, and PAS round-trip success rate.
- Provider abrasion proxies: status-inquiry volume, resubmission rate.

## 14. Key user journeys

1. **Real-time approval.** Provider's EHR fires CRD at order; PA required; DTR auto-populates documentation; PAS submits; criteria fully met; Enstellar returns an approved `ClaimResponse` in seconds with decision trace.
2. **Pend → RFI → review → decision.** Submission incomplete; auto-pend with structured RFI; clock pauses; provider returns documentation; Revital summarizes; nurse reviews against Digicore criteria; approves or escalates; determination + notification issued; clocks honored.
3. **Adverse determination + peer-to-peer.** Criteria not met; routed to medical director; peer-to-peer scheduled and documented; denial issued with rationale and citations; member/provider notified with appeal rights.
4. **Appeal.** Provider/member appeals; correct LOB/state clock starts; independent reviewer assigned; original evidence and trace reviewed; overturn/uphold recorded and communicated; outcome linked to original case.
5. **Payer-to-payer at enrollment (future).** New member's prior coverage data retrieved via Payer-to-Payer API (PDex/Bulk) and made available to inform care and reduce duplicate authorizations.

## 15. Dependencies & assumptions

- Digicore provides CRD/DTR content and runtime decisioning; Revital provides governed AI services; both are available per the platform roadmap.
- Provider/EHR ecosystem adoption of CRD/DTR/PAS is uneven; portal and X12 channels remain necessary for years.
- Core admin platform exposes eligibility/coverage and accepts authorization linkage.
- DevSecOps foundation supports the deployment-tier model and per-boundary endpoint resolution.
- Conformance tooling (Inferno/Touchstone) and IG versions are tracked as they evolve.

## 16. Release plan (phasing)

- **v1.0 — PA core + foundation.** Multi-channel intake (FHIR PAS, X12 278/275, portal, document); normalization/case model; configurable full UM lifecycle incl. pend/RFI, escalation, determination, notification; Digicore + Revital integration; rules trace + AI governance; case workspace + worklists; eventing/observability; regulatory clocks; FHIR R4/US Core foundation, SMART auth, `CapabilityStatement`; CRD + DTR + PAS conformance.
- **v1.1 — Appeals & exchange entry.** Full appeals & grievances lifecycle; PAS `$inquire`/subscriptions status; Provider Directory (Plan-Net); PA public-metrics reporting.
- **v1.2 — CMS API set.** Patient Access, Provider Access, Payer-to-Payer APIs (PDex + Bulk Data + ATR/opt-in/opt-out); UDAP evaluation for B2B trust.
- **v2.0 — Adjacent use cases.** Concurrent/inpatient review, referrals, claims attachments (CDex), gold-carding/provider-trust waivers; TEFCA/QHIN exploration.

## 17. Risks & mitigations

- **Over-indexing on one rule.** *Mitigation:* standards layer built on underlying IGs; conformance targets are configurable profiles; design for non-mandated exchange and UM from v1.
- **AI-in-UM regulatory/litigation exposure.** *Mitigation:* advisory-only AI, mandatory human sign-off for adverse actions, full model/prompt/version audit, per-tenant disable.
- **X12↔FHIR translation fidelity.** *Mitigation:* canonical model with lossless bidirectional mapping; conformance + regression test suites; raw-payload retention for replay.
- **Uneven provider/EHR adoption of CRD/DTR/PAS.** *Mitigation:* maintain portal and X12 channels; degrade gracefully; meet providers where they are.
- **Regulatory-clock complexity across LOB/state.** *Mitigation:* clocks as configurable profiles with pause/resume rules and business calendars; tested against representative jurisdictions.
- **Conformance maintenance burden as IGs/USCDI evolve.** *Mitigation:* IG-version pinning, automated conformance testing in CI, `CapabilityStatement` generated from runtime.

## 18. Open questions

- Which LOB/state jurisdictions are in scope for v1 clock and notification profiles?
- Which core admin platforms must Enstellar integrate with for the first design-partner tenants (drives connector priority)?
- What is the v1 boundary for "real-time/auto-determination" scope (which service categories are eligible)?
- Will Provider Access opt-out and Payer-to-Payer opt-in be managed in Enstellar or the platform SaaS admin layer?
- UDAP vs. static client trust for B2B endpoints in the first deployments?

## 19. Release criteria (Enstellar GA)

- One end-to-end PA workflow operates across intake → determination → notification → appeals with full traceability, configurable without code changes.
- The same workflow/config artifacts deploy across pooled and siloed tiers without modification.
- CRD, DTR, and PAS conformance verified against the relevant test kits; `CapabilityStatement` accurate.
- Regulatory clocks, SLA breach handling, and PA metrics reporting validated for at least the in-scope LOB/state profiles.
- Human-sign-off enforcement on adverse determinations is demonstrable and audited.
- Support/diagnostics can locate and replay any transaction by identifier without direct DB access.
- Observability supports tenant- and boundary-aware incident response.

---

# Appendix A — FHIR & standards conformance (technical)

This appendix specifies the standards Enstellar implements. It is the conformance reference for engineering; it complements (does not replace) the published HL7/Da Vinci/CMS implementation guides, which are authoritative.

## A.1 Foundation & versions

- **FHIR version:** R4 (4.0.1). Monitor R4B/R5 and Subscriptions backport considerations.
- **Core profiles:** **US Core** (current supported version pinned per deployment), aligned to the applicable **USCDI** version.
- **Conformance declaration:** each deployment publishes a `CapabilityStatement` (`/metadata`) accurately reflecting supported resources, profiles, search params, operations, and security; generated from runtime configuration, not hand-maintained.
- **Terminology:** standard code systems/value sets (SNOMED CT, LOINC, ICD-10-CM/PCS, CPT/HCPCS, NDC, RxNorm, CARC/RARC for X12); value-set binding per profile.

## A.2 Authorization & trust

- **SMART on FHIR (app launch):** OAuth2 authorization-code flow with launch context and SMART scopes for user-facing apps (e.g., DTR SMART app). Scopes follow SMART v1/v2 patterns (`patient/*.read`, `user/*.*`, granular resource scopes).
- **SMART Backend Services:** client-credentials with asymmetric (JWT) client authentication for system-to-system and Bulk Data; registered JWKS; short-lived access tokens.
- **UDAP (forward-looking):** tiered OAuth and dynamic client registration for B2B endpoint trust as the ecosystem matures (relevant to Provider Access / Payer-to-Payer trust).
- **Transport:** TLS 1.2+; mTLS for designated partner/system endpoints; per-boundary token issuers (no cross-boundary token reuse).

## A.3 Prior-authorization burden-reduction trio

### A.3.1 CRD — Coverage Requirements Discovery
- Mechanism: **CDS Hooks**. Enstellar exposes/consumes hook services for `order-select`, `order-sign`, `order-dispatch`, `appointment-book`, and encounter hooks.
- Behavior: returns coverage info cards — PA required (yes/no), documentation requirements, alternatives, and references to governing rules (sourced from Digicore).
- Outputs may launch DTR (SMART app link card).

### A.3.2 DTR — Documentation Templates and Rules
- Artifacts: FHIR **`Questionnaire`** with embedded/related **CQL** logic; executed by a SMART app or EHR-integrated DTR module.
- Behavior: pre-populates from EHR/US Core data, prompts for gaps, produces a **`QuestionnaireResponse`** bundled with the request.
- Enstellar serves payer DTR content (from Digicore) and ingests the completed `QuestionnaireResponse`.

### A.3.3 PAS — Prior Authorization Support
- Operations: **`Claim/$submit`** (PA request) and **`Claim/$inquire`** (status/lookup).
- Resources/profiles: `Claim` (use = `preauthorization`, PAS-profiled), `ClaimResponse`, supporting `Bundle`, `Patient`/US Core, `Coverage`, `Practitioner`/`PractitionerRole`, `Organization`, `Encounter`, `ServiceRequest`, `DocumentReference`, `QuestionnaireResponse`.
- **X12 mapping:** PAS request/response map to/from **X12 278** (and 275 for attachments). Enstellar performs the FHIR↔X12 transformation through the canonical model; trading-partner/clearinghouse connectivity supported where the payer's intermediary requires X12.
- Async: support pended/async responses with subscription or `$inquire` polling.

## A.4 Exchange implementation guides

- **PDex (Payer Data Exchange):** member clinical/claims history exchange; underpins Provider Access and Payer-to-Payer payloads; US Core + PDex profiles; supports query and Bulk.
- **Plan-Net:** provider directory (network, locations, specialties, endpoints) — public, unauthenticated read per CMS.
- **ATR (Member Attribution):** attribution lists (Group/`MemberList`) to scope Provider Access to in-network, treating providers; supports Bulk grouping.
- **PCDE (Payer Coverage Decision Exchange):** structured exchange of prior coverage decisions/clinical context at plan transition.
- **CDex (Clinical Data Exchange):** provider→payer clinical data and attachment requests (query- or Task-based), complementing PAS/275 for documentation.

## A.5 CMS-0057-F API mapping (conformance target)

| CMS API | Underlying IG(s) | Key resources / mechanism | Auth | Notes |
|---|---|---|---|---|
| Patient Access API | US Core, PDex, formulary; CARIN BB (claims) | Patient-scoped FHIR read; adds PA info under 0057 | SMART on FHIR (patient) | Builds on CMS-9115 |
| Provider Access API | PDex, US Core, ATR | Bulk + query of attributed members' data | SMART Backend Services | Attribution + member opt-out |
| Payer-to-Payer API | PDex, US Core | Member history exchange at enrollment | SMART Backend Services / UDAP | Member opt-in |
| Prior Authorization API | CRD + DTR + PAS | CDS Hooks, Questionnaire/CQL, `$submit`/`$inquire` | SMART (app) + Backend (system) | The burden-reduction trio |
| Provider Directory API | Plan-Net | Public FHIR read | None (public) | Unauthenticated per CMS |

CMS decision-timeframe expectations (e.g., expedited 72 hours / standard 7 calendar days for impacted lines) and PA public-metrics reporting are implemented via the regulatory-clock and metrics capabilities (§8.13), expressed as configurable profiles — and coexist with stricter state limits where applicable.

## A.6 Scale, async & notifications

- **Bulk Data Access (Flat FHIR):** `$export` (system/group/patient level), async kickoff + status polling, NDJSON output; used for Provider Access and Payer-to-Payer population extracts; secured via SMART Backend Services.
- **Subscriptions:** R4 **Subscriptions Backport IG** (and R5 topic-based subscriptions as adopted) for PA status and event notifications.
- **Async request pattern:** standard FHIR async (`Prefer: respond-async`) for long-running operations.

## A.7 Legacy X12

- **278** — services review request/response (PA).
- **275** — additional information / attachments.
- **27x family** — eligibility (270/271) and claim status (276/277) where Enstellar participates in status/eligibility flows.
- Translation occurs through the canonical model with lossless bidirectional mapping; raw X12 retained for audit/replay; companion-guide variability handled as configuration.

## A.8 Conformance testing & versioning

- **Test kits:** ONC **Inferno** and AEGIS **Touchstone** for declared IGs (US Core, CRD/DTR/PAS, PDex, Bulk Data, SMART); run in CI against each deployment configuration.
- **IG/version pinning:** US Core/USCDI and Da Vinci IG versions are pinned per deployment and upgraded deliberately; `CapabilityStatement` reflects the pinned set.
- **Backward compatibility:** support concurrent IG versions during ecosystem transitions where required by trading partners.

## A.9 Forward-looking

- **TEFCA / QHIN** participation for nationwide exchange.
- **UDAP** for scaled B2B trust and dynamic registration.
- Expansion of CDex/PCDE usage as adjacent UM and exchange use cases (§7.2) come online.
