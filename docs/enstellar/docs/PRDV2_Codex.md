# PRD V2: Enstellar - Interoperability & Workflow Execution

**Module:** Enstellar (E-01), part of the Simintero payer operating platform  
**Document type:** Product Requirements Document V2  
**Source:** Revised from `docs/enstellar_prd.md` with Codex review feedback incorporated  
**Status:** Draft for product, clinical, compliance, implementation, and engineering review  
**Primary audience:** Product, engineering, UM/clinical SMEs, interoperability, implementation, compliance, customer success  
**Version:** 0.2  

---

## 1. Executive Summary

Enstellar is the interoperability and workflow-execution layer for the Simintero payer platform. It turns inbound clinical and administrative transactions into governed, traceable cases and drives them through a configurable utilization-management lifecycle.

Prior authorization (PA), including the path to appeals, is the first fully specified product use case because it has urgent market demand, regulatory pressure, high provider abrasion, and enough workflow complexity to validate the platform. Enstellar is intentionally broader than PA: it is a reusable engine for payer interoperability, case orchestration, regulatory clocks, document exchange, governed AI assistance, and auditable human decisioning.

The product is not defined by CMS-0057-F alone. CMS-0057-F is one conformance and market driver. Enstellar is built on the underlying standards and workflow capabilities needed across payer operations: FHIR R4, US Core, Da Vinci CRD/DTR/PAS, PDex, Plan-Net, Bulk Data, SMART on FHIR, X12 translation, configurable UM lifecycle management, tenant-aware eventing, and auditable AI governance.

## 2. Product Vision

Enstellar should become the payer operating layer where clinical exchange, administrative intake, utilization-management workflow, documentation collection, status transparency, and decision provenance converge.

The product vision has four pillars:

- **Standards-first interoperability.** Meet providers and partners through FHIR, Da Vinci, SMART, Bulk Data, and X12 instead of forcing bespoke portals and brittle integrations.
- **Deterministic workflow spine.** The state machine is the system of record. Workflow transitions, regulatory clocks, assignments, communications, and decisions are governed by configuration and immutable events.
- **Governed AI assistance.** AI can summarize, extract, flag gaps, and suggest next steps, but cannot independently make coverage determinations or issue adverse actions.
- **Configurable payer operations.** Tenants, lines of business, programs, states, regulatory profiles, templates, routing, and deployment boundaries vary by configuration, not by code fork.

## 3. Product Thesis and Differentiation

Payers are under pressure to modernize PA and broader UM operations while complying with new interoperability mandates. Most existing UM platforms are workflow-heavy but standards-light; most interoperability platforms are exchange-heavy but operationally shallow. Enstellar should occupy the middle: a standards-native workflow execution layer that can receive, normalize, route, decide, communicate, audit, and report across channels.

Key differentiators:

- **FHIR and X12 converge into one canonical case model.** Equivalent inbound requests should produce equivalent operational cases regardless of channel.
- **Regulatory clocks are first-class product objects.** Timeframes, pause/resume rules, escalation, and reporting vary by LOB/state/program and are configurable.
- **Adverse determination safety is built into the engine.** Denials, partial denials, and other adverse outcomes require recorded human sign-off, with clinician sign-off where required.
- **AI is useful without becoming the decision path.** Revital outputs and Enstellar assist agents are advisory, cited, versioned, disableable, and audited.
- **Interoperability is not separated from workflow.** CRD, DTR, PAS, status, attachments, communications, appeals, and metrics all connect back to the same case timeline.
- **Deployment boundary awareness is native.** Pooled, siloed, and dedicated compliance-boundary deployments run the same product while preserving tenant and inference boundaries.

## 4. Target Customers and Buyers

### 4.1 Initial Customer Profile

The first design-partner customers should be payers or payer-adjacent operators with:

- meaningful PA volume and measurable provider abrasion;
- multiple intake channels still in use, especially portal, fax/document, X12, and emerging FHIR;
- regulatory exposure across Medicare Advantage, Medicaid managed care, commercial, or ERISA lines;
- a need to modernize PA without replacing the core claims/admin platform;
- clinical review teams with defined roles for intake, nurse review, medical-director review, and appeals;
- willingness to test electronic PA workflows with a controlled set of provider partners.

### 4.2 Economic Buyers

Primary buyers:

- Chief Operating Officer or VP Operations;
- UM leader or Chief Medical Officer;
- CIO or interoperability executive;
- compliance/regulatory executive for impacted lines of business.

Secondary stakeholders:

- provider relations;
- appeals and grievances leadership;
- implementation and configuration teams;
- security/privacy leadership;
- analytics and quality teams.

### 4.3 Buying Trigger

Likely buying triggers include:

- CMS-0057-F readiness and related state PA mandates;
- pressure to reduce PA turnaround time and provider status calls;
- high RFI/resubmission rates;
- manual fax/document-heavy intake;
- fragmented UM systems and inconsistent audit trails;
- inability to produce reliable PA metrics or appeal-overturn analytics;
- desire to use AI assistance without creating regulatory exposure.

## 5. Scope

### 5.1 In Scope

Enstellar covers:

