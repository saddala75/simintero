# Design: UC + US — Criteria Accordion & AI Suggestions (P2)

**Date:** 2026-06-07  
**Phase:** P2 (UI Backend Wiring)  
**Tasks:** UC1, UC2, UC3, UC4, US1, US2, US3, US4  
**Review classes:** UC1/UC3/UC4/US1/US3/US4 = standard; UC2/US2 = sensitive (AI)

---

## Context

The reviewer UI (T12) and all P1 backend services are complete. The criteria accordion in `CasePage.tsx` renders 3 hardcoded cards (`CRITERIA` array) and the AI advisory column renders 3 hardcoded suggestion cards (`SUGGESTIONS` array). This design replaces both stubs with real data from the Completeness agent via a new `case_criteria` + `case_suggestions` persistence layer.

The existing architecture: `TransitionEngine` emits a `case.state.transitioned` Kafka event (via the outbox) on every state change. A new Kafka consumer reacts to `to_state == 'clinical_review'` to trigger agent calls.

---

## Architecture

```
clinical_review transition
    └─> TransitionEngine.apply()
         └─> CASE_STATE_TRANSITIONED outbox event
              └─> [Kafka] ClinicalReviewConsumer
                   ├─> PHI-minimized payload
                   ├─> agent-layer POST /assist/completeness
                   │    └─> guardrail check → write case_criteria rows
                   │         └─> agent.assist.produced outbox event
                   └─> agent-layer POST /assist/triage  (US2)
                        └─> guardrail check → write case_suggestions rows
                             └─> agent.assist.produced outbox event
```

BFF proxies both tables to the web app.

---

## UC Group — Criteria Accordion

### UC1 — `case_criteria` table + GET endpoint

**Migration:** `services/workflow-engine/migrations/versions/0007_case_criteria.py`

Table `case_criteria`:
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `case_id` | UUID FK → `workflow_instances.case_id` ON DELETE CASCADE | |
| `tenant_id` | TEXT NOT NULL | All queries filter on this |
| `criterion_id` | TEXT | e.g. `C-01` |
| `text` | TEXT | Human-readable criterion description |
| `status` | TEXT CHECK IN(`met`, `gap`, `unknown`) | |
| `evidence` | JSONB | `{title, meta}` — nullable |
| `citations` | JSONB | `list[str]` — nullable |
| `created_at` | TIMESTAMPTZ server default `now()` | |

Indexes: `(case_id, tenant_id)`.

**Module:** `enstellar_workflow/criteria/`
- `repository.py`: `insert_criteria(conn, rows)`, `list_by_case(conn, case_id, tenant_id) → list[dict]`
- `router.py`: `GET /cases/{id}/criteria` (requires `X-Tenant-Id` header) → returns list, tenant-scoped.

**DoD:** 200 with empty list for new case; schema validates; tenant isolation asserted.

---

### UC2 — Completeness agent trigger on `clinical_review` entry

**New file:** `enstellar_workflow/consumers/clinical_review_consumer.py`

Subscribes to the Kafka topic for `case.state.transitioned` events. Filters to `payload.to_state == 'clinical_review'`.

**PHI minimization:** Before calling the agent, the case payload is reduced to:
- Procedure codes, procedure descriptions
- Diagnosis codes
- LOB, urgency, program
- Digicore-structured requirements (from decision trace, if present)

Excluded from model request: member name, DOB, MRN, address, NPI, coverage identifiers.

Test assertion: `request_body.get('member')` is absent OR all PHI fields are `None`/redacted.

**Agent call:** `POST /assist/completeness` on agent-layer service.
- Request (`AgentInput`): `{tenant_id, case_id, case_summary: {procedure_codes, diagnosis_codes, urgency, lob}, doc_requirements: [...], correlation_id}`
- Response (`AgentOutput`): `{agent_id, tenant_id, case_id, confidence, citations, abstained, abstention_reason, result, provenance}`
  - `result` (when not abstained): `{"gaps": [{description, required_document_type, citation}], "rfi_draft": {subject, body, ...}}`

**Guardrail:** Applied inside the agent-layer graph unconditionally (see `guardrails/rules.py` — `ADVERSE_KEYWORDS`). The consumer does NOT re-run the guardrail; it checks `output.abstained`.

