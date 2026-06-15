# ICD C-1 — Digicore Runtime Decision & Trace Contract

| | |
|---|---|
| **Contract ID** | C-1 (`contracts/openapi/c1-digicore-runtime.yaml` is generated from this document) |
| **Provider** | Digicore Runtime Decision Service `[DIG]` |
| **Consumers** | Enstellar (coverage discovery, completeness, auto-determination, review, appeals), Revital (evidence requirements), CDS Hooks edge (CRD) |
| **Version** | 1.0.0-draft · semver; breaking change ⇒ new major + 2-release deprecation window |
| **Status** | For ratification — blocks Phase 1 module build |
| **PRD trace** | DIG-RT-1..4, DIG-CRD-1..2, DIG-MAP-2, ENS-DOC-1..3, ENS-RUL-1..2, REV evidence-mapping |

---

## 1. Purpose & scope

This contract defines how runtime consumers obtain **coverage discovery answers (CRD)**, **documentation packages (DTR)**, **request evaluations against governing policy**, and **evidence requirements** from Digicore — always with deterministic version pinning and a structured trace.

Out of scope: authoring, governance, simulation, VKAS lifecycle APIs (platform contract), terminology operations (platform Terminology contract).

## 2. Common conventions

- **Transport:** HTTPS + mesh mTLS; in-cell only (no cross-cell calls).
- **AuthN/Z:** service principal + propagated `x-sim-ctx` (verified tenant context JWT). Every call is evaluated as `action=runtime.<op>` against OPA. Calls without valid tenant context are rejected `401`.
- **Tenant context:** `tenant_id, lob, program, product, region` from `x-sim-ctx` are authoritative; body-supplied context fields are ignored except `as_of` and explicit `pins`.
- **Idempotency:** all POSTs accept `Idempotency-Key`; identical key+body within 48h returns the original response.
- **Errors:** RFC 9457 `application/problem+json` with `code` (registry `SIM-DIG-*`), `correlation_id`. PHI MUST NOT appear in problem details.
- **Determinism (normative):** identical `(request body ⊕ resolved pin set)` ⇒ byte-identical `outcome`, `requirement_gaps`, and trace `logic_path`. `trace_id` and timestamps may differ.

## 3. The pinning rule (normative, the heart of this contract)

1. Every successful response includes `pins[]` — the exact artifact versions used.
2. Consumers **MUST persist** `pins` on the owning aggregate (Enstellar: on the case at first evaluation and on each decision; Revital: on each analysis run).
3. Re-evaluation for audit/appeal **MUST** send the persisted `pins`; the provider then bypasses effective-version resolution and evaluates against exactly those versions (`DIG-VER`/`DIG-RT-2` reproduction guarantee).
4. If a pinned version is unavailable (never deleted by design; only possible in disaster scenarios), provider returns `410 SIM-DIG-PIN-UNAVAILABLE` — consumers surface this as an audit-severity incident, never silently re-resolve.

## 4. Operations

### 4.1 `POST /v1/runtime/coverage-discovery` — CRD evaluation

Answers "is PA required, and what applies?" for an ordering context. Backs the CDS Hooks edge (`order-select`, `order-sign`, etc.) and Enstellar pre-intake checks.

```yaml
request:
  as_of: date                     # default today (tenant business calendar tz)
  ordering_context:
    member_ref: string            # fabric ref: fabric/Patient/{id}
    coverage_ref: string
    service: { code: string, system: uri, modifiers: [string] }
    place_of_service: string
    requesting_provider_npi: string
  hook: order-select | order-sign | order-dispatch | appointment-book | null
response 200:
  pa_required: true | false | conditional
  conditions: [string]            # populated when 'conditional'
  alternatives: [{ code, system, display, pa_required }]
  documentation:
    dtr_package_ref: { canonical_url, version } | null
    summary_requirements: [string]
  governing_rules: [{ canonical_url, version, source: internal|internal_supplement|licensed_ref|public_ref,
                      title }]
  pins: [{ canonical_url, version }]
  trace_ref: string               # Trace profile: rules_trace
  cards: [CDSHooksCard]           # pre-rendered cards for the hooks edge (incl. DTR SMART link card)
```

**AC (from ENS-DOC-1):** when PA is not required, `pa_required=false` and `governing_rules` identifies the rule that says so.
**SLO:** p50 ≤ 200ms, p99 ≤ 500ms (CDS Hooks expectation).

### 4.2 `GET /v1/runtime/dtr-packages/{canonical}@{version}` and `POST /v1/runtime/dtr-packages:resolve`

Returns the DTR package (FHIR `Questionnaire` + CQL `Library` set, FHIR-package format) either by exact pin or resolved by context (`resolve` body = `ordering_context` + `as_of`, response includes `pins`). Enstellar serves these to EHR/SMART DTR apps verbatim; packages are immutable per version; `ETag = content_hash`, cacheable.
**SLO:** p99 ≤ 300ms (cache-friendly).

