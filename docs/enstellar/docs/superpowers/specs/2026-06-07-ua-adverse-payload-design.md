# UA Group: Adverse Transition Payload Enrichment — Design Spec

**Date:** 2026-06-07  
**Tasks:** UA1 (workflow-engine), UA2 (BFF), UA3 (web)  
**Review class:** sensitive (decision path) — mandatory senior-engineer review before merge

---

## Problem

The MD adverse determination form already displays structured data (criteria gaps, reason codes, policy citations), but only `outcome` and a free-text `reason` reach the backend. The decision trace stored in `workflow_events.payload` is therefore incomplete for audit, appeals, and downstream X12/FHIR generation.

## Invariants (non-negotiable, unchanged)

1. No adverse state transition without a recorded human sign-off (`human_signoff_recorded=True` + `human_signoffs` row). This guard is **not modified** by UA work.
2. The structured payload fields are **additive and optional** — all existing adverse code paths continue to work with zero changes.
3. `actor_id` always sourced from `auth["sub"]`; `clinician_id` from request body (existing TODO for identity validation, not in scope here).

---

## Payload Shape

All new fields are optional. Existing adverse calls that omit them continue to work.

```json
{
  "reason": "...",
  "determination_type": "denied | partially_denied | adverse_modification",
  "finding_sections": [
    { "criterion_id": "C-02", "text": "...", "status": "gap | unknown" }
  ],
  "reason_codes": ["M54.5", "M51.16"],
  "citations": ["InterQual 2025 §3.4.1", "Plan Policy §4.2.1"]
}
```

`finding_sections` entries mirror `case_criteria` rows — they are the subset the MD explicitly confirmed as driving the determination. `reason_codes` are ICD/CPT codes. `citations` are policy/guideline references.

`clinical_rationale` from the DoD maps to the existing `reason` field; no separate field needed — they are the same concept.

---

## UA1 — Workflow Engine

**Files touched:**
- `packages/event-contracts/enstellar_events/topics.py` — add `ADVERSE_STRUCTURED`
- `services/workflow-engine/enstellar_workflow/api/router.py` — emit structured event on adverse transition
- `services/workflow-engine/tests/test_adverse_payload.py` — new test file

**No migration required.** `workflow_events.payload` is already `JSONB` and today stores `{"reason": "..."}`. The new fields are stored by the existing write path with no schema change.

**New domain event:** When `to_state` is in `ADVERSE_STATES` and the transition succeeds, emit a `case.adverse.structured` outbox event (via the existing outbox mechanism) carrying:

```json
{
  "case_id": "...",
  "tenant_id": "...",
  "actor_id": "...",
  "determination_type": "...",
  "finding_sections": [...],
  "reason_codes": [...],
  "citations": [...]
}
```

This event is emitted **in addition to** the existing transition event — it does not replace it. If the payload lacks the structured fields (legacy call), the event is still emitted with `null` values for the new fields so downstream consumers can rely on a consistent schema.

**Tests (DoD):**
- Structured fields present in `workflow_events.payload` after adverse transition with full payload
- `case.adverse.structured` outbox event emitted with correct fields
- Adverse transition with legacy payload (only `reason`) still succeeds — backwards-compat
- Existing adverse guard tests unchanged and still pass

---

## UA2 — BFF

**Files touched:**
- `services/portal-bff/enstellar_bff/models.py` — extend `AdverseDecisionRequest`
- `services/portal-bff/enstellar_bff/routers/cases.py` — merge new fields into payload dict
- `services/portal-bff/tests/test_adverse_decision.py` — extend existing or add new

**Model change** (`AdverseDecisionRequest`, backwards-compat):

```python
class FindingSection(BaseModel):
    criterion_id: str
    text: str
    status: Literal["gap", "unknown"]

class AdverseDecisionRequest(BaseModel):
    outcome: Literal["denied", "partially_denied", "adverse_modification"]
    reason: str = Field(..., min_length=1)
    clinician_id: str
    sign_off_confirmed: bool
    # New optional structured fields (UA2)
    determination_type: str | None = None
    finding_sections: list[FindingSection] | None = None
    reason_codes: list[str] | None = None
    citations: list[str] | None = None
```

**Endpoint change** (`submit_adverse_decision`): extend the `payload` dict passed to `workflow_client.transition()`:

```python
payload = {
    "reason": body.reason,
    **({"determination_type": body.determination_type} if body.determination_type else {}),
    **({"finding_sections": [f.model_dump() for f in body.finding_sections]} if body.finding_sections else {}),
    **({"reason_codes": body.reason_codes} if body.reason_codes else {}),
    **({"citations": body.citations} if body.citations else {}),
}
```