- PA coverage discovery, documentation gathering, intake, normalization, completeness validation, triage, review, determination, notification, appeal linkage, closure, and reporting;
- FHIR/Da Vinci CRD, DTR, PAS, US Core foundation, SMART authorization, X12 278/275 support, and status APIs;
- reviewer and operational worklists;
- configuration of workflows, queues, clocks, templates, routing, conformance profiles, and channel settings;
- AI-assist orchestration and governance;
- immutable, tenant-scoped events with provenance;
- support, diagnostics, transaction replay, and evidence/audit package generation.

### 5.2 Out of Scope

Enstellar does not:

- author clinical coverage policies or criteria; Digicore owns policy and rule authoring;
- perform document AI or summarization itself; Revital owns heavy extraction/summarization services;
- replace the core claims or administrative platform;
- adjudicate claims;
- provide autonomous denials or adverse determinations;
- build a provider-side EHR authoring product separate from payer-side endpoints and portals;
- hand-maintain FHIR conformance artifacts that should be generated from pinned profiles and runtime configuration.

## 6. Release Strategy and Scope Boundaries

The original PRD used "v1" broadly. This V2 separates walking skeleton, design-partner release, GA, and post-GA scope so product, engineering, and implementation can reason about tradeoffs.

| Release | Product Name | Scope | Outcome |
|---|---|---|---|
| P0 | Walking skeleton | Local stack, tenant context, canonical model, event envelope, HAPI FHIR foundation, PAS happy-path submit/inquire, Digicore decision call, approve-only auto-determination, traceable ClaimResponse | Demonstrable end-to-end PA approval path |
| P1 | Design-partner PA core | Multi-channel intake, configurable PA lifecycle through determination, worklists, reviewer workspace, RFI, clocks, communications, X12 278/275, Revital advisory outputs, no-autonomous-adverse enforcement | A UM team can operate real PA workflows excluding full appeals |
| P2 | GA complete UM + appeals | Appeals/grievances, PAS status/subscriptions, Plan-Net, PA public metrics, validated clock and notification profiles for selected jurisdictions | Complete PA/UM workflow including appeals for first GA markets |
| P3 | CMS API expansion | Patient Access, Provider Access, Payer-to-Payer, PDex, Bulk Data, ATR, opt-in/out, UDAP decision | Broader CMS interoperability API set |
| P4 | Adjacent workflows | Concurrent review, claims attachments/CDex, referrals, gold-carding, payment-integrity documentation, TEFCA exploration | Platform breadth beyond PA |

### 6.1 MVP Definition

The MVP is P1: design-partner PA core. It must be safe, auditable, and operationally usable for a bounded PA workflow, but it does not need every CMS API or every jurisdictional appeals variant.

MVP must prove:

- equivalent FHIR and X12 intake normalize into the same case model;
- a case can move from intake through determination and notification;
- reviewers can work cases without leaving the workspace for core context;
- clocks, routing, templates, and workflow steps are configuration-driven;
- adverse determinations cannot occur without required human sign-off;
- AI assistance can be enabled, disabled, audited, accepted, or overridden;
- support can trace and replay a transaction by correlation ID.

### 6.2 GA Definition

GA requires P2 completion for the first in-scope customer segment and jurisdictions:

- complete PA lifecycle including appeals and grievances;
- validated regulatory clocks and notification templates for selected LOB/state profiles;
- CRD, DTR, PAS, US Core, SMART, and Plan-Net conformance for declared capabilities;
- PA metrics reporting that reconciles to case data;
- operational runbooks, support workflows, and customer implementation playbook.

## 7. Goals

- **G1.** Provide a configurable, auditable workflow engine for the full UM lifecycle without per-tenant code forks.
- **G2.** Deliver a standards-first interoperability layer that satisfies CMS-0057-F and supports broader exchange use cases.
- **G3.** Reduce administrative burden and turnaround time through structured intake, completeness checks, auto-approval where safe, and guided review.
- **G4.** Reduce provider abrasion through transparent status, electronic RFIs, fewer duplicate submissions, and consistent documentation requirements.
- **G5.** Preserve explainability and auditability for every rule, recommendation, document, decision, notification, and user action.
- **G6.** Meet regulatory and accreditation timeframes through configurable clocks and escalation, not hard-coded rules.
- **G7.** Support adjacent workflows without re-platforming.
- **G8.** Give implementation teams safe configuration tools for workflow, clocks, templates, routing, and conformance profiles.
- **G9.** Create a measurable business case through lower manual-touch rate, fewer status inquiries, lower RFI/resubmission rates, and better SLA compliance.

## 8. Non-Goals

- Enstellar does not create clinical criteria.
- Enstellar does not allow LLMs or inference services to participate in a coverage determination.
- Enstellar does not replace core admin, claims adjudication, provider credentialing, or enterprise data warehouse systems.
- Enstellar does not guarantee universal EHR adoption of CRD/DTR/PAS; portal, X12, and document channels remain required.
- Enstellar does not ship a one-off implementation per tenant.

## 9. Personas

### 9.1 External and Operational Users

