# UA Group: Adverse Transition Payload Enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store structured adverse determination data (gap findings, reason codes, citations) in the decision trace and wire the MD form to collect and submit it.

**Architecture:** Additive payload enrichment only — the adverse-transition guard and existing sign-off invariant are untouched. TransitionEngine emits an additional `case.adverse.structured` outbox event on every adverse transition. BFF `AdverseDecisionRequest` gains four optional fields forwarded into the payload dict already passed to the workflow-engine. A new `MdAdverseForm` React component (replacing `<DecisionForm>` in `MdWorkColumn`) owns all MD-specific structured state; `DecisionForm` is not touched.

**Tech Stack:** Python 3.12 / Pydantic v2 / FastAPI (BFF + workflow-engine), TypeScript / React / TanStack Query v5 (web), asyncpg / JSONB (storage), pytest-asyncio / httpx (tests).

**Review class:** sensitive (decision path) — mandatory senior-engineer review before merge.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `packages/event-contracts/enstellar_events/topics.py` | Modify | Add `ADVERSE_STRUCTURED` topic constant |
| `services/workflow-engine/enstellar_workflow/engine/transitions.py` | Modify | Emit `case.adverse.structured` outbox event on adverse transitions |
| `services/workflow-engine/tests/test_adverse_payload.py` | Create | Unit tests for structured event emission + payload storage |
| `services/portal-bff/enstellar_bff/models.py` | Modify | Add `FindingSection`; extend `AdverseDecisionRequest` with 4 optional fields |
| `services/portal-bff/enstellar_bff/routers/cases.py` | Modify | Merge new optional fields into payload dict forwarded to workflow-engine |
| `services/portal-bff/tests/test_adverse_structured.py` | Create | BFF contract tests for structured payload forwarding |
| `apps/web/src/types/index.ts` | Modify | Add `FindingSection` interface; add `AdverseStructuredPayload` interface |
| `apps/web/src/api/client.ts` | Modify | Extend `submitAdverseDecision` with optional 5th `structured` param |
| `apps/web/src/components/MdAdverseForm.tsx` | Create | Self-contained MD adverse form: findings toggle, chip inputs, sign-off |
| `apps/web/src/pages/CasePage.tsx` | Modify | `MdWorkColumn`: remove Sections 3/4/6, add `<MdAdverseForm>` |

---

## Task UA1-A: Add ADVERSE_STRUCTURED topic constant

**Files:**
- Modify: `packages/event-contracts/enstellar_events/topics.py`

- [ ] **Step 1: Add the constant**

Open `packages/event-contracts/enstellar_events/topics.py`. The file ends with:
```python
    AGENT_ASSIST_PRODUCED = "agent.assist.produced"
    AGENT_ASSIST_FAILED = "agent.assist.failed"
```

Add one line inside the `Topics` class:
```python
    AGENT_ASSIST_PRODUCED = "agent.assist.produced"
    AGENT_ASSIST_FAILED = "agent.assist.failed"
    ADVERSE_STRUCTURED = "case.adverse.structured"
```

- [ ] **Step 2: Verify it imports cleanly**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar
python -c "from enstellar_events import Topics; print(Topics.ADVERSE_STRUCTURED)"
```

Expected output: `case.adverse.structured`

- [ ] **Step 3: Commit**

```bash
git add packages/event-contracts/enstellar_events/topics.py
git commit -m "feat(UA1-A): add ADVERSE_STRUCTURED topic constant"
```

---

## Task UA1-B: Emit structured event in TransitionEngine

**Files:**
- Modify: `services/workflow-engine/enstellar_workflow/engine/transitions.py`
- Create: `services/workflow-engine/tests/test_adverse_payload.py`

**Context:** `TransitionEngine.apply()` in `transitions.py` currently publishes one outbox event (`CASE_STATE_TRANSITIONED`). We add a second event (`ADVERSE_STRUCTURED`) when `to_state` is an adverse state. The structured fields come from `req.payload` — they pass through transparently (the engine does not validate them; the BFF puts them there). `workflow_events.payload` already stores the full `req.payload` dict via `self._recorder.record()` — no change needed there.

- [ ] **Step 1: Write the failing tests**

Create `services/workflow-engine/tests/test_adverse_payload.py`:

```python
"""Tests for adverse transition structured payload emission."""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from enstellar_events import Topics
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest


def _make_engine():
    engine = TransitionEngine()
    mock_case = MagicMock()
    mock_case.status.value = "md_review"
    mock_case.model_copy.return_value = mock_case
    engine._repo.fetch_by_id = AsyncMock(return_value=mock_case)
    engine._repo.update_status = AsyncMock()
    engine._recorder.record = AsyncMock()
    engine._publisher.publish = AsyncMock()
    return engine