**Tests (DoD):**
- Structured fields forwarded to workflow-engine payload (mock)
- Legacy call (no structured fields) still returns 200 and behaves identically
- `sign_off_confirmed=False` still returns 400 (existing invariant test, unchanged)

---

## UA3 — Web

**Files touched:**
- `apps/web/src/components/MdAdverseForm.tsx` — new component
- `apps/web/src/pages/CasePage.tsx` — `MdWorkColumn`: remove Sections 3/4/6, add `<MdAdverseForm>`
- `apps/web/src/api/client.ts` — extend `submitAdverseDecision`
- `apps/web/src/types/index.ts` — add `FindingSection`, extend adverse request type

**`DecisionForm.tsx` is not touched.**

### `MdAdverseForm` component

```tsx
interface Props {
  caseId: string
  determinationType: string   // passed from MdWorkColumn's mdType state
  onComplete: () => void
}
```

**Internal state:**

| State | Init | Source |
|---|---|---|
| `findingSections` | criteria query result filtered to `status !== 'met'` | `useQuery(['criteria', caseId])` |
| `selectedFindings` | all finding IDs selected | MD toggles to deselect |
| `reasonCodes` | `[]` | MD types + Enter |
| `citations` | `[]` | MD types + Enter |
| `rationale` | `''` | free-text input |
| `clinicianId` | `''` | text input |
| `confirmed` | `false` | checkbox |

**Finding section review UI:** each gap/unknown criterion shown as a toggleable chip row — checked by default, MD can uncheck to exclude from submission. This makes the review step explicit.

**Chip-input pattern** (reason codes + citations): text input with an "Add" button; pressing Enter or clicking Add appends to the array; each chip has an × remove button.

**Submit guard:** disabled until `rationale.trim()` + `clinicianId.trim()` + `confirmed` are all truthy (mirrors existing `DecisionForm` AdversePanel guard).

**Submit action:** calls `submitAdverseDecision` with:
```ts
submitAdverseDecision(
  caseId,
  determinationType as AdverseOutcome,
  rationale,
  clinicianId,
  {
    determination_type: determinationType,
    finding_sections: findingSections.filter(f => selectedFindings.has(f.id)),
    reason_codes: reasonCodes,
    citations,
  }
)
```

### `client.ts` change

`submitAdverseDecision` gains an optional fifth parameter `structured?`:

```ts
export function submitAdverseDecision(
  caseId: string,
  outcome: AdverseOutcome,
  reason: string,
  clinicianId: string,
  structured?: {
    determination_type: string
    finding_sections: FindingSection[]
    reason_codes: string[]
    citations: string[]
  },
): Promise<unknown>
```

### `MdWorkColumn` changes

- **Remove:** hardcoded Section 3 (reason codes chips), Section 4 (citations chips), Section 6 `<DecisionForm>` embed
- **Keep:** Section 1 (determination type buttons, `mdType` state), Section 2 (criteria display), Section 5 (clinical context + timeline)
- **Add:** `<MdAdverseForm caseId={caseId} determinationType={mdType} onComplete={onDecisionComplete} />`

### Tests (DoD)

- Playwright: adverse form shows pre-populated gap criteria toggles; MD can deselect one; submit sends correct `finding_sections` (only selected)
- Playwright: reason code chips — type + Enter adds chip; × removes it
- Playwright: citation chips — same pattern
- Playwright: submit disabled until rationale + clinicianId + confirmed all filled
- Playwright: after submit, `decisionDone` banner shown; structured payload visible in case events timeline
- Existing adverse Playwright e2e tests still pass

---

## Data Flow Summary

```
MdWorkColumn (mdType)
    └─► MdAdverseForm
            ├─ useQuery(['criteria', caseId]) → findingSections (pre-populated, toggleable)
            ├─ reasonCodes [] (chip input)
            ├─ citations [] (chip input)
            ├─ rationale, clinicianId, confirmed (sign-off)
            └─ submitAdverseDecision(caseId, outcome, rationale, clinicianId, structured)
                    └─► POST /bff/cases/{id}/adverse-decision
                            └─► workflow_client.transition(payload={reason, determination_type, finding_sections, reason_codes, citations})
                                    ├─► workflow_events.payload (JSONB stored)
                                    └─► outbox → case.adverse.structured event
```

---

## Out of Scope

- Clinician identity validation against auth token (existing TODO, separate task)
- ICD/CPT code lookup/autocomplete (codes entered as free text)
- Appeals workflow