- **UM intake coordinator.** Monitors intake queues, resolves completeness issues, links duplicate submissions, manages RFIs.
- **UM nurse / clinical reviewer.** Reviews cases against criteria, evidence, documents, and AI advisory outputs; approves within scope or escalates.
- **Medical director / physician reviewer.** Handles escalations, peer-to-peer, and adverse determinations requiring clinical sign-off.
- **Appeals and grievances specialist.** Manages appeal intake, classification, independent review assignment, clocks, and outcomes.
- **Provider-facing operations user.** Supports provider status inquiries, documentation completeness, and channel issues.
- **Provider user.** Submits or tracks requests, responds to RFIs, receives determinations and appeal information.
- **Member services user.** Answers member questions and verifies communications, status, and appeal rights within permitted access.
- **Payer administrator.** Configures workflows, queues, templates, clocks, routing, channels, and entitlements.

### 9.2 Internal Platform Users

- **Implementation consultant.** Configures tenant workflows, LOB/program profiles, integrations, and conformance settings.
- **Support engineer.** Investigates stuck transactions, replay paths, conformance issues, and partner incidents without direct DB surgery.
- **Interop engineer.** Manages FHIR, X12, SMART, UDAP, trading-partner, and conformance behavior.
- **Security/compliance reviewer.** Audits access, PHI handling, configuration changes, AI use, and adverse-determination guardrails.

## 10. Key User Journeys

### 10.1 Real-Time Approval

A provider's EHR fires CRD at order. PA is required. DTR gathers structured documentation. PAS submits the request. Criteria are fully met for a configured low-risk category. Enstellar records the rule version, creates the case, emits events, and returns an approved ClaimResponse within seconds.

### 10.2 Incomplete Submission to RFI

A request arrives missing required documentation. Enstellar validates against active requirements, pends the case, issues a structured RFI, pauses or adjusts clocks according to the governing profile, receives the response, and resumes workflow with a complete evidence trail.

### 10.3 Clinical Review and Determination

A nurse reviewer opens a worklist sorted by SLA risk, reviews member/context/service lines/documents, sees Digicore rules trace and Revital advisory summary, captures rationale, approves or escalates, and generates the appropriate notification.

### 10.4 Adverse Determination

Criteria are not met. The case routes to a medical director where required. Peer-to-peer can be scheduled and documented. A denial, partial denial, or modification cannot be issued until required human sign-off, rationale, citations, and communication artifacts are recorded.

### 10.5 Appeal

A member or provider appeals. Enstellar links the appeal to the original case and determination, starts the correct clock, routes to an independent reviewer with conflict checks, records uphold/overturn/modify rationale, updates communications, and preserves full audit linkage.

### 10.6 Provider Status Transparency

A provider checks status through PAS inquire, subscription, portal, or configured channel. Enstellar returns consistent status semantics with timestamps, outstanding actions, and communication history without exposing impermissible member or internal review details.

## 11. Functional Requirements

Requirements use IDs `ENS-<area>-<n>`. "Must" means required for the stated release. "Should" means expected unless explicitly descoped. "May" means roadmap.

### 11.1 Intake and Channel Management - `ENS-INT`

- **ENS-INT-1 (P1 must).** Accept PA requests and supporting documentation via FHIR PAS, X12 278/275, authenticated provider portal, and document/fax intake with OCR handoff.
- **ENS-INT-2 (P0 must).** Assign each inbound transaction a tenant-scoped correlation ID and persist the raw payload before transformation.
- **ENS-INT-3 (P1 must).** Support synchronous and asynchronous intake, including PAS async status through polling or subscription.
- **ENS-INT-4 (P1 should).** Deduplicate and link related transactions, attachments, resubmissions, and corrections into the same case.
- **ENS-INT-5 (P1 must).** Provide channel-specific validation errors that can be returned to the submitter or surfaced to operations users.
- **ENS-INT-6 (P2 should).** Support bulk operational monitoring of partner/channel failure rates.

Acceptance criteria:

- A valid PAS bundle creates a case with a correlation ID and retained raw payload.
- An equivalent X12 278 produces a functionally equivalent canonical case.
- A 278 plus later 275 attachment links to the same case when identifiers match.
- Invalid payloads are rejected or pended with a reason that is visible to support and operations users.

### 11.2 Canonical Case Model - `ENS-MDL`

- **ENS-MDL-1 (P0 must).** Normalize intake into canonical entities: case, request/service lines, member, coverage, providers, encounter, documents, questionnaire responses, tasks, events, decisions, communications, and appeals.
- **ENS-MDL-2 (P1 must).** Preserve bidirectional mapping between canonical model, FHIR resources, and X12 segments without lossy collapse of required clinical or operational fields.
- **ENS-MDL-3 (P0 must).** Propagate tenant, LOB, program, product, group, and region context on every persisted entity and event.
- **ENS-MDL-4 (P0 must).** Maintain immutable event history sufficient to reconstruct case state.
- **ENS-MDL-5 (P1 must).** Track source provenance for each document, field, rule result, AI extraction, communication, and decision.

Acceptance criteria:

- Representative FHIR and X12 fixtures round-trip through canonical mapping without loss of declared required fields.
- Tenant context is present on every persisted record, event, and log entry.
- A case can be reconstructed from its event history and source artifacts.

### 11.3 Coverage Discovery and Documentation - `ENS-DOC`

