# Simintero Canonical Case & Evidence Model (CCEM) — Specification

| | |
|---|---|
| **Document ID** | CCEM v1.0.0-draft (`contracts/schemas/ccem/`, `contracts/fhir/`) |
| **Owner** | Platform team, with module-team co-signature (this model is a contract, governed like one) |
| **Consumers** | All modules, the FHIR facade, the X12 translator, the event catalog (C-3), the fabric store |
| **Status** | For ratification — blocks Phase 0 exit |
| **PRD trace** | ENS-MDL-1..4, platform PRD "Data model expectations", DIG runtime data model, REV outputs, QUA evidence fabric |

---

## 1. Purpose & design stance

The CCEM is the single internal data model all four modules share. It answers, precisely: what is a Case, what is Evidence, how do they relate, how do they map losslessly to FHIR and X12, and what every record must carry (tenancy, identity, provenance, versioning).

**Stance (from SAD ADR-6):** clinical evidence is stored as **profiled FHIR resources** (the fabric); operational workflow state is stored as **relational aggregates** with defined bidirectional FHIR projections. The model is versioned like a contract: additive within a major; the mapping layer absorbs FHIR IG drift so module code doesn't.

## 2. Identity & tenancy rules (apply to every entity)

- **IDs:** ULIDs with typed prefixes — `case_`, `line_`, `det_`, `app_`, `task_`, `doc_`, `qr_`, `trc_`, `ana_`, `evt_`. Fabric resources use `fabric/{ResourceType}/{ulid}`. IDs are globally unique, never reused, never recycled across tenants.
- **Tenancy:** every persisted record and emitted event carries the full tenant context tuple `{tenant_id, lob, program?, product, region}` (ENS-MDL-3). `tenant_id` is immutable post-creation; cross-tenant references are structurally impossible (RLS) and semantically forbidden.
- **Time:** all timestamps UTC RFC3339; business-day arithmetic only via tenant `business_calendar` artifacts (clocks, SLAs).
- **Immutability classes:** `event` (append-only), `versioned artifact` (immutable versions via VKAS), `mutable projection` (rebuildable), `fabric resource` (versioned, supersede-not-update).

## 3. Entity catalog & relationships

```
 Tenant ─┬─ User/Principal
         └─ Case ───────────────┬─ ServiceLine (1..n)
              │ member_ref      ├─ Determination (0..n; ≥1 when DETERMINED)
              │ coverage_ref    ├─ RFI (0..n) ── satisfied_by → Evidence refs
              │                 ├─ Communication (0..n)
              │                 ├─ Task (0..n, via subject_ref)
              │                 ├─ Clock (1..n, profile-pinned)
              │                 ├─ AdvisoryAnalysis ref (0..n)   [Revital]
              │                 └─ Appeal (0..n) ──► its own Case (appeal_of)
              │
              └─ pins[] ──► VKAS Artifacts (workflow_def, clock_profile, policy set)
 Evidence Fabric (per tenant):
   Member(Patient) ── Coverage ── Provider(Practitioner/Role/Organization)
   Clinical resources: Condition · Observation · Procedure · MedicationStatement/Request
                       · DocumentReference · QuestionnaireResponse · Encounter
   every fabric resource ──► Provenance(Trace) ──► {source system | document span | model+prompt}
 MeasureResult(MeasureReport) [QUA] ──► member_ref + measure pin + measure_evidence Trace
```

## 4. Operational entities (normative attributes)

### 4.1 Case
```yaml
Case:
  case_id: ulid                  # = Temporal workflowId = correlation_id spine
  tenant: TenantCtx
  origin: { channel: PAS|X12_278|PORTAL|FAX_OCR, raw_payload_ref, received_at,
            external_ids: [{system, value}] }     # payer/clearinghouse/trading-partner IDs
  member_ref: fabric/Patient     # resolved; resolution score + method recorded in trace
  coverage_ref: fabric/Coverage
  providers: { requesting: {npi, ref?}, servicing: {npi, ref?} }
  urgency: standard | expedited
  state: enum (workflow_def-governed; see C-3 state-changed)
  pins: [{canonical_url, version}]   # workflow_def, clock_profiles, and per-evaluation policy pins
  linked: { appeal_of: case_id|null, related_cases: [case_id] }
  audit: { created_at, created_by, version: int }  # optimistic concurrency on projections
Invariants:
  - state transitions only via workflow engine (no direct writes)
  - pins are append-only; a pin, once recorded, is never removed
  - appeal cases copy (by ref) the original's determination + trace closure, read-only
```

