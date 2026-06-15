# Divergence Register — Ratified v1.0 (commit to `audit/divergence-register.md`)

**Source audit:** 2026-06-10, HEAD `84b3315` · **Ratification:** Architecture review ____ (sign/date)
**Status values:** `OPEN → IN-PROGRESS → DONE → VERIFIED` (VERIFIED = rescan invariant passes in CI)
**Owners:** placeholder roles — assign named individuals at ratification.
**Rule:** this file is the conformance changelog. Every PR that remediates a DIV references its ID; the rescan after each tranche flips statuses to VERIFIED. No row may be deleted — superseded rows are struck through with a note.

---

## Tranche 0 — This week (stop the bleeding)

| ID | Summary | Sev | Irrev. | Disposition | Owner | Tranche | ADR | Status |
|---|---|---|---|---|---|---|---|---|
| DIV-002 | `X-Tenant-Id` header trusted on `worklist_router.py:24`, `queues/router.py:13` — cross-tenant read vector | S1 | Low | **CONFORM-CODE** — swap to `Depends(require_auth)`; add 401 integration tests | Enstellar lead | T0 | No | OPEN |
| DIV-019 | `dev_bypass_auth` hardcoded-tenant flag in portal-bff | LOW | Low | **CONFORM-CODE** — delete flag; replace with mock Keycloak token in test tooling | Enstellar lead | T0 | No | OPEN |
| UNK-1 | HAPI JPA tenant scoping unverified — **potential third S1** | — | — | **INVESTIGATE FIRST** — cross-tenant FHIR query test against HAPI; if unscoped, open DIV-020 at S1 and pull into T0 | Platform lead | T0 | No | OPEN |
| UNK-5 | Consumer idempotency on `event_id` unverified per consumer | — | — | **INVESTIGATE** — audit each consumer; gates the DIV-014 AMEND-SPEC decision | Platform lead | T0 | No | OPEN |
| UNK-2/3/4 | required-elements.json absent (→DIV-017 work); C-3 coverage count; OPA absent (intended P2 — confirm) | — | — | **RESOLVE & RECORD** in register notes | Platform lead | T0 | No | OPEN |
| (new) | CI fitness functions: ban `Header("X-Tenant-Id")` pattern, T-3 per-tenant-conditional grep gate, secrets scan | — | — | **ADOPT-NEW** — cheap gates land before Tranche 1 starts | Platform lead | T0 | No | OPEN |

**Tranche 0 exit test:** unauthenticated/forged-header requests return 401 in CI; UNK-1/UNK-5 answered in writing; fitness gates red-green demonstrated.

## Tranche 1 — Contract-surface conformance (breaking changes are free until first customer)

| ID | Summary | Sev | Irrev. | Disposition | Owner | Tranche | ADR | Status |
|---|---|---|---|---|---|---|---|---|
| DIV-001 | Decisions lack C-1 `pins[]` (single artifact captured); Case has no pins field; appeals irreproducible | S1 | PERMANENT* | **CONFORM-CODE + DATA RESET** — full `pins[]` on DecisionRequest/Response, Case, Determination, and `determination-recorded/v1`; regenerate dev-era decision data from fixtures rather than carrying null-pinned rows. *PERMANENT loss waived by ADR-012 (pre-customer data declared non-retained) | Enstellar lead | T1 | **ADR-012** | OPEN |
| DIV-007 | Envelope missing `schema_ref/causation_id/trace_ref`; topics not C-3 (`case.state.transitioned` vs `sim.case.lifecycle`) | HIGH | COMPOUNDING | **CONFORM-CODE** — complete envelope; rename topics to C-3 taxonomy now (free); wire `schema_ref` per publish site; stub remaining C-3 event types | Platform lead | T1 | No | OPEN |
| DIV-008 | Determination missing 5 CCEM §4.3 fields; no DB CHECK on adverse invariant | HIGH | Low | **CONFORM-CODE** — add `decided_by{type}`, `rationale_ref`, `rules_trace_ref`, `advisory_analysis_ref`, `pins[]`; add CHECK (adverse ⇒ human ∧ ¬auto ∧ rationale ∧ trace); add event-validator on publish | Enstellar lead | T1 | No | OPEN |
| DIV-013 | `StructuredTrace` (4 fields) vs CCEM §7 Trace (governing_artifacts[], inputs[], logic_path[], actors[]) | MED | Low | **CONFORM-CODE** — extend to full Trace schema; old traces remain as-is (pre-reset data) | Enstellar lead | T1 | No | OPEN |
| DIV-004 | Zero Postgres RLS; no GUC in pool | HIGH | COMPOUNDING | **CONFORM-CODE** — RLS+FORCE+policy migration on all tables; `SET LOCAL sim.tenant_id` in pool wrapper; cross-tenant CI harness; verify HAPI separately (UNK-1) | Platform lead | T1 | No | OPEN |
| DIV-009 | No document retrieval authz; no `sim.audit.access` on reads | HIGH | Low | **CONFORM-CODE** — `DocumentRepository.get(doc_id)` with tenant check + access event; content_sha256; deny direct MinIO access | Enstellar lead | T1 | No | OPEN |
| DIV-015 | Case not reconstructable from events alone (decisions live in mutable `case_json`) | MED | Low | **CONFORM-CODE** — emit full decision payload in `determination-recorded/v1`; decision rows into `workflow_events`; build the **proxy-Qualitron stub consumer** as the permanent fitness test | Platform lead | T1 | No | OPEN |
| DIV-016 | No `prompt_version` in provenance; prompts are code literals; no `sim.ai.interaction` events | MED | Low | **CONFORM-CODE** — add prompt_version (file-versioned now, VKAS in T2); emit interaction events via outbox | Enstellar lead | T1 | No | OPEN |
| DIV-017 | `required-elements.json` + FHIR↔CCEM round-trip property tests absent (CCEM §9 Phase-0 exit criterion) | MED | Low | **CONFORM-CODE** — author manifest v1 (PAS + 278/275 fields in use); property-test suite in CI; merges blocked without it | Platform lead | T1 | No | OPEN |
| DIV-012 | Mutable `case_json` snapshot; no `seq` optimistic concurrency | MED | Low | **CONFORM-CODE (partial)** — add `seq` + conflict detection + decision events now; full event-source migration deferred to DIV-005 work | Enstellar lead | T1→T3 | No | OPEN |