- **ENS-DOC-1 (P1 must).** Integrate Digicore CRD content to determine whether PA is required and which documentation applies.
- **ENS-DOC-2 (P1 must).** Serve DTR Questionnaire and CQL artifacts and accept QuestionnaireResponse payloads.
- **ENS-DOC-3 (P1 must).** Validate submitted documentation against active requirements and produce structured gaps.
- **ENS-DOC-4 (P2 should).** Support CDex-style task-based documentation requests.
- **ENS-DOC-5 (P1 must).** Pin the documentation requirement version used for a case.

Acceptance criteria:

- "No authorization required" responses include the governing rule reference.
- Required documentation templates are correct for member, plan, service, LOB, and region context.
- Structured gaps can drive an RFI without free-text re-entry.

### 11.4 Workflow Orchestration - `ENS-WF`

- **ENS-WF-1 (P1 must).** Provide a configurable state machine covering intake, completeness, auto-determination, triage, assignment, clinical review, RFI, peer-to-peer, escalation, determination, notification, reopening, and closure.
- **ENS-WF-2 (P2 must).** Extend the state machine to appeals and grievances.
- **ENS-WF-3 (P1 must).** Support assignment and routing by specialty, LOB, urgency, license/credential, workload, calendar, and supervisor override.
- **ENS-WF-4 (P1 must).** Provide queues and worklists with SLA-aware sorting, filters, saved views, and bulk actions.
- **ENS-WF-5 (P0/P1 must).** Support approve-only auto-determination for configured low-complexity cases that fully meet criteria.
- **ENS-WF-6 (P1 must).** Ensure every step is idempotent, replayable, and diagnosable after failure.
- **ENS-WF-7 (P1 should).** Support versioned workflow definitions with sandbox-to-UAT-to-production promotion and rollback.
- **ENS-WF-8 (P1 must).** Enforce adverse-transition guards in the workflow engine, not only in the UI.

Acceptance criteria:

- Routing and SLA changes can take effect through approved configuration without deployment.
- Automated paths can approve but cannot deny, partially deny, or modify adversely.
- Failed external calls leave the case recoverable and visible to support.

### 11.5 Rules and Decision Integration - `ENS-RUL`

- **ENS-RUL-1 (P0 must).** Consume Digicore runtime decision services.
- **ENS-RUL-2 (P1 must).** Present a rules trace showing policy version, criteria, questionnaire, evidence path, and recommendation.
- **ENS-RUL-3 (P1 must).** Pin rule and policy versions for every case and retain them after supersession.
- **ENS-RUL-4 (P1 must).** Record reviewer rationale and deviations from rules recommendations.

Acceptance criteria:

- Any determination can be audited against the exact criteria and evidence available at the time of decision.
- Appeals users can see the original rule trace and subsequent updates separately.

### 11.6 Governed AI Assistance - `ENS-AI`

- **ENS-AI-1 (P1 must).** Surface Revital outputs: cited summary, extracted entities, completeness flags, conflict flags, triage suggestion, and confidence.
- **ENS-AI-2 (P1 must).** Record model, prompt/template versions, referenced inputs, output, confidence, and user action for every AI interaction.
- **ENS-AI-3 (P1 must).** Allow AI to be disabled by tenant, workflow, role, or deployment boundary.
- **ENS-AI-4 (P1 must).** Resolve inference only to authorized endpoints for the tenant and boundary.
- **ENS-AI-5 (P1 must).** Require citations or source references for AI-generated clinical or administrative assertions.
- **ENS-AI-6 (P1 must).** Capture accept, edit, reject, or override actions and reasons where AI output affects workflow artifacts.

Acceptance criteria:

- AI-disabled workflows remain fully usable.
- Every AI-touched case includes an audit trail.
- AI output alone cannot trigger an adverse determination or commit a state transition.

### 11.7 Document and Attachment Management - `ENS-ATT`

- **ENS-ATT-1 (P1 must).** Ingest, store, and associate attachments from FHIR DocumentReference/Binary, X12 275, portal upload, and fax/document intake.
- **ENS-ATT-2 (P1 must).** Apply access policies, redaction, and minimum-necessary controls.
- **ENS-ATT-3 (P1 must).** Hand documents to Revital and retain provenance linking extracted evidence to source documents.
- **ENS-ATT-4 (P1 should).** Support document versioning, replacement, duplicate detection, and withdrawal.
- **ENS-ATT-5 (P2 should).** Support legal hold and audit export packaging for appeals and disputes.

Acceptance criteria:

- An attachment from any channel is visible in the case with source, timestamp, submitter, access policy, and extraction provenance.
- Redacted and full-access views respect role and tenant policy.

### 11.8 Communications and Notifications - `ENS-COM`

- **ENS-COM-1 (P1 must).** Generate provider and member RFIs, determinations, status updates, and letters using configurable templates.
- **ENS-COM-2 (P1 must).** Deliver status and determinations through FHIR Communication/CommunicationRequest, PAS inquire, subscriptions, portal, and configured channels.
- **ENS-COM-3 (P1 must).** Maintain provider-facing status semantics with timestamps.
- **ENS-COM-4 (P2 must).** Include appeal rights and jurisdiction-specific content for adverse determinations.
- **ENS-COM-5 (P2 should).** Support member language, format, and accessibility preferences where provided.
- **ENS-COM-6 (P1 must).** Audit generated content, delivery channel, delivery status, and recipient.