**Response handling:**
- `abstained == True`: log WARN with `output.abstention_reason`; emit `agent.assist.failed` event; no rows written.
- `abstained == False`: map `result["gaps"]` → `case_criteria` rows (`status='gap'`, `text=gap.description`, `criterion_id=gap.required_document_type`, `citations=[gap.citation]`).

**On success:** write rows to `case_criteria` via `CriteriaRepository.insert_criteria()`. Emit `agent.assist.produced` outbox event with `output.provenance` fields + `{case_id, tenant_id, output_count}`.

**On failure:** log ERROR + emit `agent.assist.failed` event. Does NOT raise — the transition is not rolled back.

**DoD:**
- `case_criteria` populated within 5s of `clinical_review` entry in integration test.
- `abstained=True` responses: logged + `agent.assist.failed` event emitted; no rows written.
- PHI absence asserted in unit test: `AgentInput.case_summary` must not contain `member_name`, `date_of_birth`, `mrn`, or any FHIR `identifier` fields.

**Review class:** sensitive (AI) — requires senior engineer review before merge.

---

### UC3 — BFF `GET /bff/cases/{id}/criteria`

**WorkflowClient addition:**
```python
async def criteria(self, case_id: str, tenant_id: str) -> list[dict]: ...
```

**New route in `portal-bff/enstellar_bff/routers/cases.py`:**
```
GET /bff/cases/{case_id}/criteria
```
Auth: `require_reviewer`. Returns `list[CriterionItem]`:
```python
class CriterionItem(BaseModel):
    id: UUID
    criterion_id: str
    text: str
    status: Literal["met", "gap", "unknown"]
    evidence: dict | None
    citations: list[str]
```
404 from workflow-engine forwarded as 404. Tenant from auth token.

**DoD:** returns real data in integration test; 404 forwarded; tenant enforced.

---

### UC4 — Replace hardcoded criteria in web app

**`apps/web/src/api/client.ts`:** add
```ts
export function getCriteria(caseId: string): Promise<CriterionItem[]>
```

**`CasePage.tsx` / `WorkColumn`:**
- Remove `const CRITERIA = [...]`
- Add `useQuery(['criteria', caseId], () => getCriteria(caseId!))`
- Loading state: skeleton cards (3 placeholder rows)
- Empty state: "No criteria data yet." message
- Render: same accordion UI as today but driven by API data

**`apps/web/src/types/index.ts`:** add `CriterionItem` type.

**DoD:** Playwright test: case in `clinical_review` with seeded criteria shows real text + status badges; loading + empty states render without error.

---

## US Group — AI Suggestions

### US1 — `case_suggestions` table + endpoints

**Migration:** `services/workflow-engine/migrations/versions/0008_case_suggestions.py`

Table `case_suggestions`:
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `case_id` | UUID FK → `workflow_instances.case_id` ON DELETE CASCADE | |
| `tenant_id` | TEXT NOT NULL | |
| `agent_id` | TEXT | Which agent produced this |
| `title` | TEXT | Short action title |
| `body` | TEXT | Full suggestion text |
| `confidence` | NUMERIC | 0.0–1.0 |
| `citations` | JSONB | `list[str]` |
| `status` | TEXT CHECK IN(`pending`, `accepted`, `rejected`) default `pending` | |
| `reviewer_id` | TEXT | Set on action |
| `reviewed_at` | TIMESTAMPTZ | Set on action |
| `created_at` | TIMESTAMPTZ server default `now()` | |

Indexes: `(case_id, tenant_id)`, `(status)`.

**Module:** `enstellar_workflow/suggestions/`
- `repository.py`: `insert_suggestions(conn, rows)`, `list_by_case(conn, case_id, tenant_id)`, `record_action(conn, suggestion_id, tenant_id, action, reviewer_id, reviewed_at)`
- `router.py`:
  - `GET /cases/{id}/suggestions` → list, tenant-scoped
  - `POST /cases/{id}/suggestions/{sid}/action` → body `{action: 'accepted'|'rejected', reviewer_id: str}`; writes `status`, `reviewer_id`, `reviewed_at`; emits `agent.suggestion.reviewed` provenance event via outbox

**DoD:** round-trip test: insert suggestion, accept it, assert `agent.suggestion.reviewed` event emitted with full provenance fields.

---