### 4.2 ServiceLine
`{ line_id, code{system,value,modifiers[]}, qty, units, place_of_service, requested_period{start,end}, status: requested|approved|partially_approved|denied|modified|withdrawn, approved_qty?, decision_ref? }`. Line-level outcomes are first-class (PAS and 278 both demand it; partial approvals are line math, not prose).

### 4.3 Determination
`{ determination_id, case_id, outcome: approved|partially_approved|denied|modified, per_line[], decided_by{type:human, id, role}, auto_path: bool, rationale_ref, rules_trace_ref, advisory_analysis_ref?, pins[], decided_at }`.
**Invariants:** adverse outcome ⇒ `decided_by.type=human` ∧ `auto_path=false` ∧ `rules_trace_ref≠null` ∧ `rationale_ref≠null` (DB CHECK + authz guard + event validator — three layers, same rule). Determinations are immutable; corrections happen via new determinations with `supersedes`.

### 4.4 RFI · Communication · Task · Clock
- **RFI:** `{ rfi_id, case_id, requirement_ids[] (from C-1 gaps), channel, issued_at, due_by, status: open|satisfied|expired, satisfied_by: evidence_refs[] }` — links pause/resume to specific gaps, so "what were we waiting for" is queryable.
- **Communication:** `{ comm_id, case_id, kind: rfi|determination_letter|status|p2p_invite, template_pin, recipient{kind, ref}, channel, regulatory_content_profile, sent_at, delivery_status }`.
- **Task:** `{ task_id, kind, subject_ref (case|gap|exception), queue, assignment{assignee?, constraints{license_region?, exclude_actors?}}, sla_ref, state }` — one shape for UM review, intake exceptions, governance reviews, and Qualitron outreach.
- **Clock:** `{ clock_id, case_id, profile_pin, type, started_at, limit, elapsed_banked, state: running|paused|satisfied|breached, pause_history[] }`.

### 4.5 Appeal
A Case with `appeal_of` set plus `{ level: 1|2|external, kind: appeal|grievance, expedited: bool, independent_constraint: exclude original deciders }`. No separate aggregate type — appeals reuse the entire case machinery with their own workflow/clock pins (Enstellar §8.10 by construction).

## 5. Evidence fabric (clinical model)

### 5.1 Storage shape
```sql
CREATE TABLE fabric.resource (
  tenant_id     TEXT NOT NULL,
  resource_type TEXT NOT NULL,            -- US Core / PAS-relevant set, v1 list in §5.2
  id            TEXT NOT NULL,            -- ulid
  version       INT  NOT NULL,
  profile       TEXT NOT NULL,            -- canonical profile URL (pinned per ig-lock.json)
  content       JSONB NOT NULL,           -- validated FHIR JSON
  member_ref    TEXT,                     -- denormalized subject for partitioning/query
  source        TEXT NOT NULL,            -- exchange|revital_extraction|supplemental|core_admin_sync|questionnaire
  classification TEXT,                    -- standard|non_standard (QUA audit semantics)
  provenance_ref TEXT NOT NULL,           -- Trace; REQUIRED — no orphan evidence
  superseded_by TEXT,
  last_updated  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, resource_type, id, version)
);
-- search-parameter projections (member, code, date, category) maintained by trigger/consumer
```

### 5.2 v1 resource set & profiles (pinned in `contracts/fhir/ig-lock.json`)
`Patient` (member), `Coverage`, `Practitioner`, `PractitionerRole`, `Organization`, `Condition`, `Observation`, `Procedure`, `MedicationRequest`, `MedicationStatement`, `Encounter`, `DocumentReference`, `QuestionnaireResponse`, `ServiceRequest` — US Core (pinned version) + PAS profiles where applicable. Adding a resource type or bumping an IG pin is a CCEM minor version with mapping-suite proof.