Acceptance criteria:

- A determination creates compliant notification artifacts and status updates within the applicable SLA.
- Provider and member communications can vary by LOB/state/program/template version.

### 11.9 Reviewer and Operations UI - `ENS-UI`

- **ENS-UI-1 (P1 must).** Provide reviewer workspace with case header, service lines, member/coverage, provider context, documents, rules trace, AI advisory panel, RFI actions, decision capture, and unified timeline.
- **ENS-UI-2 (P1 must).** Provide worklists with SLA views, assignments, filters, saved views, bulk actions, and supervisor views.
- **ENS-UI-3 (P1 must).** Support adverse decision capture with required sign-off, rationale, citations, and notification readiness checks.
- **ENS-UI-4 (P2 should).** Provide provider-facing status views through portal or exposed APIs.
- **ENS-UI-5 (P1 should).** Provide support views for transaction tracing, replay eligibility, and external-call diagnostics.
- **ENS-UI-6 (P1 must).** Meet WCAG AA for user-facing interfaces.

Acceptance criteria:

- A reviewer can complete a standard case end to end from the workspace.
- The UI does not permit completion of adverse actions until required sign-off and rationale fields are satisfied.

### 11.10 Appeals and Grievances - `ENS-APP`

- **ENS-APP-1 (P2 must).** Support appeal/grievance intake linked to the originating case.
- **ENS-APP-2 (P2 must).** Classify appeal type, level, urgency, LOB, state, and applicable clock profile.
- **ENS-APP-3 (P2 must).** Assign independent or secondary reviewers with conflict-of-interest checks.
- **ENS-APP-4 (P2 must).** Capture uphold, overturn, modify, external review referral, reopening, and rationale.
- **ENS-APP-5 (P2 must).** Preserve audit linkage between original determination, appeal evidence, reviewers, communications, and outcome.

Acceptance criteria:

- An expedited appeal starts the correct clock, routes to an eligible reviewer, and records outcome with complete linkage to the original case.

### 11.11 Interoperability APIs - `ENS-API`

- **ENS-API-1 (P1 must).** Expose FHIR R4/US Core foundation and PA-related Da Vinci CRD/DTR/PAS surfaces.
- **ENS-API-2 (P1 must).** Publish a generated CapabilityStatement per deployment.
- **ENS-API-3 (P1 must).** Enforce SMART on FHIR and SMART Backend Services authorization.
- **ENS-API-4 (P2 must).** Support PAS inquire and status subscriptions.
- **ENS-API-5 (P2 must).** Support Plan-Net provider directory for declared scope.
- **ENS-API-6 (P3 must).** Support Patient Access, Provider Access, and Payer-to-Payer APIs for declared CMS API scope.

Acceptance criteria:

- Declared endpoints pass relevant Inferno/Touchstone tests.
- CapabilityStatement matches runtime behavior and pinned IG versions.

### 11.12 Eventing, Observability, and Support - `ENS-EVT`

- **ENS-EVT-1 (P0 must).** Emit tenant-scoped immutable events for state transitions, external calls, rule evaluations, AI interactions, and user actions.
- **ENS-EVT-2 (P1 must).** Support search by case ID, transaction ID, FHIR resource ID, document ID, tenant, and correlation ID.
- **ENS-EVT-3 (P1 must).** Track business and operational status per case and aggregate.
- **ENS-EVT-4 (P1 must).** Provide support diagnostics without requiring direct database access.
- **ENS-EVT-5 (P1 should).** Provide replay eligibility rules and safe replay controls.

Acceptance criteria:

- A support engineer can locate any transaction by supported identifier and inspect its path.
- A case can be reconstructed from event history and source artifacts.

### 11.13 Regulatory Clocks, SLA, and Metrics - `ENS-CLK`

- **ENS-CLK-1 (P1 must).** Configure decision-timeframe clocks by LOB/state/program/product/urgency.
- **ENS-CLK-2 (P1 must).** Support pause, resume, tolling, escalation, and business-calendar rules.
- **ENS-CLK-3 (P1 must).** Detect breach risk and actual breach, with alerts and queue priority changes.
- **ENS-CLK-4 (P2 must).** Produce PA public metrics by reporting profile.
- **ENS-CLK-5 (P2 must).** Reconcile metrics to source case data and clock events.

Acceptance criteria:

- Changing a state's standard-decision limit is a governed configuration change.
- Clock behavior is validated against representative jurisdictional test cases.

### 11.14 Configuration and Multi-Tenancy - `ENS-CFG`

- **ENS-CFG-1 (P1 must).** Configure workflows, queues, routing, templates, clocks, conformance profiles, channel settings, and AI policy by tenant.
- **ENS-CFG-2 (P1 must).** Scope data and configuration by tenant hierarchy: tenant, LOB, program, product, group, region.
- **ENS-CFG-3 (P1 must).** Run the same product across pooled, siloed, and boundary tiers.
- **ENS-CFG-4 (P1 must).** Support draft, review, approve, publish, effective-date, and rollback lifecycle for high-risk configuration.
- **ENS-CFG-5 (P1 must).** Audit every configuration change.
- **ENS-CFG-6 (P1 should).** Provide simulation/test mode before configuration activation.

Acceptance criteria:

- Two tenants with different workflows, templates, clocks, and AI policies run on the same release without code divergence.
- High-risk configuration cannot be published without required approval.

## 12. Configuration Governance

Configuration is product functionality, not implementation detail. Enstellar must prevent unsafe or unreviewed operational changes.

High-risk configuration includes:

- workflow transitions and guards;
- regulatory clock profiles;
- adverse determination templates;
- appeal rights language;
- AI enablement and redaction policy;
- FHIR conformance profiles;
- boundary endpoint resolution;
- role and permission mappings.

Required governance:

- draft configuration version;
- validation and simulation;
- reviewer approval;
- effective date and optional expiration;
- production publish;
- rollback to previous approved version;
- immutable audit of author, reviewer, approval, and activation.

## 13. Role and Permission Matrix

The detailed matrix should live in the implementation specification, but the PRD requires these product-level controls.

| Role | Key Permissions | Restrictions |
|---|---|---|
| Intake coordinator | View assigned intake, resolve gaps, issue RFIs, link submissions | Cannot issue adverse determinations |
| Nurse reviewer | Review evidence, approve within scope, pend/RFI, escalate | Cannot issue physician-required adverse determinations |
| Medical director | Sign adverse determinations, peer-to-peer documentation, escalations | Subject to conflict and credential checks |
| Appeals specialist | Manage appeal intake, clocks, communications, independent review workflow | Cannot review appeals where conflict exists |
| Provider user | Submit, respond to RFI, view permitted status and determinations | No internal reviewer notes or unrelated member data |
| Member services user | View permitted member-facing status and communications | No internal privileged review material unless authorized |
| Tenant admin | Configure tenant workflows, templates, routing, clocks, roles | High-risk config requires approval |
| Support engineer | Trace transactions, inspect events, initiate safe replay where permitted | No unnecessary PHI exposure; break-glass audited |
| Compliance auditor | Read audit, evidence packages, configuration history | Read-only unless separately authorized |

## 14. Security, Privacy, and AI Governance

- Enstellar must be HIPAA-aligned and support BAA obligations across deployment tiers.
- PHI must be minimized, redacted where configured, and never logged in clear text.
- Tenant and deployment boundary must be enforced on every request, query, event, document, cache, and log line.
- All FHIR and API access must be authenticated and scoped.
- mTLS must be supported for designated partner/system endpoints.
- All read, write, decision, AI, document, and configuration actions must be audited.
- AI assistance must be disableable by tenant/workflow and must never be required for baseline workflow operation.
- AI outputs must be cited, versioned, and treated as advisory.
- Adverse determinations require recorded human sign-off, with clinician sign-off where required.
- No LLM or inference output can be the sole basis for denial, partial denial, or other adverse action.

## 15. Standards and Conformance Requirements

### 15.1 Foundation

- FHIR R4 4.0.1.
- US Core profiles pinned per deployment.
- USCDI alignment according to customer and regulatory scope.
- Generated CapabilityStatement per deployment.
- Terminology support for SNOMED CT, LOINC, ICD-10-CM/PCS, CPT/HCPCS, NDC, RxNorm, CARC/RARC, and configured value sets.

### 15.2 Authorization and Trust

- SMART on FHIR app launch for user-facing integrations.
- SMART Backend Services for system-to-system and Bulk Data.
- Short-lived tokens and scoped authorization.
- mTLS where required by partner or boundary profile.
- UDAP decision required before P3 B2B trust expansion.

### 15.3 Prior Authorization Standards

- CRD through CDS Hooks.
- DTR through FHIR Questionnaire, CQL, SMART app or EHR-integrated execution, and QuestionnaireResponse.
- PAS through Claim/$submit and Claim/$inquire.
- X12 278 request/response and X12 275 attachments through canonical model mapping.
- Async handling through FHIR async patterns, inquiry, and subscriptions where declared.

### 15.4 Exchange Roadmap

- P2: Plan-Net provider directory and status subscriptions.
- P3: Patient Access, Provider Access, Payer-to-Payer, PDex, Bulk Data, ATR, opt-in/out.
- P4: CDex expansion, PCDE, TEFCA/QHIN exploration.

## 16. Non-Functional Requirements

- **Performance.** Core reviewer UI actions under 2 seconds median. Standard FHIR reads under 1 second median. Eligible real-time approvals within seconds.
- **Throughput.** Support bursty transaction volume without cross-tenant degradation.
- **Availability.** 99.9% for GA endpoints, excluding scheduled maintenance.
- **Reliability.** Partner outages queue and retry. No silent drops.
- **Auditability.** Immutable audit and event records with exportable evidence packages.
- **Conformance.** Declared IGs pass relevant Inferno/Touchstone test suites.
- **Accessibility.** WCAG AA for user-facing interfaces.
- **Operability.** Support can trace, diagnose, and replay eligible transactions without direct DB access.
- **Portability.** Same product artifacts run locally, in cloud, and in boundary deployments through ports/adapters.

## 17. Integrations