### US2 — Write suggestions on `clinical_review` entry

**Extends UC2's `ClinicalReviewConsumer`** (same consumer, second agent call):

After writing `case_criteria`, call `POST /assist/triage` on agent-layer:
- Same `AgentInput` (PHI-minimized, same `correlation_id`).
- Response (`AgentOutput`): `result` (when not abstained) = `{"suggested_queue": "standard|expedited|md_review", "rationale": "...", "confidence": float, "citations": [...]}`

**Guardrail:** Same as UC2 — applied inside the agent-layer graph. Consumer checks `output.abstained`.

**Response handling:**
- `abstained == True`: log WARN; emit `agent.assist.failed`; no rows written.
- `abstained == False`: write ONE `case_suggestions` row: `title = "Suggested queue: {result['suggested_queue']}"`, `body = result['rationale']`, `confidence = output.confidence`, `citations = output.citations`, `agent_id = output.agent_id`.

**On success:** emit `agent.assist.produced` event with `output.provenance` fields.

**DoD:**
- Suggestions populated alongside criteria in integration test.
- `abstained=True` test: when triage agent returns `abstained=True`, no suggestion rows written.
- PHI not in model request payload (same `AgentInput.case_summary` assertion as UC2).

**Review class:** sensitive (AI) — requires senior engineer review before merge.

---

### US3 — BFF suggestions endpoints

**WorkflowClient additions:**
```python
async def suggestions(self, case_id: str, tenant_id: str) -> list[dict]: ...
async def suggestion_action(self, case_id: str, suggestion_id: str, tenant_id: str, action: str, reviewer_id: str) -> dict: ...
```

**New routes in BFF `routers/cases.py`:**
```
GET  /bff/cases/{case_id}/suggestions
POST /bff/cases/{case_id}/suggestions/{sid}/action
```
Auth: `require_reviewer`. `SuggestionItem` response model mirrors `case_suggestions` row.

**DoD:** both endpoints proxy correctly; tenant enforced; 404 forwarded.

---

### US4 — Wire suggestion cards + Accept/Reject

**`apps/web/src/api/client.ts`:** add
```ts
export function getSuggestions(caseId: string): Promise<SuggestionItem[]>
export function postSuggestionAction(caseId: string, sid: string, action: 'accepted' | 'rejected'): Promise<unknown>
```

**`CasePage.tsx` / `AiColumn`:**
- Remove `const SUGGESTIONS = [...]`
- Add `useQuery(['suggestions', caseId], () => getSuggestions(caseId!))`
- Add `useMutation(({ sid, action }) => postSuggestionAction(caseId!, sid, action))`
- Accept → `markDone(i)` + fire mutation; Reject → same
- Loading state: skeleton cards; empty state: "No suggestions yet."

**`apps/web/src/types/index.ts`:** add `SuggestionItem` type.

**DoD:** Accept/Reject calls API and card dims to `done`; loading state visible during mutation; existing e2e tests unaffected.

---

## Non-negotiable invariants (applies to UC2 + US2)

- [ ] Agent-layer guardrail (in `guardrails/engine.py`) runs unconditionally inside each agent graph; consumer never writes rows from a response where `abstained=True`
- [ ] No adverse language stored: the `rule_no_autonomous_adverse` guardrail (`ADVERSE_KEYWORDS`) fires before any output leaves the agent layer
- [ ] PHI minimized before every model call: `AgentInput.case_summary` contains only codes, urgency, LOB; verified by unit test asserting no `member_name`/`date_of_birth`/`mrn`
- [ ] `tenant_id` on every new table row, query, event, and log line
- [ ] Agent failure (`abstained=True` or HTTP error) does not roll back or block the case transition
- [ ] Senior engineer reviews UC2 and US2 PRs before merge

---

## Implementation order

```
0007 migration (UC1) ─┐
0008 migration (US1) ─┤─> criteria + suggestions modules
                      │
                      ├─> UC1 router + tests
                      ├─> US1 router + tests
                      │
                      ├─> ClinicalReviewConsumer (UC2 + US2 combined)
                      │    + guardrail + PHI minimizer + integration tests
                      │
                      ├─> BFF UC3 + US3 (WorkflowClient + routes + models)
                      │
                      └─> Frontend UC4 + US4 (api/client.ts + CasePage.tsx)
```
