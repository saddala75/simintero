# ICD C-3 — Platform Event Catalog (Enstellar Stream & Cross-Module Eventing)

| | |
|---|---|
| **Contract ID** | C-3 (`contracts/asyncapi/c3-event-catalog.yaml`; payload schemas in `contracts/schemas/events/`) |
| **Producers** | Enstellar (case/clock/evidence), VKAS (artifact), Revital (AI interaction), Task service, Control plane (tenant) |
| **Consumers** | Qualitron (primary motivating consumer), Audit, Search indexer, Analytics, SLA dashboards, Notification |
| **Version** | 1.0.0-draft · schema-registry-governed; per-event-type semver |
| **Status** | For ratification — the "shared evidence fabric" is concretely *this catalog + the fabric store + the Document service* |
| **PRD trace** | ENS-MDL-4, ENS-WF-6, Enstellar §12 (Qualitron feed), QUA G1/G3/§7.1, platform PRD event/audit requirements |

---

## 1. Purpose & principles

This catalog is the asynchronous half of the platform's contract surface. Rules that make it consumable for a decade:

1. **Events are facts, not commands.** Past-tense, immutable, describing what happened. Consumers derive their own state; producers never instruct consumers.
2. **Public projections, not internal guts.** Enstellar's internal `case_event` store (per-aggregate) is private; what lands on the bus is the *public* projection defined here. Internal refactors don't break consumers.
3. **One envelope** (below) for every event, every topic.
4. **Refs, not payloads, for PHI-heavy content.** Events carry fabric/document/trace refs plus minimal denormalized fields needed for routing/filtering; consumers fetch content through governed APIs (RLS + access policy apply on fetch). Exception: small clinical-context fields explicitly listed per schema.
5. **Schema evolution:** additive only within a major (new optional fields; enums are `x-extensible-enum` — consumers MUST tolerate unknown values). Breaking ⇒ new `schema_ref` major published in parallel ≥ 2 release trains.

## 2. Envelope (normative — `event-envelope.schema.json`)

```json
{
  "event_id": "evt_01J… (ULID)",
  "schema_ref": "sim.case.state-changed/v1",
  "occurred_at": "RFC3339, ms precision",
  "tenant": { "tenant_id": "", "lob": "", "program": null, "product": "", "region": "" },
  "correlation_id": "case_01J… | txn_01J…",
  "causation_id": "evt_… | cmd_…",
  "actor": { "type": "human|service|model_agent", "id": "", "on_behalf_of": null },
  "trace_ref": "trc_… | null",
  "payload": { }
}
```

Delivery: at-least-once. Consumers MUST be idempotent on `event_id`. Ordering guaranteed only per partition key (below); cross-topic ordering reconstructed via `correlation_id + occurred_at + causation chain`.

## 3. Topics, keys, retention

| Topic | Key (ordering) | Retention | Notes |
|---|---|---|---|
| `sim.case.lifecycle` | `case_id` | infinite (compact+archive) | the Qualitron/audit spine |
| `sim.evidence` | `member_ref` | infinite (compact+archive) | fabric writes from all sources |
| `sim.task` | `task_id` | 90d | worklists, gap-closure tasks |
| `sim.clock` | `case_id` | 90d | SLA/regulatory clock signals |
| `sim.artifact` | `canonical_url` | infinite | VKAS publishes/rollbacks |
| `sim.ai.interaction` | `analysis_id` | infinite | governance/audit record stream |
| `sim.tenant.admin` | `tenant_id` | infinite | control-plane facts mirrored in-cell |
| `sim.audit.access` | `actor.id` | infinite (audit store SOR) | PHI access events |

Events never cross cells. Archived segments land in object store as NDJSON with manifest hashes (replayable).

## 4. Event types & payload schemas

### 4.1 `sim.case.lifecycle`

**`sim.case.created/v1`**
```json
{ "case_id": "", "channel": "PAS|X12_278|PORTAL|FAX_OCR",
  "member_ref": "fabric/Patient/…", "coverage_ref": "fabric/Coverage/…",
  "urgency": "standard|expedited",
  "service_lines": [ { "line_id": "", "code": "", "system": "", "qty": 0 } ],
  "requesting_provider_npi": "", "servicing_provider_npi": "",
  "workflow_def_pin": { "canonical_url": "", "version": "" },
  "clock_profile_pins": [ { "canonical_url": "", "version": "" } ],
  "raw_payload_ref": "doc/raw_…" }
```

**`sim.case.state-changed/v1`** — `{ case_id, from_state, to_state, reason_code, task_ref?, queue? }` for every lifecycle transition (INTAKE→…→CLOSED, incl. PENDED_RFI in/out, ESCALATED, APPEALED).

**`sim.case.rfi-issued/v1`** — `{ case_id, rfi_id, requirement_ids: [], channel, due_by, clock_action: "paused" }`
**`sim.case.rfi-satisfied/v1`** — `{ case_id, rfi_id, satisfied_by: { evidence_refs: [] }, clock_action: "resumed" }`