def _make_req(to_state: str, payload: dict) -> TransitionRequest:
    return TransitionRequest(
        case_id=uuid.uuid4(),
        tenant_id="t1",
        to_state=to_state,
        actor_id="dr-001",
        actor_type="clinician",
        correlation_id=str(uuid.uuid4()),
        payload=payload,
        human_signoff_recorded=True,
    )


@pytest.mark.asyncio
async def test_adverse_transition_emits_structured_event():
    """Two outbox events published: CASE_STATE_TRANSITIONED + ADVERSE_STRUCTURED."""
    engine = _make_engine()
    req = _make_req(
        to_state="denied",
        payload={
            "reason": "Not medically necessary",
            "determination_type": "denied",
            "finding_sections": [
                {"criterion_id": "C-02", "text": "Missing attestation", "status": "gap"}
            ],
            "reason_codes": ["M54.5"],
            "citations": ["InterQual 2025 §3.4.1"],
        },
    )

    await engine.apply(AsyncMock(), req)

    assert engine._publisher.publish.call_count == 2
    event_types = [c.args[1].type for c in engine._publisher.publish.call_args_list]
    assert Topics.CASE_STATE_TRANSITIONED in event_types
    assert Topics.ADVERSE_STRUCTURED in event_types


@pytest.mark.asyncio
async def test_structured_event_payload_fields():
    """ADVERSE_STRUCTURED event carries determination_type, finding_sections, reason_codes, citations."""
    engine = _make_engine()
    req = _make_req(
        to_state="partially_denied",
        payload={
            "reason": "Partial denial",
            "determination_type": "partially_denied",
            "finding_sections": [{"criterion_id": "C-02", "text": "gap text", "status": "gap"}],
            "reason_codes": ["M54.5", "M51.16"],
            "citations": ["Policy §4.2.1"],
        },
    )

    await engine.apply(AsyncMock(), req)

    calls = engine._publisher.publish.call_args_list
    structured_call = next(c for c in calls if c.args[1].type == Topics.ADVERSE_STRUCTURED)
    ev = structured_call.args[1]
    assert ev.payload["determination_type"] == "partially_denied"
    assert ev.payload["reason_codes"] == ["M54.5", "M51.16"]
    assert ev.payload["citations"] == ["Policy §4.2.1"]
    assert ev.payload["finding_sections"][0]["criterion_id"] == "C-02"
    assert ev.tenant_id == "t1"


@pytest.mark.asyncio
async def test_structured_fields_stored_in_workflow_events_payload():
    """Structured fields appear in the payload written to workflow_events."""
    engine = _make_engine()
    payload = {
        "reason": "Not medically necessary",
        "determination_type": "denied",
        "reason_codes": ["M54.5"],
        "citations": ["Policy §4.2.1"],
    }
    req = _make_req(to_state="denied", payload=payload)

    await engine.apply(AsyncMock(), req)

    record_kwargs = engine._recorder.record.call_args.kwargs
    stored = record_kwargs["payload"]
    assert stored["determination_type"] == "denied"
    assert stored["reason_codes"] == ["M54.5"]
    assert stored["citations"] == ["Policy §4.2.1"]


@pytest.mark.asyncio
async def test_legacy_adverse_still_emits_structured_event():
    """Legacy call (reason only, no structured fields) still emits ADVERSE_STRUCTURED with None fields."""
    engine = _make_engine()
    req = _make_req(to_state="denied", payload={"reason": "Not medically necessary"})

    await engine.apply(AsyncMock(), req)

    calls = engine._publisher.publish.call_args_list
    assert any(c.args[1].type == Topics.ADVERSE_STRUCTURED for c in calls)
    structured_call = next(c for c in calls if c.args[1].type == Topics.ADVERSE_STRUCTURED)
    ev = structured_call.args[1]
    # determination_type defaults to to_state when not in payload
    assert ev.payload["determination_type"] == "denied"
    assert ev.payload["finding_sections"] is None
    assert ev.payload["reason_codes"] is None
    assert ev.payload["citations"] is None