- **Digicore.** CRD content, DTR Questionnaire/CQL, terminology, runtime decision services, rule versions, rules trace.
- **Revital.** Document parsing, extraction, summarization, triage, advisory confidence, citations.
- **Qualitron.** Event, evidence, outcome, quality, and analytics feeds.
- **Core admin platforms.** Eligibility, coverage, member/provider data, claims linkage, accumulators, authorization linkage.
- **EHR/provider systems.** CRD hooks, DTR launch/execution, PAS submission, status.
- **Identity providers.** SAML/OIDC federation, SMART/OAuth2 authorization server integration.
- **Document channels.** Portal upload, fax/OCR, DocumentReference/Binary, X12 275.
- **Notification channels.** Portal, email, webhook, FHIR communication, optional messaging partners.
- **Provider directory and terminology services.** Plan-Net and code/value-set services.

## 18. Metrics and Success Targets

Final targets should be set with design partners. Initial target candidates:

| Metric | MVP Target Candidate | GA Target Candidate |
|---|---:|---:|
| Median standard PA turnaround | 25% improvement vs baseline | 40% improvement vs baseline |
| P90 expedited PA turnaround | Meets configured clock in pilot profile | 95%+ clock compliance |
| First-submission completeness | 15% improvement vs baseline | 30% improvement vs baseline |
| RFI rate | 10% reduction vs baseline | 25% reduction vs baseline |
| Provider status inquiry volume | 15% reduction for pilot providers | 35% reduction for onboarded providers |
| Auto/real-time approval rate | Measured for configured categories | Target per service category |
| Manual-touch rate after intake | Baseline established | 20% reduction vs baseline |
| Appeal overturn rate | Baseline established | Used as quality signal, not optimized blindly |
| AI assist acceptance/override | Baseline established | Monitored by workflow and reviewer role |
| PAS round-trip success | 95%+ in controlled pilot | 99%+ for declared production partners |
| Conformance pass rate | 100% for declared must-pass tests | 100% for declared must-pass tests |

These targets should not incentivize inappropriate denial, under-review, or unsafe automation. Quality and safety metrics must be reviewed with clinical and compliance leadership.

## 19. Adoption and Migration

Enstellar should support incremental adoption rather than forcing a big-bang migration.

Adoption phases:

1. **Observe and normalize.** Ingest selected channels, build canonical cases, emit events, and compare against existing operations.
2. **Operate a bounded workflow.** Run a limited service category, LOB, region, or provider pilot through Enstellar.
3. **Expand channels.** Add X12, portal, document, and FHIR partners incrementally.
4. **Expand workflow.** Add RFI, medical-director review, communications, and appeals.
5. **Expand interoperability.** Add Plan-Net, status subscriptions, Provider Access, Payer-to-Payer, and Bulk Data.

Migration requirements:

- map existing status codes and decision outcomes;
- import or reference in-flight cases where needed;
- support dual-run reporting during transition;
- preserve legacy identifiers for lookup;
- provide implementation checklists and validation fixtures.

## 20. Operational Readiness

Before GA, Enstellar must provide:

- tenant onboarding checklist;
- integration onboarding checklist;
- conformance test runbook;
- clock/profile validation pack;
- adverse-determination guard test evidence;
- support dashboard and transaction lookup;
- replay policy and replay tooling;
- incident response runbook;
- PHI/logging audit checklist;
- evidence package export for audits and appeals;
- backup/restore and disaster recovery procedure;
- customer-facing implementation guide.

## 21. Dependencies and Assumptions

- Digicore provides versioned CRD/DTR content and runtime decisioning.
- Revital provides governed AI services with citations, confidence, and provenance.
- Core admin platforms expose eligibility, coverage, member/provider context, and authorization linkage.
- Provider/EHR adoption of CRD/DTR/PAS remains uneven; portal, document, and X12 channels remain necessary.
- DevSecOps supports deployment-tier boundaries and endpoint resolution.
- Conformance tools and IG versions are tracked as they evolve.
- First GA jurisdictions and LOBs are selected before clock/template completion.

## 22. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Scope too broad for initial release | Separate P0/P1/P2/P3/P4 scope; treat P1 as design-partner MVP |
| Over-indexing on CMS-0057-F | Build on standards and configurable profiles, not one regulation |
| AI regulatory/litigation exposure | Advisory-only AI, disablement, provenance, human sign-off for adverse actions |
| X12/FHIR translation fidelity | Lossless canonical model, raw retention, regression fixtures, conformance tests |
| Provider adoption variability | Maintain portal, X12, document, and FHIR channels |
| Clock complexity across jurisdictions | Configurable clock profiles, jurisdictional fixture tests, governed config approval |
| Configuration mistakes causing compliance risk | Draft/review/approve/publish lifecycle, simulation, audit, rollback |
| HAPI/FHIR performance tuning burden | Load tests, caching, OpenSearch for worklists, clear service boundaries |
| Core admin integration variability | Prioritize first design-partner connectors; isolate behind connector contracts |
| PHI leakage through logs or inference | Redaction, minimum necessary, boundary-aware model access, log scanning |

## 23. Open Questions

The following must be resolved before P1/P2 completion:

- Which LOBs and states are in scope for MVP and GA clock profiles?
- Which first design-partner payer segment is primary: MA, Medicaid MCO, commercial, or multi-LOB?
- Which core admin connector is required first?
- Which service categories are eligible for approve-only real-time determination?
- What status semantics should providers see across PAS inquire, subscription, portal, and support channels?
- Which communication templates and languages are required for GA?
- Which configuration changes require two-person approval?
- Will Provider Access opt-out and Payer-to-Payer opt-in live in Enstellar or a broader Simintero admin layer?
- What is the initial UDAP posture: deferred, static trust, or early dynamic registration?
- What are the data retention, legal hold, and evidence export requirements by LOB/state/customer?

## 24. Release Criteria

### 24.1 P1 Design-Partner MVP

- One bounded PA workflow operates from intake through determination and notification.
- FHIR PAS and at least one non-FHIR intake channel normalize into canonical cases.
- Reviewer workspace supports standard case review.
- Worklists and assignments are SLA-aware.
- Regulatory clocks work for selected pilot profiles.
- Adverse determinations require engine-enforced human sign-off.
- AI can be enabled and disabled without breaking workflow.
- Support can locate and trace transactions by correlation ID.
- Core conformance smoke tests pass for declared P1 capabilities.

### 24.2 P2 GA

- Complete PA workflow including appeals and grievances works for selected GA profiles.
- CRD, DTR, PAS, US Core, SMART, Plan-Net, and status capabilities pass declared conformance tests.
- Clock, notification, and appeal profiles are validated for in-scope jurisdictions.
- PA metrics reconcile to source case events.
- Configuration governance is operational.
- Audit/evidence package export is available.
- Observability supports tenant- and boundary-aware incident response.
- Operational runbooks and implementation playbooks are complete.

## 25. Appendix A - Standards Summary

This appendix summarizes the conformance surface. Authoritative details remain the pinned HL7, Da Vinci, CMS, and trading-partner implementation guides.

### A.1 FHIR Foundation

- FHIR R4 4.0.1.
- US Core pinned per deployment.
- CapabilityStatement generated from runtime configuration.
- Search parameters, profiles, operations, and security declarations match runtime behavior.

### A.2 SMART and Trust

- SMART app launch for user-facing workflows.
- SMART Backend Services for system clients and Bulk Data.
- mTLS for designated partners.
- UDAP evaluated for P3 B2B endpoint trust.

### A.3 CRD

- CDS Hooks for order-select, order-sign, order-dispatch, appointment-book, and applicable encounter hooks.
- Cards return PA required/not required, documentation requirements, alternatives, and governing rule references.
- DTR launch links where applicable.

### A.4 DTR

- Questionnaire and CQL artifacts sourced from Digicore.
- QuestionnaireResponse accepted and attached to the case.
- Documentation requirement version pinned.

### A.5 PAS

- Claim/$submit and Claim/$inquire.
- Claim use = preauthorization.
- ClaimResponse for decisions and status.
- Supporting resources include Patient, Coverage, Practitioner, PractitionerRole, Organization, Encounter, ServiceRequest, DocumentReference, and QuestionnaireResponse.
- Async status through inquiry or subscription where supported.

### A.6 X12

- 278 request/response.
- 275 attachments.
- Related 27x where participation is needed.
- Companion-guide variability handled through configuration.
- Raw X12 retained for audit and replay.

### A.7 CMS API Roadmap

| CMS API | Underlying IGs | Release |
|---|---|---|
| Prior Authorization API | CRD, DTR, PAS | P1/P2 |
| Provider Directory API | Plan-Net | P2 |
| Patient Access API | US Core, PDex, formulary, CARIN BB where applicable | P3 |
| Provider Access API | PDex, US Core, ATR, Bulk Data | P3 |
| Payer-to-Payer API | PDex, US Core, Bulk Data, PCDE where applicable | P3 |

## 26. Appendix B - Requirement Scenario Matrix

Representative scenario coverage should include:

| Scenario Family | Required Examples |
|---|---|
| Intake | PAS submit, X12 278, 275 attachment, portal submission, fax/document intake, duplicate submission |
| Determination | approve, pend, RFI, modify, partial denial, denial, withdrawal, reopen |
| Safety | auto-approve allowed, auto-deny blocked, AI-deny blocked, missing clinician sign-off blocked |
| Clocks | standard, expedited, RFI pause/resume, stricter state rule, business calendar, breach escalation |
| Appeals | standard appeal, expedited appeal, independent review, overturn, uphold, external review |
| Tenancy | pooled tenant isolation, siloed tenant, boundary endpoint resolution, no cross-boundary inference |
| AI | enabled, disabled, low confidence abstain, ungrounded output blocked, user override |
| Communications | provider RFI, member denial letter, appeal rights, status inquiry, delivery failure |
| Conformance | US Core, CRD, DTR, PAS, SMART, Plan-Net, Bulk Data by release |

## 27. Appendix C - PRD V2 Change Log

This V2 incorporates the following changes from Codex review:

- clarifies customer, buyer, buying trigger, and product differentiation;
- reconciles broad v1 language with P0/P1/P2/P3/P4 delivery phases;
- defines MVP and GA release boundaries;
- adds configuration governance as a product requirement;
- expands provider/member/status and communications requirements;
- adds role and permission matrix;
- adds adoption and migration requirements;
- adds operational readiness requirements;
- converts KPI list into target candidates;
- expands risks to include configuration, integration, and PHI/inference risks;
- adds a scenario matrix for stronger acceptance testing.