**`sim.case.determination-recorded/v1`** *(the most consumed event in the platform)*
```json
{ "case_id": "", "determination_id": "",
  "outcome": "approved|partially_approved|denied|modified",
  "per_line": [ { "line_id": "", "outcome": "", "approved_qty": 0 } ],
  "decided_by": { "type": "human", "id": "u_…", "role": "medical_director|um_nurse_reviewer" },
  "auto_path": false,
  "rationale_ref": "doc/…", 
  "rules_trace_ref": "trc_…", "advisory_analysis_ref": "ana_…|null",
  "pins": [ { "canonical_url": "", "version": "" } ],
  "clock_state": { "elapsed": "PT24H10M", "limit": "P7D", "breached": false } }
```
Invariant mirrored from the authz guard: `outcome ∈ {denied, partially_approved, modified}` ⇒ `decided_by.type == "human"` and `auto_path == false`. The schema validator enforces it on publish; a violation is a sev-1.

**`sim.case.appeal-opened/v1`** — `{ appeal_case_id, appeal_of: case_id, level, kind: appeal|grievance, expedited, clock_profile_pins }`
**`sim.case.appeal-resolved/v1`** — `{ appeal_case_id, disposition: overturned|upheld|partially_overturned, reviewer_independent: true, original_determination_id }`
**`sim.case.communication-sent/v1`** — `{ case_id, kind: rfi|determination_letter|status, channel, template_pin, recipient_kind: provider|member }`
**`sim.case.closed/v1`** — `{ case_id, closure_reason, summary_metrics: { tat: "PT…", touches: n, rfi_count: n } }`

### 4.2 `sim.evidence` — the fabric feed (Qualitron's primary input)

**`sim.evidence.added/v1`**
```json
{ "fabric_ref": "fabric/Procedure/px_551",
  "resource_type": "Procedure",
  "member_ref": "fabric/Patient/…",
  "source": "exchange|revital_extraction|supplemental|core_admin_sync|questionnaire",
  "classification": "standard|non_standard|null",
  "provenance_ref": "trc_…",
  "clinical_context": { "codes": [ { "system": "CPT", "code": "97110" } ],
                        "effective": "2026-04-12" },
  "supersedes": "fabric_ref|null",
  "case_ref": "case_…|null" }
```
`clinical_context.codes/effective` is the deliberate denormalization that lets Qualitron's gap engine pre-filter without fetching every resource; the fetched resource remains authoritative.

**`sim.evidence.retracted/v1`** — corrections/deletions with reason; consumers MUST reverse derived state (Qualitron re-evaluates affected members).

### 4.3 `sim.clock` — `clock-armed`, `clock-paused`, `clock-resumed`, `clock-warning/v1 { case_id, clock_type, pct_elapsed, deadline }`, `clock-breached/v1` (drives SLA dashboards, PA public-metrics reporting, escalation).

### 4.4 `sim.artifact` (VKAS) — `artifact-activated/v1 { canonical_url, version, artifact_type, applicability, effective_from, approvals: [gate, approver_hash] }`, `artifact-rolled-back/v1`. Consumers: runtime caches (invalidation), Qualitron (measure version awareness), audit.

### 4.5 `sim.ai.interaction` — `analysis-started/completed/v1` (per C-2 §5), `feedback-recorded/v1`, `threshold-abstained/v1`. Carries version pins and hashes, never document content.

### 4.6 `sim.task` — `task-created/assigned/completed/escalated/v1 { task_id, kind: um_review|rfi_followup|quality_outreach|intake_exception|governance_review, subject_ref, queue, sla_ref }`. Qualitron *creates* `quality_outreach` tasks via the Task API and *consumes* completion events to re-evaluate gaps.

### 4.7 `sim.tenant.admin` — `tenant-provisioned`, `tier-changed`, `entitlement-changed` (consumers: caches, module feature gating, FinOps).

## 5. Consumer guidance (normative per consumer class)

- **Qualitron:** subscribe `case.lifecycle` + `evidence` + `task(quality_outreach)` + `artifact(measure)`. Build member-period evidence projections; re-evaluate incrementally on `evidence.added/retracted` for affected measures (code-based pre-filter via `clinical_context`); never query Enstellar internals. Backfill = replay from archived segments + fabric snapshot — this replayability is the contract test for "Qualitron needs no new plumbing."
- **Audit:** consumes everything; hash-chains into the immutable store; `determination-recorded` + its `trace_ref` closure (artifacts content snapshot) is the appeal evidence root.
- **Search indexer:** projects display/index fields only; honors `evidence.retracted`.
- **Analytics:** per-cell warehouse sink; control-plane rollup consumes only de-identified aggregates (separate, reduced schemas — never this catalog raw).

## 6. Replay, backfill & DLQ

Consumers register replayable offsets; platform tooling supports `replay --topic --from --filter tenant=…` against live retention or archives. DLQ per consumer group with support-console re-drive. Producers MUST be able to re-emit the public projection from internal stores (Enstellar: from `case_event`; VKAS: from artifact rows) — verified by a Phase-0 chaos test that drops and rebuilds a consumer from zero.

## 7. Compatibility testing & GA gate

Schema registry enforces additive evolution on CI publish. Consumer contract tests pin required fields per consumer (Pact-style async). Gate:
- [ ] Envelope + all v1 schemas registered; producers publish via outbox only
- [ ] Determination invariant validator live (adverse ⇒ human, non-auto)
- [ ] Qualitron-from-zero rebuild demo on synthetic tenant (events + fabric only)
- [ ] Archive + replay round-trip verified; DLQ re-drive in support console