@pytest.mark.asyncio
async def test_non_adverse_transition_does_not_emit_structured_event():
    """Approved transition emits only CASE_STATE_TRANSITIONED (no ADVERSE_STRUCTURED)."""
    engine = _make_engine()
    req = _make_req(to_state="approved", payload={"reason": "All criteria met"})

    await engine.apply(AsyncMock(), req)

    assert engine._publisher.publish.call_count == 1
    assert engine._publisher.publish.call_args.args[1].type == Topics.CASE_STATE_TRANSITIONED
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar
python -m pytest services/workflow-engine/tests/test_adverse_payload.py -v 2>&1 | head -40
```

Expected: `FAILED` (AttributeError or assertion on call count = 1 not 2).

- [ ] **Step 3: Implement — extend TransitionEngine.apply()**

Open `services/workflow-engine/enstellar_workflow/engine/transitions.py`.

After `from .guards import GuardError, adverse_transition_guard`, add at the top of the file:

```python
_ADVERSE_STATES: frozenset[str] = frozenset(
    {"denied", "partially_denied", "adverse_modification"}
)
```

Then, after the existing `await self._publisher.publish(conn, event)` call (line 106), add:

```python
        # 6. If adverse, publish a second structured-payload event for downstream consumers
        if req.to_state in _ADVERSE_STATES:
            structured_event = EventEnvelope(
                event_id=uuid.uuid4(),
                tenant_id=req.tenant_id,
                case_id=req.case_id,
                correlation_id=req.correlation_id,
                type=Topics.ADVERSE_STRUCTURED,
                occurred_at=occurred_at,
                actor=Actor(id=req.actor_id, type=actor_type_enum),
                payload={
                    "determination_type": req.payload.get(
                        "determination_type", req.to_state
                    ),
                    "finding_sections": req.payload.get("finding_sections"),
                    "reason_codes": req.payload.get("reason_codes"),
                    "citations": req.payload.get("citations"),
                    "reason": req.payload.get("reason"),
                },
                schema_version="1.0.0",
            )
            await self._publisher.publish(conn, structured_event)
```

Also update the import at the top of the file — `Topics` is already imported via `from enstellar_events import Actor, ActorType, EventEnvelope, Topics`. No import change needed.

The full updated `apply()` method after edit:

```python
    async def apply(self, conn: asyncpg.Connection, req: TransitionRequest) -> Case:
        case = await self._repo.fetch_by_id(conn, req.case_id, req.tenant_id)
        if case is None:
            raise ValueError(
                f"Case {req.case_id} not found for tenant {req.tenant_id!r}"
            )

        from_state = case.status.value

        guard_result = adverse_transition_guard(req.to_state, req.human_signoff_recorded)
        if not guard_result.passed:
            raise GuardError(guard_result.reason)  # type: ignore[arg-type]

        occurred_at = datetime.now(timezone.utc)

        await self._recorder.record(
            conn,
            case_id=req.case_id,
            tenant_id=req.tenant_id,
            event_type=Topics.CASE_STATE_TRANSITIONED,
            from_state=from_state,
            to_state=req.to_state,
            actor_id=req.actor_id,
            actor_type=req.actor_type,
            correlation_id=req.correlation_id,
            payload=req.payload,
            occurred_at=occurred_at,
        )

        await self._repo.update_status(conn, case, req.to_state, occurred_at)

        try:
            actor_type_enum = ActorType(req.actor_type)
        except ValueError:
            actor_type_enum = ActorType.SERVICE

        event = EventEnvelope(
            event_id=uuid.uuid4(),
            tenant_id=req.tenant_id,
            case_id=req.case_id,
            correlation_id=req.correlation_id,
            type=Topics.CASE_STATE_TRANSITIONED,
            occurred_at=occurred_at,
            actor=Actor(id=req.actor_id, type=actor_type_enum),
            payload={
                "from_state": from_state,
                "to_state": req.to_state,
                **req.payload,
            },
            schema_version="1.0.0",
        )
        await self._publisher.publish(conn, event)

        if req.to_state in _ADVERSE_STATES:
            structured_event = EventEnvelope(
                event_id=uuid.uuid4(),
                tenant_id=req.tenant_id,
                case_id=req.case_id,
                correlation_id=req.correlation_id,
                type=Topics.ADVERSE_STRUCTURED,
                occurred_at=occurred_at,
                actor=Actor(id=req.actor_id, type=actor_type_enum),
                payload={
                    "determination_type": req.payload.get(
                        "determination_type", req.to_state
                    ),
                    "finding_sections": req.payload.get("finding_sections"),
                    "reason_codes": req.payload.get("reason_codes"),
                    "citations": req.payload.get("citations"),
                    "reason": req.payload.get("reason"),
                },
                schema_version="1.0.0",
            )
            await self._publisher.publish(conn, structured_event)

        return case.model_copy(
            update={"status": Status(req.to_state), "updated_at": occurred_at}
        )
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
python -m pytest services/workflow-engine/tests/test_adverse_payload.py -v
```

Expected: `5 passed`

- [ ] **Step 5: Run full workflow-engine test suite — no regressions**

```bash
python -m pytest services/workflow-engine/tests/ -v --tb=short 2>&1 | tail -20
```

Expected: all previously passing tests still pass; 5 new tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/event-contracts/enstellar_events/topics.py \
        services/workflow-engine/enstellar_workflow/engine/transitions.py \
        services/workflow-engine/tests/test_adverse_payload.py
git commit -m "feat(UA1-B): emit case.adverse.structured outbox event on adverse transitions"
```

---