### 4.3 `POST /v1/runtime/evaluate` — request evaluation

The decision hot path: completeness, auto-determination eligibility, and reviewer-time recommendation all use this single operation (the `purpose` field shapes output emphasis, never the logic).

```yaml
request:
  purpose: completeness | auto_determination | review_support | appeal_reproduction
  as_of: date
  case_context:
    case_ref: string
    member_ref: string
    coverage_ref: string
    urgency: standard | expedited
  request:
    service_lines: [{ line_id, code, system, qty, units, place_of_service, requested_period }]
    requesting_provider_npi: string
    servicing_provider_npi: string
  evidence:
    resource_refs: [string]                 # fabric refs (incl. Revital-extracted, provenance-bearing)
    questionnaire_responses: [string]
    document_refs: [string]                 # for trace linkage only; runtime does not parse documents
  pins: [{ canonical_url, version }] | null # MUST be present when purpose=appeal_reproduction
response 200:
  outcome: meets_all | partial | not_met | indeterminate
  per_line: [{ line_id, outcome, unmet_criteria: [criterion_id] }]
  requirement_gaps:
    - { requirement_id, description, kind: data|document|questionnaire,
        satisfiable_by: [dtr|cdex_request|attachment], blocking: bool }
  conflicts: [{ description, refs: [string] }]
  auto_determination:
    eligible: bool                          # policy-flagged 'auto_approve_eligible' AND outcome=meets_all
    ineligibility_reasons: [string]
  pins: [{ canonical_url, version }]
  trace_ref: string
response 409:                               # applicability conflict (two rules tie) — authoring lint escaped
  code: SIM-DIG-CONFLICT
  resolution_trace: {...}                   # consumers create an IntakeException/governance task
response 410:
  code: SIM-DIG-PIN-UNAVAILABLE
```

**Normative behaviors:**
- `indeterminate` (insufficient data to evaluate) is a first-class outcome — consumers MUST NOT map it to `not_met`.
- `auto_determination.eligible=true` is a **necessary but not sufficient** condition for automated approval; Enstellar's workflow policy makes the final call. This endpoint never expresses an adverse disposition as automatable.
- Evaluation reads only declared data-requirements; `evidence` refs outside requirements are ignored and listed in the trace as `unused_inputs`.
**SLO:** p50 ≤ 300ms, p99 ≤ 1s at 50 rps/cell baseline (`DIG-RT-4`).

### 4.4 `POST /v1/runtime/evidence-requirements:resolve` — Revital extraction targets

```yaml
request:  { case_context, request (as in 4.3), as_of, pins? }
response: { requirements: [{ requirement_id, description,
              target: { resource_type, codes: [{system, code}] | value_set: {url, version},
                        temporal_constraint?: string },
              criterion_refs: [string] }],
            pins, trace_ref }
```

Defines *what Revital looks for* so extraction is grounded in governed policy (`DIG-AUTH-6`, Revital §7.1 step 3). `target` is machine-actionable; `description` is the human framing.

## 5. Trace contract

`trace_ref` resolves via the platform Provenance API to a `rules_trace`-profiled Trace (see Canonical Model doc §7): `governing_artifacts` (with source/supplements lineage), `inputs` (used and `unused_inputs`), `logic_path` with per-define intermediate results and value-set versions, `outcome`. **Every 200 from 4.1/4.3/4.4 has a trace.** Consumers MUST render governing source + version in any UI that shows the recommendation (ENS-RUL-1).

## 6. Failure & degradation semantics

- Runtime unavailable ⇒ Enstellar queues the workflow step (Temporal retry, jittered backoff); cases pend, clocks keep running — **never silent drop, never default-deny/approve**.
- Partial content-source outage (e.g., licensed-ref metadata) ⇒ evaluation proceeds if the governing executable artifacts resolve; trace notes the degraded enrichment.
- Timeout budget for consumers: 2s hard; on breach, treat as unavailable (above), not `indeterminate`.

## 7. Versioning & change management

Additive within v1 (new optional fields, new enum values flagged `x-extensible-enum` — consumers MUST tolerate unknown values). Breaking ⇒ `/v2/` + dual-run window. Contract tests: Enstellar and Revital publish consumer expectations to the Pact broker; Digicore provider verification gates merge. Golden determinism suite (fixed inputs+pins ⇒ fixed outputs) runs on every engine/terminology dependency bump.

## 8. Conformance checklist (provider GA gate)

- [ ] Pins returned on every success; appeal_reproduction honors pins byte-identically
- [ ] 409/410 semantics implemented; conflict lint coverage report attached
- [ ] Trace present + resolvable for every success; unused_inputs populated
- [ ] SLOs met under load profile L-1 (Phase 1 perf spike)
- [ ] CDS Hooks cards validate against hooks spec; DTR packages pass Inferno DTR kit