### 5.3 Fabric rules
- **Supersede, never update:** corrections create version n+1 and set `superseded_by`; `sim.evidence.retracted` only for true retractions (wrong member, etc.) — consumers reverse derived state.
- **Every resource has Provenance.** `provenance_ref` resolves to a Trace whose `inputs` identify: source system + message (exchange/sync), document span + model/prompt versions (extraction), submitter (supplemental/questionnaire). Unprovenanced evidence cannot exist — this is what makes a measure result and a coverage decision defensible from the same trail.
- **Master data:** Member/Coverage/Provider are *synchronized*, source-of-truth = payer core admin; records carry `freshness{synced_at, source_system}`; staleness beyond connector SLA flags dependent cases for eligibility re-verify rather than blocking.
- **Member matching:** intake resolution records `{method: exact_id|probabilistic, score}` in the case trace; below-threshold ⇒ `intake_exception` task, never a silent best-guess attach.

## 6. External mappings (lossless by proof, not by promise)

### 6.1 FHIR projections (operational entities → FHIR, at the facade only)
| CCEM | FHIR (R4, profile-pinned) |
|---|---|
| Case + ServiceLines (PA) | `Claim` (use=`preauthorization`, PAS profile) in submission Bundle |
| Determination (+ per_line) | `ClaimResponse` (PAS) — line adjudications, disposition, reason codes |
| RFI / status | `Communication`/`CommunicationRequest`, PAS `$inquire` result, Subscription notifications |
| Task | `Task` (where exchanged; internal Task is richer) |
| Clock state (public) | `ClaimResponse.extension` per PAS + metrics reporting feed |
| AdvisoryAnalysis (exported) | derived `DocumentReference` + `Provenance` (Revital A.1) |

### 6.2 X12 mappings
`278` request/response ↔ Case/Determination; `275` ↔ DocumentReference attachment (+ `TRN` linkage to case external_ids); CARC/RARC code translation tables are VKAS `concept_map` artifacts (versioned, effective-dated — companion-guide variability is configuration). Raw interchanges always retained (`origin.raw_payload_ref`).

### 6.3 Required-elements manifest & round-trip proof
`contracts/fhir/required-elements.json` enumerates, per mapping, the element set that MUST survive round-trip (clinically/operationally significant fields per ENS-MDL-2). CI property tests generate valid PAS bundles / 278 interchanges and assert `fromX → CCEM → toX` preserves the manifest set, and `CCEM → toFhir → fromFhir → CCEM` is identity on mapped fields. **A mapping without a passing round-trip suite cannot merge.** The manifest is the negotiation artifact when "lossless" gets debated — extend the manifest, not the argument.

## 7. Provenance (Trace) — shared schema summary

(Authoritative JSON Schema: `contracts/schemas/trace.schema.json`; profiles: `rules_trace` [C-1], `ai_citation` [C-2], `measure_evidence` [QUA].)

```
Trace { trace_id, tenant, subject{type, ref},
        governing_artifacts[{canonical_url, version, source, supplements?}],
        inputs[{kind: fhir|document_span|message, ref, page?, region?, excerpt_hash?}],
        logic_path[]?,            # rules/measures
        actors[{type: human|service|model, id, prompt?+version?, confidence?, action?, at}],
        outcome{kind, value} }
```

Rules: append-only; every Determination, every fabric resource, every MeasureReport, every advisory assertion references ≥1 Trace; the evidence-package exporter materializes the transitive closure (traces → pinned artifact content snapshots → documents) for any subject.

## 8. Versioning & governance of this model

- CCEM versions semver; **additive-only within a major** (new optional attributes, new resource types with mappings+tests). Renames/removals/semantic changes ⇒ major, requiring a cross-module migration RFC.
- The model ships as code: JSON Schemas + SQL migrations + mapping functions + round-trip suites in one PR; CODEOWNERS = platform + all module leads (it is a contract; it changes like one).
- IG pin bumps (US Core/Da Vinci) are CCEM minors gated on conformance (Inferno/Touchstone) + round-trip suites green.

## 9. Ratification checklist (Phase 0 exit)

- [ ] Entity schemas + invariants (esp. §4.3 Determination) reviewed by clinical/compliance
- [ ] v1 fabric resource set + ig-lock pins agreed with first design partner's exchange reality
- [ ] required-elements manifest v1 populated for PAS + 278/275; round-trip suites green on synthetic corpus
- [ ] Trace schema ratified jointly with C-1/C-2 (same shapes, no drift)
- [ ] Member-matching thresholds + exception flow signed off by implementation team
- [ ] Open: `ServiceRequest`-anchored (clinical order) vs `Claim`-anchored internal linkage for CRD pre-intake context — decide with design partner EHR patterns