## Task UA2: Extend BFF AdverseDecisionRequest + endpoint

**Files:**
- Modify: `services/portal-bff/enstellar_bff/models.py`
- Modify: `services/portal-bff/enstellar_bff/routers/cases.py`
- Create: `services/portal-bff/tests/test_adverse_structured.py`

**Context:** `AdverseDecisionRequest` currently has `outcome`, `reason`, `clinician_id`, `sign_off_confirmed`. We add four optional fields. `submit_adverse_decision` currently passes `payload={"reason": body.reason}` to `workflow_client.transition()`; we extend that dict conditionally. `workflow_client.transition()` already accepts `payload: dict` — no changes to the client method.

- [ ] **Step 1: Write the failing tests**

Create `services/portal-bff/tests/test_adverse_structured.py`:

```python
"""BFF contract tests: structured adverse payload forwarding."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport

from enstellar_bff.auth import require_reviewer
from enstellar_bff.main import app

CASE_ID = "00000000-0000-0000-0000-000000000001"
AUTH = {"sub": "reviewer-001", "tenant_id": "tenant-a"}


@pytest.fixture(autouse=True)
def override_auth():
    app.dependency_overrides[require_reviewer] = lambda: AUTH
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_structured_fields_forwarded_to_workflow_engine():
    """All four structured fields appear in the payload passed to workflow_client.transition()."""
    with patch("enstellar_bff.routers.cases.workflow_client") as mock_wf:
        mock_wf.record_signoff = AsyncMock(return_value={})
        mock_wf.transition = AsyncMock(
            return_value={"case_id": CASE_ID, "status": "denied"}
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"/bff/cases/{CASE_ID}/adverse-decision",
                json={
                    "outcome": "denied",
                    "reason": "Not medically necessary",
                    "clinician_id": "dr-001",
                    "sign_off_confirmed": True,
                    "determination_type": "denied",
                    "finding_sections": [
                        {
                            "criterion_id": "C-02",
                            "text": "Missing attestation",
                            "status": "gap",
                        }
                    ],
                    "reason_codes": ["M54.5"],
                    "citations": ["InterQual 2025 §3.4.1"],
                },
            )

        assert resp.status_code == 200
        payload = mock_wf.transition.call_args.kwargs["payload"]
        assert payload["determination_type"] == "denied"
        assert payload["finding_sections"] == [
            {"criterion_id": "C-02", "text": "Missing attestation", "status": "gap"}
        ]
        assert payload["reason_codes"] == ["M54.5"]
        assert payload["citations"] == ["InterQual 2025 §3.4.1"]
        assert payload["reason"] == "Not medically necessary"


@pytest.mark.asyncio
async def test_legacy_call_without_structured_fields_still_returns_200():
    """Backwards compat: omitting new fields returns 200; payload contains only reason."""
    with patch("enstellar_bff.routers.cases.workflow_client") as mock_wf:
        mock_wf.record_signoff = AsyncMock(return_value={})
        mock_wf.transition = AsyncMock(
            return_value={"case_id": CASE_ID, "status": "denied"}
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"/bff/cases/{CASE_ID}/adverse-decision",
                json={
                    "outcome": "denied",
                    "reason": "Not medically necessary",
                    "clinician_id": "dr-001",
                    "sign_off_confirmed": True,
                },
            )

        assert resp.status_code == 200
        payload = mock_wf.transition.call_args.kwargs["payload"]
        assert payload == {"reason": "Not medically necessary"}
        # No new keys when fields are omitted
        assert "determination_type" not in payload
        assert "finding_sections" not in payload


@pytest.mark.asyncio
async def test_sign_off_false_still_returns_400_with_structured_fields():
    """Existing invariant: sign_off_confirmed=False → 400, even when structured fields present."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            f"/bff/cases/{CASE_ID}/adverse-decision",
            json={
                "outcome": "denied",
                "reason": "test",
                "clinician_id": "dr-001",
                "sign_off_confirmed": False,
                "determination_type": "denied",
                "reason_codes": ["M54.5"],
            },
        )

    assert resp.status_code == 400
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
python -m pytest services/portal-bff/tests/test_adverse_structured.py -v 2>&1 | head -30
```

Expected: `FAILED` (assertion errors — structured fields not yet forwarded).

- [ ] **Step 3: Add FindingSection model and extend AdverseDecisionRequest**

Open `services/portal-bff/enstellar_bff/models.py`. After the `AdverseDecisionRequest` class (currently ending at `sign_off_confirmed: bool`), add `FindingSection` **before** `AdverseDecisionRequest`, and extend `AdverseDecisionRequest`:

Replace the existing `AdverseDecisionRequest` class:

```python
class AdverseDecisionRequest(BaseModel):
    """Request body for POST /bff/cases/{id}/adverse-decision."""

    outcome: Literal["denied", "partially_denied", "adverse_modification"]
    reason: str = Field(..., min_length=1)
    clinician_id: str
    sign_off_confirmed: bool
```

With:

```python
class FindingSection(BaseModel):
    criterion_id: str
    text: str
    status: Literal["gap", "unknown"]


class AdverseDecisionRequest(BaseModel):
    """Request body for POST /bff/cases/{id}/adverse-decision."""

    outcome: Literal["denied", "partially_denied", "adverse_modification"]
    reason: str = Field(..., min_length=1)
    clinician_id: str
    sign_off_confirmed: bool
    # Structured payload fields — all optional for backwards compatibility
    determination_type: str | None = None
    finding_sections: list[FindingSection] | None = None
    reason_codes: list[str] | None = None
    citations: list[str] | None = None
```

- [ ] **Step 4: Extend submit_adverse_decision in cases.py**

Open `services/portal-bff/enstellar_bff/routers/cases.py`. Find the `return await workflow_client.transition(...)` call in `submit_adverse_decision`. The current `payload={"reason": body.reason}` line becomes:

```python
    payload: dict = {"reason": body.reason}
    if body.determination_type is not None:
        payload["determination_type"] = body.determination_type
    if body.finding_sections is not None:
        payload["finding_sections"] = [f.model_dump() for f in body.finding_sections]
    if body.reason_codes is not None:
        payload["reason_codes"] = body.reason_codes
    if body.citations is not None:
        payload["citations"] = body.citations

    return await workflow_client.transition(
        case_id=str(case_id),
        tenant_id=auth["tenant_id"],
        to_state=body.outcome,
        actor_id=auth["sub"],
        actor_type="user",
        correlation_id=correlation_id,
        payload=payload,
        human_signoff_recorded=True,
    )
```

Also update the import from models at the top of `cases.py` — `FindingSection` is used implicitly via Pydantic; no explicit import needed since it's only referenced through `AdverseDecisionRequest`. Confirm `AdverseDecisionRequest` is already imported.

- [ ] **Step 5: Run tests — verify they pass**

```bash
python -m pytest services/portal-bff/tests/test_adverse_structured.py -v
```

Expected: `3 passed`

- [ ] **Step 6: Run full BFF test suite — no regressions**

```bash
python -m pytest services/portal-bff/tests/ -v --tb=short 2>&1 | tail -20
```

Expected: all previously passing tests still pass; 3 new tests pass.

- [ ] **Step 7: Commit**

```bash
git add services/portal-bff/enstellar_bff/models.py \
        services/portal-bff/enstellar_bff/routers/cases.py \
        services/portal-bff/tests/test_adverse_structured.py
git commit -m "feat(UA2): extend AdverseDecisionRequest with structured payload fields"
```

---

## Task UA3-A: TypeScript types + API client

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/api/client.ts`

**Context:** `submitAdverseDecision` currently takes 4 positional params. We add a 5th optional `structured` param that is spread into the POST body. `DecisionForm.tsx` calls `submitAdverseDecision(caseId, outcome, reason.trim(), clinicianId.trim())` — the 5th param is absent, so it gets `undefined` and nothing changes.

- [ ] **Step 1: Add FindingSection and AdverseStructuredPayload to types/index.ts**

Open `apps/web/src/types/index.ts`. Add after the existing `export type AdverseOutcome = ...` line:

```ts
export interface FindingSection {
  criterion_id: string
  text: string
  status: 'gap' | 'unknown'
}