**Tranche 1 exit test:** proxy-Qualitron stub rebuilds 5 synthetic cases (states + decisions + pins + traces) from `sim.*` topics alone; rescan invariants T-1/T-2/T-4/D-1/D-2/E-1 = PASS; round-trip suite green.

## Tranche 2 — Platform seed extraction

| ID | Summary | Sev | Irrev. | Disposition | Owner | Tranche | ADR | Status |
|---|---|---|---|---|---|---|---|---|
| DIV-011 | No VKAS — clocks/workflow defs/templates/prompts change only by deploy | HIGH | Low | **ADOPT-NEW in `platform/services/vkas`** — v1 scope per ADR-015: clock_profile, workflow_def, prompt, notification_template; migrate existing artifacts; emit `sim.artifact.*` | Platform lead | T2 | **ADR-015** | OPEN |
| DIV-006 | Clock limits hardcoded dict; calendar-day only; no profile pin | HIGH | COMPOUNDING | **CONFORM-CODE** — `clock_profile` artifacts (file-loaded → VKAS), business-day calendar, pin on Clock rows + `case.created` event | Enstellar lead | T2 (schema in T1 if cheap) | No | OPEN |
| DIV-003 | Direct provider calls; no boundary enforcement, kill switches, or AI audit | S1 | Med | **CONFORM-CODE** — promote ModelAdapter factory to **Model Gateway library** per ADR-013: boundary-resolved endpoints, per-tenant/workflow kill switch, no-train assertion, `ai.interaction` emission, VKAS-versioned prompts | Enstellar lead | T2 | **ADR-013** | OPEN |
| DIV-018 | Adapter selection by env var, no boundary constraint | LOW | Low | **CONFORM-CODE** — folds into ADR-013 gateway (boundary config refuses out-of-boundary providers) | Enstellar lead | T2 | ADR-013 | OPEN |
| DIV-010 | No audit service: no immutability, hash-chain, PHI-read audit, exporter | HIGH | Low | **ADOPT-NEW in `platform/services/audit`** — append-only hash-chained store consuming outbox + signoffs; `audit.access` wiring (with DIV-009); evidence-package exporter v1 (determination → trace → artifacts → documents closure) | Platform lead | T2 | No | OPEN |

**Tranche 2 exit test:** a clock-limit change ships as a VKAS promotion with zero deploy; an inference call in `boundary=enclave` config to a commercial endpoint is refused in test; evidence package for one synthetic determination exports and verifies (hash chain intact).

## Tranche 3 — Deliberate deferrals (decided, not drifted)

| ID | Summary | Sev | Irrev. | Disposition | Owner | Tranche | ADR | Status |
|---|---|---|---|---|---|---|---|---|
| DIV-005 | Workflow engine code-embedded; no Temporal; `"v1"` literal pin | HIGH | High | **CONFORM near-term / REBUILD on trigger** — now: `WorkflowEnginePort` interface, PA workflow as `workflow_def` YAML artifact, real pin per case. Temporal rebuild deferred to explicit triggers in ADR-014 | Enstellar lead | T3 (interface+pin in T1/T2) | **ADR-014** | OPEN |
| DIV-014 | Outbox relay mark not atomic with publish (duplicate-delivery window) | MED | Low | **AMEND-SPEC** — accept at-least-once (C-3 §2 already mandates consumer idempotency); amend DDD §4.3 wording; enforce idempotency on every consumer (gated by UNK-5 findings); add duplicate-injection chaos test | Platform lead | T3 | DDD edit | OPEN |

**Tranche 3 exit test:** duplicate-injection test passes on all consumers; ADR-014 triggers reviewed quarterly; workflow definition change demonstrable via artifact swap on a synthetic tenant.

---

## Standing rules adopted with this ratification
1. **Freeze rule:** no new code in `modules/enstellar` (or any module) for the 12 audited capabilities; consume `platform/` or halt-and-ask. Enforced via CLAUDE.md + import-lint as platform packages land.
2. **Pre-customer breaking-change window:** topic renames, schema resets, and data regeneration are permitted without migration scaffolding **until the first design-partner tenant is provisioned**; this clause self-revokes on that date.
3. **Rescan cadence:** `/platform-audit-rescan` after each tranche; register statuses flip to VERIFIED only on passing rescan; counts reported in the weekly status note.