export interface AdverseStructuredPayload {
  determination_type: string
  finding_sections: FindingSection[]
  reason_codes: string[]
  citations: string[]
}
```

- [ ] **Step 2: Extend submitAdverseDecision in client.ts**

Open `apps/web/src/api/client.ts`. The current import line is:

```ts
import type { AdverseOutcome, CaseDetail, CriterionItem, DocumentItem, QueueStats, SuggestionItem, WorklistPage } from '../types'
```

Add `AdverseStructuredPayload` and `FindingSection` to the import:

```ts
import type { AdverseOutcome, AdverseStructuredPayload, CaseDetail, CriterionItem, DocumentItem, FindingSection, QueueStats, SuggestionItem, WorklistPage } from '../types'
```

Then find `submitAdverseDecision` and replace it:

```ts
export function submitAdverseDecision(
  caseId: string,
  outcome: AdverseOutcome,
  reason: string,
  clinicianId: string,
  structured?: AdverseStructuredPayload,
): Promise<unknown> {
  return apiFetch(`/cases/${caseId}/adverse-decision`, {
    method: 'POST',
    body: JSON.stringify({
      outcome,
      reason,
      clinician_id: clinicianId,
      sign_off_confirmed: true,
      ...(structured ?? {}),
    }),
  })
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/apps/web
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/api/client.ts
git commit -m "feat(UA3-A): add FindingSection types and extend submitAdverseDecision signature"
```

---

## Task UA3-B: MdAdverseForm component

**Files:**
- Create: `apps/web/src/components/MdAdverseForm.tsx`

**Context:** This component replaces `<DecisionForm>` in `MdWorkColumn`. It owns: criteria query (pre-populates finding sections), deselect-to-exclude toggle pattern for findings, chip-input for reason codes and citations, free-text rationale, clinicianId, attestation checkbox, and submit. `DecisionForm.tsx` is not modified.

The finding section toggle uses a **deselected set** (starts empty = all gap criteria selected). MD unchecks to exclude. This avoids the empty-set-on-mount problem with `useState(() => new Set(asyncData))`.

- [ ] **Step 1: Create MdAdverseForm.tsx**

Create `apps/web/src/components/MdAdverseForm.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { submitAdverseDecision, getCriteria } from '../api/client'
import type { AdverseOutcome, FindingSection } from '../types'

interface Props {
  caseId: string
  determinationType: string
  onComplete: () => void
}

export function MdAdverseForm({ caseId, determinationType, onComplete }: Props) {
  const queryClient = useQueryClient()

  const { data: criteria = [] } = useQuery({
    queryKey: ['criteria', caseId],
    queryFn: () => getCriteria(caseId),
    staleTime: 60_000,
  })

  // Only gap/unknown criteria are relevant for an adverse determination
  const gapCriteria = criteria.filter(c => c.status !== 'met')

  // Deselected set: starts empty (all gap criteria selected by default).
  // MD unchecks to exclude a finding from the submission.
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set())

  const [reasonCodes, setReasonCodes] = useState<string[]>([])
  const [reasonCodeInput, setReasonCodeInput] = useState('')
  const [citations, setCitations] = useState<string[]>([])
  const [citationInput, setCitationInput] = useState('')
  const [rationale, setRationale] = useState('')
  const [clinicianId, setClinicianId] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const canSubmit =
    rationale.trim().length > 0 && clinicianId.trim().length > 0 && confirmed

  const mut = useMutation({
    mutationFn: () => {
      const selectedFindings: FindingSection[] = gapCriteria
        .filter(c => !deselectedIds.has(c.id))
        .map(c => ({
          criterion_id: c.criterion_id,
          text: c.text,
          status: c.status as 'gap' | 'unknown',
        }))

      return submitAdverseDecision(
        caseId,
        determinationType as AdverseOutcome,
        rationale.trim(),
        clinicianId.trim(),
        {
          determination_type: determinationType,
          finding_sections: selectedFindings,
          reason_codes: reasonCodes,
          citations,
        },
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseId] })
      onComplete()
    },
  })

  function toggleFinding(id: string) {
    setDeselectedIds(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  function addReasonCode() {
    const code = reasonCodeInput.trim()
    if (code && !reasonCodes.includes(code)) {
      setReasonCodes(prev => [...prev, code])
    }
    setReasonCodeInput('')
  }

  function addCitation() {
    const cit = citationInput.trim()
    if (cit && !citations.includes(cit)) {
      setCitations(prev => [...prev, cit])
    }
    setCitationInput('')
  }

  return (
    <div className="en-md-adverse-form" data-testid="md-adverse-form">

      {/* Gap findings — pre-populated, MD confirms or deselects */}
      {gapCriteria.length > 0 && (
        <div className="en-field">
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: 'var(--ink-mut)',
              fontFamily: 'var(--mono)',
              marginBottom: 8,
            }}
          >
            Gap findings driving this determination
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {gapCriteria.map(c => (
              <label
                key={c.id}
                className="en-finding-toggle"
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}
                data-testid={`finding-toggle-${c.criterion_id}`}
              >
                <input
                  type="checkbox"
                  checked={!deselectedIds.has(c.id)}
                  onChange={() => toggleFinding(c.id)}
                  style={{ marginTop: 2 }}
                />
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    background: 'var(--amber-tint)',
                    color: 'var(--amber)',
                    padding: '1px 6px',
                    borderRadius: 4,
                    flexShrink: 0,
                  }}
                >
                  {c.criterion_id}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink)', flex: 1 }}>
                  {c.text}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--amber)',
                    flexShrink: 0,
                    fontFamily: 'var(--mono)',
                  }}
                >
                  {c.status}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Reason codes */}
      <div className="en-field" style={{ marginTop: 14 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--ink-mut)',
            fontFamily: 'var(--mono)',
            marginBottom: 6,
          }}
        >
          Clinical reason codes (ICD / CPT)
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={reasonCodeInput}
            onChange={e => setReasonCodeInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addReasonCode()
              }
            }}
            placeholder="e.g. M54.5"
            data-testid="reason-code-input"
            className="en-input"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={addReasonCode}
            className="en-act"
            data-testid="add-reason-code"
            style={{ fontSize: 12, padding: '6px 10px' }}
          >
            Add
          </button>
        </div>
        {reasonCodes.length > 0 && (
          <div className="en-chips" style={{ marginTop: 6 }}>
            {reasonCodes.map(code => (
              <span key={code} className="en-chip-on" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {code}
                <button
                  type="button"
                  onClick={() => setReasonCodes(prev => prev.filter(c => c !== code))}
                  data-testid={`remove-code-${code}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Citations */}
      <div className="en-field" style={{ marginTop: 14 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--ink-mut)',
            fontFamily: 'var(--mono)',
            marginBottom: 6,
          }}
        >
          Supporting citations
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={citationInput}
            onChange={e => setCitationInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCitation()
              }
            }}
            placeholder="e.g. InterQual 2025 §3.4.1"
            data-testid="citation-input"
            className="en-input"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={addCitation}
            className="en-act"
            data-testid="add-citation"
            style={{ fontSize: 12, padding: '6px 10px' }}
          >
            Add
          </button>
        </div>
        {citations.length > 0 && (
          <div className="en-chips" style={{ marginTop: 6 }}>
            {citations.map(cit => (
              <span key={cit} className="en-chip-on" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {cit}
                <button
                  type="button"
                  onClick={() => setCitations(prev => prev.filter(c => c !== cit))}
                  data-testid={`remove-citation-${cit}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Clinical rationale */}
      <div className="en-field" style={{ marginTop: 14 }}>
        <label
          htmlFor="md-rationale"
          style={{
            display: 'block',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--ink-mut)',
            fontFamily: 'var(--mono)',
            marginBottom: 6,
          }}
        >
          Clinical rationale <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <textarea
          id="md-rationale"
          value={rationale}
          onChange={e => setRationale(e.target.value)}
          placeholder="Document the clinical basis for this adverse determination. This will inform the member and provider notice."
          rows={4}
          data-testid="md-rationale"
          className="en-textarea"
        />
      </div>

      {/* Clinician ID */}
      <div className="en-field" style={{ marginTop: 10 }}>
        <label
          htmlFor="md-clinician-id"
          style={{
            display: 'block',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--ink-mut)',
            fontFamily: 'var(--mono)',
            marginBottom: 6,
          }}
        >
          Clinician ID (NPI or internal) <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <input
          id="md-clinician-id"
          type="text"
          value={clinicianId}
          onChange={e => setClinicianId(e.target.value)}
          placeholder="e.g. 1234567890"
          data-testid="md-clinician-id"
          className="en-input"
        />
      </div>

      {/* Attestation */}
      <div className="en-attest" style={{ marginTop: 12 }}>
        <input
          type="checkbox"
          id="md-confirm"
          checked={confirmed}
          onChange={e => setConfirmed(e.target.checked)}
          data-testid="md-confirm-checkbox"
        />
        <label htmlFor="md-confirm" style={{ fontSize: 12, color: 'var(--ink-sec)' }}>
          I am a licensed physician reviewer. I have reviewed the clinical record and
          applicable criteria, and I attest that this adverse determination reflects my
          independent clinical judgment. I understand this action is final, requires
          human sign-off, and will be recorded with full provenance.
        </label>
      </div>

      {mut.isError && (
        <p
          role="alert"
          style={{ color: 'var(--red)', marginTop: 10, fontSize: 13, fontWeight: 600 }}
        >
          Error: {(mut.error as Error).message}
        </p>
      )}

      <div className="en-decision-actions" style={{ marginTop: 14 }}>
        <button
          type="button"
          onClick={() => mut.mutate()}
          disabled={!canSubmit || mut.isPending}
          data-testid="btn-submit-adverse"
          className="en-act danger"
          style={!canSubmit ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
        >
          {mut.isPending ? 'Recording…' : 'Issue adverse determination'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/apps/web
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/MdAdverseForm.tsx
git commit -m "feat(UA3-B): add MdAdverseForm component with findings toggle and chip inputs"
```

---

## Task UA3-C: Wire MdWorkColumn

**Files:**
- Modify: `apps/web/src/pages/CasePage.tsx`

**Context:** `MdWorkColumn` in `CasePage.tsx` (function starting around line 983). We remove the three sections that move into `MdAdverseForm` and replace `<DecisionForm>` with `<MdAdverseForm>`. The changes are:
- Add import for `MdAdverseForm`
- Remove Section 3 (hardcoded reason codes chips block)
- Remove Section 4 (hardcoded citations chips block)
- Remove Section 6 content (the `<DecisionForm>` embed and its surrounding `en-det-section` div)
- Add `<MdAdverseForm>` after Section 5

`DecisionForm` remains imported and used in `WorkColumn` — do not touch that usage.

- [ ] **Step 1: Add MdAdverseForm import**

Open `apps/web/src/pages/CasePage.tsx`. The current import at the top:

```tsx
import { DecisionForm } from '../components/DecisionForm'
```

Add alongside it:

```tsx
import { DecisionForm } from '../components/DecisionForm'
import { MdAdverseForm } from '../components/MdAdverseForm'
```

- [ ] **Step 2: Remove Section 3 (hardcoded reason codes) from MdWorkColumn**

Find and remove the entire Section 3 block in `MdWorkColumn`. It looks like:

```tsx
      {/* Section 3: Clinical reason codes */}
      <div className="en-det-section">
        <div className="en-sec-h">
          <span className="sn">3</span>
          <span className="st">Clinical reason codes</span>
          <span className="req done">Added</span>
        </div>
        <div className="en-sec-b">
          <div className="en-chips">
            <span className="en-chip-on">M54.5 — Low back pain</span>
            <span className="en-chip-on">M51.16 — Disc degeneration</span>
            <button className="en-chip-add">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 3v10M3 8h10"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              Add code
            </button>
          </div>
        </div>
      </div>
```

Delete this entire block.

- [ ] **Step 3: Remove Section 4 (hardcoded citations) from MdWorkColumn**

Find and remove the entire Section 4 block:

```tsx
      {/* Section 4: Citations */}
      <div className="en-det-section">
        <div className="en-sec-h">
          <span className="sn">4</span>
          <span className="st">Supporting citations</span>
          <span className="req done">Added</span>
        </div>
        <div className="en-sec-b">
          <div className="en-chips">
            <span className="en-chip-on">InterQual 2025 §3.4.1</span>
            <span className="en-chip-on">Plan Policy §4.2.1</span>
            <button className="en-chip-add">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 3v10M3 8h10"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              Add citation
            </button>
          </div>
        </div>
      </div>
```

Delete this entire block.

- [ ] **Step 4: Replace Section 6 (DecisionForm) with MdAdverseForm**

Find Section 6 in `MdWorkColumn`:

```tsx
      {/* Section 6: Clinician sign-off — contains DecisionForm (keeps all testids) */}
      <div className="en-det-section">
        <div className="en-sec-h">
          <span className="sn">6</span>
          <span className="st">Clinician sign-off</span>
          {decisionDone ? (
            <span className="req done">Complete</span>
          ) : (
            <span className="req">Required</span>
          )}
        </div>
        <div className="en-sec-b">
          <DecisionForm caseId={caseId} onComplete={onDecisionComplete} />
        </div>
      </div>
```

Replace with:

```tsx
      {/* Section 6: Structured adverse sign-off */}
      <div className="en-det-section">
        <div className="en-sec-h">
          <span className="sn">6</span>
          <span className="st">Findings, codes &amp; sign-off</span>
          {decisionDone ? (
            <span className="req done">Complete</span>
          ) : (
            <span className="req">Required</span>
          )}
        </div>
        {!decisionDone && (
          <div className="en-sec-b">
            <MdAdverseForm
              caseId={caseId}
              determinationType={mdType}
              onComplete={onDecisionComplete}
            />
          </div>
        )}
      </div>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/apps/web
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Verify dev server starts without crash**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/apps/web
npx vite build 2>&1 | tail -10
```

Expected: `built in Xs` with no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/CasePage.tsx
git commit -m "feat(UA3-C): wire MdWorkColumn to MdAdverseForm; remove hardcoded Sections 3/4"
```

---

## Final: run make test and update task graph

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar
python -m pytest services/workflow-engine/tests/ services/portal-bff/tests/ -v --tb=short 2>&1 | tail -30
```

Expected: all tests pass (new + existing).

- [ ] **Step 2: Mark UA tasks done in task graph**

Open `.claude/task-graph.md`. Change:

```
| UA1 extend adverse transition payload schema | Py | T16 | **sensitive (decision path)** | `[ ]` |
| UA2 BFF: pass structured fields through adverse endpoint | Py | UA1 | **sensitive (decision path)** | `[ ]` |
| UA3 web: collect all MD form state on adverse submit | TS | UA2 | **sensitive (decision path)** | `[ ]` |
```

To:

```
| UA1 extend adverse transition payload schema | Py | T16 | **sensitive (decision path)** | `[x]` |
| UA2 BFF: pass structured fields through adverse endpoint | Py | UA1 | **sensitive (decision path)** | `[x]` |
| UA3 web: collect all MD form state on adverse submit | TS | UA2 | **sensitive (decision path)** | `[x]` |
```

- [ ] **Step 3: Commit task graph**

```bash
git add .claude/task-graph.md
git commit -m "chore: mark UA1-UA3 done in task graph — P2 complete"
```
