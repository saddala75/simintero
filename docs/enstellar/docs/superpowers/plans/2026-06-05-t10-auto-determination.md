# T10 — Auto-Determination (Approve-Only) + Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `DigiCoreClient` into the workflow-engine's `auto_determination` state. `AutoDeterminator` evaluates the request via Digicore, records an immutable `Decision` object (with the rules trace pinned to the Digicore artifact + version returned at call time), and transitions to `Status.approved` (auto) or `Status.clinical_review` (anything else — including circuit-open and Digicore unavailable). Prove with Hypothesis property tests across all possible Digicore response values that **no adverse outcome (`denied`, `partially_denied`, `adverse_modification`) can ever be produced by the auto-determination path.**

**Architecture:** `AutoDeterminator` lives in `enstellar_workflow/engine/auto_determination.py`. It takes `conn` from the caller (caller owns the transaction), calls `DigiCoreClient.evaluate_request()`, and either calls `TransitionEngine.apply()` to `Status.approved` (recording a `Decision` in `case_json`) or to `Status.clinical_review`. `DecisionRecorder` appends the `Decision` to `case_json['decisions']` via a targeted JSONB update in the same transaction — this runs after `TransitionEngine.apply()` so it does not conflict with the status update. An `AutoDeterminationConsumer` drives the path by consuming `case.state.transitioned` events with `to_state = "auto_determination"`.

**Tech Stack:** Python 3.12, asyncpg, httpx, hypothesis>=6.100, pytest-asyncio, Testcontainers (PostgreSQL).

> **INVARIANT (NON-NEGOTIABLE):** `AutoDeterminator` can only produce `Status.approved` or `Status.clinical_review`. It is structurally impossible for it to produce `denied`, `partially_denied`, or `adverse_modification`. The auto-determination path never calls `TransitionEngine.apply()` with an adverse `to_state`; the existing adverse-transition guard in `guards.py` provides a second defense layer. Both invariants are proven by Hypothesis property tests with 100 examples over all possible Digicore response values (including `denied`) and all possible exception types.

**Depends on:** T08 (TransitionEngine, CaseService, CaseRepository, OutboxPublisher — all in `enstellar_workflow/engine/` and `enstellar_workflow/cases/`), T09 (DigiCoreClient, CircuitOpenError — in `enstellar_connectors`).

---

## Background (read before touching code)

All new files are under `services/workflow-engine/`. The package is `enstellar_workflow`.

**T08 interfaces in use (already implemented):**

```python
# enstellar_workflow/engine/guards.py
ADVERSE_STATES = frozenset({"denied", "partially_denied", "adverse_modification"})

# enstellar_workflow/engine/transitions.py
@dataclass
class TransitionRequest:
    case_id: UUID
    tenant_id: str
    to_state: str
    actor_id: str
    actor_type: str
    correlation_id: str
    payload: dict = field(default_factory=dict)
    human_signoff_recorded: bool = False

class TransitionEngine:
    async def apply(self, conn: asyncpg.Connection, req: TransitionRequest) -> Case: ...

# enstellar_workflow/cases/service.py
class CaseService:
    async def create_case(self, case: Case) -> Case: ...
    async def transition(self, req: TransitionRequest) -> Case: ...
    async def get_events(self, case_id: UUID, tenant_id: str) -> list[dict]: ...
```

**Canonical model types (already generated):**
```python
# canonical_model/decision.py
class Outcome(StrEnum):
    approved = 'approved'; denied = 'denied'; partially_denied = 'partially_denied'
    adverse_modification = 'adverse_modification'; pending = 'pending'; not_required = 'not_required'

class Decision(BaseModel):
    decision_id: UUID; tenant_id: str; case_id: UUID; outcome: Outcome
    rule_artifact_id: str; rule_version: str; criteria_branch: str | None
    evidence_refs: list[str]; human_signoff_required: bool
    human_signoff_actor: str | None; human_signoff_at: AwareDatetime | None
    auto_approved: bool; decided_at: AwareDatetime

# canonical_model/case.py
class Status(StrEnum):
    intake = 'intake'; completeness_check = 'completeness_check'
    auto_determination = 'auto_determination'; clinical_review = 'clinical_review'
    pend_rfi = 'pend_rfi'; approved = 'approved'; denied = 'denied'
    partially_denied = 'partially_denied'; adverse_modification = 'adverse_modification'
    withdrawn = 'withdrawn'; closed = 'closed'

class Case(BaseModel):
    ...
    decisions: list[Decision] | None = []
```

**event-contracts:**
- `Topics.DECISION_RECORDED = "decision.recorded"`
- `Topics.CASE_STATE_TRANSITIONED = "case.state.transitioned"`
- `EventEnvelope`, `Actor`, `ActorType`

**Test conventions (same as T08):**
- `tests/conftest.py` provides `pg_pool: asyncpg.Pool` and `make_case()` factory (function-scoped, Testcontainers)
- `asyncio_mode = "auto"` — use `@pytest.mark.asyncio` on every async test
- Run tests: `cd services/workflow-engine && uv run pytest -v`
- Run a single file: `cd services/workflow-engine && uv run pytest tests/test_auto_determination.py -v`
- Hypothesis tests run with `--hypothesis-seed=0` for reproducibility in CI

**Workflow of a case through the auto-determination path:**
1. `IntakeConsumer` receives `case.intake.received` → creates case (status: `intake`)
2. `IntakeConsumer` transitions case to `completeness_check`
3. `IntakeConsumer` (or `CompletenessConsumer`) transitions case to `auto_determination` (stub — real completeness checks are T13)
4. `AutoDeterminationConsumer` receives `case.state.transitioned` (to_state=`auto_determination`) → calls `AutoDeterminator.run()`
5. `AutoDeterminator` calls Digicore. On `approved` → transition to `approved`, append `Decision` to `case_json`. On anything else → transition to `clinical_review`.

**`DecisionRecorder.append_decision()` SQL design:**
```sql
UPDATE workflow_instances
SET case_json = jsonb_set(
    case_json,
    '{decisions}',
    COALESCE(case_json->'decisions', '[]'::jsonb) || $1::jsonb
)
WHERE case_id = $2 AND tenant_id = $3
```
The `||` operator on JSONB arrays concatenates. `$1` is a JSON array containing one serialized `Decision` object. This runs AFTER `TransitionEngine.apply()` in the same transaction; it does not conflict with the status update because it targets only the `decisions` key.

---

## File Map

**New files:**

| File | Responsibility |
|---|---|
| `services/workflow-engine/enstellar_workflow/engine/auto_determination.py` | `AutoDeterminator` — calls Digicore, records Decision, applies transition |
| `services/workflow-engine/enstellar_workflow/engine/decision_recorder.py` | `DecisionRecorder.append_decision()` — JSONB update to `case_json.decisions` |
| `services/workflow-engine/enstellar_workflow/consumers/auto_determination_consumer.py` | `AutoDeterminationConsumer` — Kafka consumer for `case.state.transitioned` where `to_state=auto_determination` |
| `services/workflow-engine/tests/test_auto_determination.py` | Unit + Hypothesis property tests for `AutoDeterminator` |
| `services/workflow-engine/tests/test_decision_recorder.py` | Integration tests for `DecisionRecorder` |
| `services/workflow-engine/tests/test_auto_determination_integration.py` | End-to-end integration tests (real PostgreSQL, mock DigiCoreClient) |

**Modified files:**

| File | Change |
|---|---|
| `services/workflow-engine/pyproject.toml` | Add `enstellar-connectors` dep + `hypothesis>=6.100` to dev group |
| `services/workflow-engine/enstellar_workflow/engine/__init__.py` | Re-export `AutoDeterminator` |
| `services/workflow-engine/enstellar_workflow/consumers/__init__.py` | Re-export `AutoDeterminationConsumer` |
| `Makefile` | Update `test` target comment; no functional change needed (already runs `uv run pytest -v` in workflow-engine) |
| `.claude/task-graph.md` | Mark T10 as `[x]` |

---

## Task 1: Add `enstellar-connectors` Dependency + `hypothesis` to `workflow-engine`

**Files:**
- Modify: `services/workflow-engine/pyproject.toml`

- [ ] **Step 1.1: Add `enstellar-connectors` as a runtime dependency and `hypothesis` as a dev dependency**

Edit `services/workflow-engine/pyproject.toml`.

Add `"enstellar-connectors"` to the `dependencies` list:
```toml
dependencies = [
    "asyncpg>=0.29",
    "aiokafka>=0.11",
    "pydantic>=2.9",
    "pydantic-settings>=2.3",
    "alembic>=1.13",
    "sqlalchemy[asyncio]>=2.0",
    "enstellar-events",
    "canonical-model",
    "enstellar-connectors",
    "minio>=7.2",
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
]
```

Add `"hypothesis>=6.100"` to the `dev` dependency group:
```toml
[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "testcontainers[postgres]>=4.7",
    "testcontainers[kafka]>=4.7",
    "testcontainers[minio]>=4.7",
    "psycopg2-binary>=2.9",
    "httpx>=0.27",
    "hypothesis>=6.100",
]
```

Add `enstellar-connectors` to `[tool.uv.sources]`:
```toml
[tool.uv.sources]
enstellar-events = { path = "../../packages/event-contracts", editable = true }
canonical-model = { path = "../../packages/canonical-model", editable = true }
enstellar-connectors = { path = "../integration-connectors", editable = true }
```

- [ ] **Step 1.2: Sync dependencies**

```bash
cd services/workflow-engine
uv sync --dev
```

Expected output ends with:
```
Resolved X packages in Xs
Installed X packages in Xs
```

- [ ] **Step 1.3: Verify the imports resolve**

```bash
cd services/workflow-engine
uv run python -c "
from enstellar_connectors import DigiCoreClient, CircuitOpenError, DecisionRequest
from hypothesis import given, settings
print('enstellar_connectors: ok')
print('hypothesis: ok')
"
```

Expected output:
```
enstellar_connectors: ok
hypothesis: ok
```

- [ ] **Step 1.4: Verify existing tests still pass**

```bash
cd services/workflow-engine
uv run pytest -v --tb=short -q
```

Expected output: all previously passing tests still pass (no regressions).

- [ ] **Step 1.5: Commit**

```bash
cd services/workflow-engine
git add pyproject.toml
git commit -m "feat(workflow-engine): add enstellar-connectors + hypothesis>=6.100 deps for T10"
```

---

## Task 2: Write Failing Hypothesis Property Test (Red State)

**Files:**
- Create: `services/workflow-engine/tests/test_auto_determination.py`

This task writes the tests first so the codebase is in a provably red state before implementation. The test file imports modules that do not yet exist — all tests should fail with `ModuleNotFoundError`.

- [ ] **Step 2.1: Create `tests/test_auto_determination.py` with failing imports**

Create `services/workflow-engine/tests/test_auto_determination.py`:

```python
"""Tests for AutoDeterminator — including the INVARIANT property test.

CRITICAL INVARIANT (NON-NEGOTIABLE):
  AutoDeterminator can only produce Status.approved or Status.clinical_review.
  It must NEVER produce denied, partially_denied, or adverse_modification.
  This is proven by test_auto_determination_never_produces_adverse_outcome,
  a Hypothesis property test that fuzzes all possible Digicore response values
  and all exception types. This test must NEVER be weakened or removed.

Decision path sensitivity: ALL changes to this file require senior engineer review.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import pytest
from hypothesis import given, settings as h_settings
from hypothesis import strategies as st

from canonical_model.case import Case, Status
from canonical_model.decision import Decision, Outcome
from enstellar_connectors import CircuitOpenError, DecisionRequest, DecisionResponse
from enstellar_connectors.digicore.models import StructuredTrace
from enstellar_workflow.engine.auto_determination import AutoDeterminator
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from tests.conftest import make_case


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MOCK_TRACE = StructuredTrace(
    artifact="mock-policy-stub-v1",
    version="1.0.0",
    source="mock-digicore",
    logic_branch="auto-approve-stub",
)


def make_approved_response() -> DecisionResponse:
    return DecisionResponse(
        decision="approved",
        requirements=[],
        structured_trace=MOCK_TRACE,
    )


def make_pending_response() -> DecisionResponse:
    return DecisionResponse(
        decision="pending_review",
        requirements=["clinical-notes"],
        structured_trace=MOCK_TRACE,
    )


def make_denied_response() -> DecisionResponse:
    return DecisionResponse(
        decision="denied",
        requirements=[],
        structured_trace=MOCK_TRACE,
    )


def make_mock_digicore(response: DecisionResponse | Exception) -> AsyncMock:
    """Build a DigiCoreClient mock that returns response or raises it."""
    mock = AsyncMock()
    if isinstance(response, Exception):
        mock.evaluate_request.side_effect = response
    else:
        mock.evaluate_request.return_value = response
    return mock


# ---------------------------------------------------------------------------
# ══════════════════════════════════════════════════════════════════════════
# INVARIANT #1 + #2 PROOF
# ══════════════════════════════════════════════════════════════════════════
# This Hypothesis property test is the machine-checked proof of the
# no-autonomous-adverse-determination invariant for the auto path.
# ---------------------------------------------------------------------------


DIGICORE_DECISIONS: st.SearchStrategy[str] = st.sampled_from(
    ["approved", "pending_review", "denied"]
)

EXCEPTION_TYPES: st.SearchStrategy[Exception] = st.one_of(
    st.just(CircuitOpenError("circuit open")),
    st.just(Exception("unexpected error")),
    st.just(ConnectionError("network failure")),
    st.just(TimeoutError("timeout")),
)

ALL_DIGICORE_OUTCOMES: st.SearchStrategy = st.one_of(
    DIGICORE_DECISIONS.map(
        lambda d: DecisionResponse(
            decision=d,
            requirements=[],
            structured_trace=MOCK_TRACE,
        )
    ),
    EXCEPTION_TYPES,
)


@given(digicore_outcome=ALL_DIGICORE_OUTCOMES)
@h_settings(max_examples=100)
@pytest.mark.asyncio
async def test_auto_determination_never_produces_adverse_outcome(digicore_outcome):
    """INVARIANT #1 + #2: auto-determination can only produce Status.approved or
    Status.clinical_review. It can NEVER produce denied, partially_denied, or
    adverse_modification — regardless of what Digicore returns or what exception
    is raised.

    This test is machine-checked proof of the invariant. 100 examples cover
    all three Digicore decision values (approved/pending_review/denied) plus
    all exception types (CircuitOpenError, ConnectionError, TimeoutError,
    generic Exception).
    """
    # Arrange: mock DigiCoreClient and TransitionEngine
    mock_digicore = make_mock_digicore(digicore_outcome)

    # Track what to_state values are passed to engine.apply()
    applied_states: list[str] = []

    async def mock_engine_apply(conn, req: TransitionRequest) -> Case:
        applied_states.append(req.to_state)
        # Return a minimal updated case
        return make_case().model_copy(
            update={"status": Status(req.to_state), "updated_at": datetime.now(timezone.utc)}
        )

    mock_engine = MagicMock(spec=TransitionEngine)
    mock_engine.apply = AsyncMock(side_effect=mock_engine_apply)

    # Use a MagicMock for conn (no real DB needed for this unit test)
    mock_conn = AsyncMock(spec=asyncpg.Connection)

    determinator = AutoDeterminator(engine=mock_engine, digicore=mock_digicore)
    case = make_case()
    correlation_id = f"corr-hyp-{uuid.uuid4()}"

    # Act
    result_case = await determinator.run(mock_conn, case, correlation_id)

    # ── INVARIANT ASSERTIONS ──────────────────────────────────────────────
    # 1. The result case must NEVER be in an adverse state
    assert result_case.status not in {
        Status.denied,
        Status.partially_denied,
        Status.adverse_modification,
    }, (
        f"INVARIANT VIOLATED: auto-determination produced adverse state "
        f"'{result_case.status}' from Digicore outcome {digicore_outcome!r}"
    )

    # 2. The engine was called exactly once
    assert mock_engine.apply.call_count == 1, (
        f"Expected exactly 1 engine.apply() call; got {mock_engine.apply.call_count}"
    )

    # 3. The to_state passed to engine.apply() must not be adverse
    assert len(applied_states) == 1
    applied_state = applied_states[0]
    assert applied_state not in {
        "denied", "partially_denied", "adverse_modification"
    }, (
        f"INVARIANT VIOLATED: engine.apply() was called with to_state={applied_state!r} "
        f"(an adverse state) for Digicore outcome {digicore_outcome!r}"
    )

    # 4. If result is approved, to_state was 'approved'
    if result_case.status == Status.approved:
        assert applied_state == "approved", (
            f"Result status=approved but applied_state={applied_state!r}"
        )

    # 5. If result is not approved, it must be clinical_review
    else:
        assert result_case.status == Status.clinical_review, (
            f"Non-approved result must be clinical_review; got '{result_case.status}'"
        )
        assert applied_state == "clinical_review", (
            f"Non-approved case must transition to clinical_review; got {applied_state!r}"
        )


# ---------------------------------------------------------------------------
# Unit tests — approved path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_approved_response_transitions_to_approved():
    """When Digicore returns 'approved', the case transitions to Status.approved."""
    mock_digicore = make_mock_digicore(make_approved_response())

    result_case = make_case().model_copy(update={"status": Status.approved})
    mock_engine = MagicMock(spec=TransitionEngine)
    mock_engine.apply = AsyncMock(return_value=result_case)

    determinator = AutoDeterminator(engine=mock_engine, digicore=mock_digicore)
    conn = AsyncMock(spec=asyncpg.Connection)
    case = make_case()

    output = await determinator.run(conn, case, f"corr-{uuid.uuid4()}")

    assert output.status == Status.approved
    req: TransitionRequest = mock_engine.apply.call_args[0][1]
    assert req.to_state == "approved"
    assert req.human_signoff_recorded is False
    assert req.actor_id == "auto-determination"
    assert req.tenant_id == case.tenant_id


@pytest.mark.asyncio
async def test_approved_path_decision_payload_contains_decision():
    """Decision object is embedded in TransitionRequest.payload when approving."""
    mock_digicore = make_mock_digicore(make_approved_response())

    result_case = make_case().model_copy(update={"status": Status.approved})
    mock_engine = MagicMock(spec=TransitionEngine)
    mock_engine.apply = AsyncMock(return_value=result_case)

    determinator = AutoDeterminator(engine=mock_engine, digicore=mock_digicore)
    conn = AsyncMock(spec=asyncpg.Connection)
    case = make_case()

    await determinator.run(conn, case, f"corr-{uuid.uuid4()}")

    req: TransitionRequest = mock_engine.apply.call_args[0][1]
    assert "decision" in req.payload
    decision_data = req.payload["decision"]
    assert decision_data["outcome"] == "approved"
    assert decision_data["auto_approved"] is True
    assert decision_data["human_signoff_required"] is False
    assert decision_data["human_signoff_actor"] is None
    assert decision_data["human_signoff_at"] is None


@pytest.mark.asyncio
async def test_approved_path_decision_trace_pinned_to_digicore_artifact():
    """INVARIANT: Decision.rule_artifact_id and rule_version are pinned to the
    exact artifact + version returned by Digicore in structured_trace."""
    trace = StructuredTrace(
        artifact="policy-v2-2026-q2",
        version="2.1.0",
        source="digicore-prod",
        logic_branch="criteria-branch-A",
    )
    resp = DecisionResponse(
        decision="approved",
        requirements=[],
        structured_trace=trace,
    )
    mock_digicore = make_mock_digicore(resp)

    result_case = make_case().model_copy(update={"status": Status.approved})
    mock_engine = MagicMock(spec=TransitionEngine)
    mock_engine.apply = AsyncMock(return_value=result_case)

    determinator = AutoDeterminator(engine=mock_engine, digicore=mock_digicore)
    conn = AsyncMock(spec=asyncpg.Connection)

    await determinator.run(conn, make_case(), f"corr-{uuid.uuid4()}")

    req: TransitionRequest = mock_engine.apply.call_args[0][1]
    decision_data = req.payload["decision"]
    assert decision_data["rule_artifact_id"] == "policy-v2-2026-q2", (
        "Decision.rule_artifact_id must be pinned to Digicore structured_trace.artifact"
    )
    assert decision_data["rule_version"] == "2.1.0", (
        "Decision.rule_version must be pinned to Digicore structured_trace.version"
    )
    assert decision_data["criteria_branch"] == "criteria-branch-A"


# ---------------------------------------------------------------------------
# Unit tests — non-approved paths → clinical_review
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pending_review_response_routes_to_clinical_review():
    """When Digicore returns 'pending_review', the case routes to clinical_review."""
    mock_digicore = make_mock_digicore(make_pending_response())

    result_case = make_case().model_copy(update={"status": Status.clinical_review})
    mock_engine = MagicMock(spec=TransitionEngine)
    mock_engine.apply = AsyncMock(return_value=result_case)

    determinator = AutoDeterminator(engine=mock_engine, digicore=mock_digicore)
    conn = AsyncMock(spec=asyncpg.Connection)

    output = await determinator.run(conn, make_case(), f"corr-{uuid.uuid4()}")

    assert output.status == Status.clinical_review
    req: TransitionRequest = mock_engine.apply.call_args[0][1]
    assert req.to_state == "clinical_review"
    assert req.human_signoff_recorded is False


@pytest.mark.asyncio
async def test_denied_response_from_digicore_routes_to_clinical_review_not_denied():
    """INVARIANT: When Digicore returns 'denied', the auto path must route to
    clinical_review — NOT to denied. A human reviewer must make the adverse
    determination.

    This is the most critical unit test for the no-autonomous-adverse invariant.
    """
    mock_digicore = make_mock_digicore(make_denied_response())

    result_case = make_case().model_copy(update={"status": Status.clinical_review})
    mock_engine = MagicMock(spec=TransitionEngine)
    mock_engine.apply = AsyncMock(return_value=result_case)

    determinator = AutoDeterminator(engine=mock_engine, digicore=mock_digicore)
    conn = AsyncMock(spec=asyncpg.Connection)

    output = await determinator.run(conn, make_case(), f"corr-{uuid.uuid4()}")

    # Must route to clinical_review, NEVER to denied
    assert output.status == Status.clinical_review
    req: TransitionRequest = mock_engine.apply.call_args[0][1]
    assert req.to_state == "clinical_review", (
        f"INVARIANT VIOLATED: Digicore 'denied' must route to clinical_review, "
        f"not to {req.to_state!r}"
    )
    assert req.to_state != "denied"
    assert req.to_state not in {"denied", "partially_denied", "adverse_modification"}


@pytest.mark.asyncio
async def test_circuit_open_error_routes_to_clinical_review():
    """When the circuit breaker is open, the case must route to clinical_review."""
    mock_digicore = AsyncMock()
    mock_digicore.evaluate_request.side_effect = CircuitOpenError("circuit open")

    result_case = make_case().model_copy(update={"status": Status.clinical_review})
    mock_engine = MagicMock(spec=TransitionEngine)
    mock_engine.apply = AsyncMock(return_value=result_case)

    determinator = AutoDeterminator(engine=mock_engine, digicore=mock_digicore)
    conn = AsyncMock(spec=asyncpg.Connection)

    output = await determinator.run(conn, make_case(), f"corr-{uuid.uuid4()}")

    assert output.status == Status.clinical_review
    req: TransitionRequest = mock_engine.apply.call_args[0][1]
    assert req.to_state == "clinical_review"
    assert req.payload.get("reason") == "digicore_unavailable"


@pytest.mark.asyncio
async def test_unexpected_exception_routes_to_clinical_review():
    """Any unexpected exception from Digicore must route to clinical_review.

    Digicore being unavailable must never block the case — it routes to human review.
    """
    mock_digicore = AsyncMock()
    mock_digicore.evaluate_request.side_effect = ConnectionError("network failure")

    result_case = make_case().model_copy(update={"status": Status.clinical_review})
    mock_engine = MagicMock(spec=TransitionEngine)
    mock_engine.apply = AsyncMock(return_value=result_case)

    determinator = AutoDeterminator(engine=mock_engine, digicore=mock_digicore)
    conn = AsyncMock(spec=asyncpg.Connection)

    output = await determinator.run(conn, make_case(), f"corr-{uuid.uuid4()}")

    assert output.status == Status.clinical_review
    req: TransitionRequest = mock_engine.apply.call_args[0][1]
    assert req.to_state == "clinical_review"


# ---------------------------------------------------------------------------
# Unit tests — tenant_id propagation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tenant_id_propagated_to_digicore_request():
    """INVARIANT #5: tenant_id must appear on the DecisionRequest sent to Digicore."""
    captured_requests: list[DecisionRequest] = []

    async def capture_request(req: DecisionRequest) -> DecisionResponse:
        captured_requests.append(req)
        return make_approved_response()

    mock_digicore = AsyncMock()
    mock_digicore.evaluate_request.side_effect = capture_request

    result_case = make_case(tenant_id="tenant-invariant-5").model_copy(
        update={"status": Status.approved}
    )
    mock_engine = MagicMock(spec=TransitionEngine)
    mock_engine.apply = AsyncMock(return_value=result_case)

    determinator = AutoDeterminator(engine=mock_engine, digicore=mock_digicore)
    conn = AsyncMock(spec=asyncpg.Connection)
    case = make_case(tenant_id="tenant-invariant-5")

    await determinator.run(conn, case, f"corr-{uuid.uuid4()}")

    assert len(captured_requests) == 1
    assert captured_requests[0].tenant_id == "tenant-invariant-5"


@pytest.mark.asyncio
async def test_tenant_id_propagated_to_transition_request():
    """INVARIANT #5: tenant_id must appear on the TransitionRequest sent to engine."""
    mock_digicore = make_mock_digicore(make_approved_response())

    result_case = make_case(tenant_id="tenant-t10-scope").model_copy(
        update={"status": Status.approved}
    )
    mock_engine = MagicMock(spec=TransitionEngine)
    mock_engine.apply = AsyncMock(return_value=result_case)

    determinator = AutoDeterminator(engine=mock_engine, digicore=mock_digicore)
    conn = AsyncMock(spec=asyncpg.Connection)
    case = make_case(tenant_id="tenant-t10-scope")

    await determinator.run(conn, case, f"corr-{uuid.uuid4()}")

    req: TransitionRequest = mock_engine.apply.call_args[0][1]
    assert req.tenant_id == "tenant-t10-scope"
```

- [ ] **Step 2.2: Run tests to confirm they fail (module not found — red state)**

```bash
cd services/workflow-engine
uv run pytest tests/test_auto_determination.py -v --tb=short -q
```

Expected output:
```
ERROR tests/test_auto_determination.py - ModuleNotFoundError: No module named 'enstellar_workflow.engine.auto_determination'
```

- [ ] **Step 2.3: Commit the failing tests**

```bash
cd services/workflow-engine
git add tests/test_auto_determination.py
git commit -m "test(workflow-engine): T10 failing tests — AutoDeterminator invariant property tests (red)"
```

---

## Task 3: Implement `DecisionRecorder` + `AutoDeterminator`

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/engine/decision_recorder.py`
- Create: `services/workflow-engine/enstellar_workflow/engine/auto_determination.py`

- [ ] **Step 3.1: Create `decision_recorder.py`**

Create `services/workflow-engine/enstellar_workflow/engine/decision_recorder.py`:

```python
"""DecisionRecorder — appends a Decision to case_json['decisions'] in workflow_instances.

Uses a targeted JSONB update so it does not overwrite other case_json fields.
Must be called inside the caller's transaction, AFTER TransitionEngine.apply()
has already updated the status field.

INVARIANT #5: tenant_id is required on every call and is used as a WHERE
predicate to prevent cross-tenant writes.
"""
from __future__ import annotations

import json
import uuid

import asyncpg

from canonical_model.decision import Decision


class DecisionRecorder:
    """Appends an immutable Decision record to a case's case_json.decisions array.

    Stateless — instantiate freely.
    """

    async def append_decision(
        self,
        conn: asyncpg.Connection,
        *,
        case_id: uuid.UUID,
        tenant_id: str,
        decision: Decision,
    ) -> None:
        """Append one Decision to the decisions JSONB array in workflow_instances.

        The caller must be inside a transaction. The update is idempotent
        only in the sense that decision_id is a UUID; if called twice with the
        same Decision, the decision will appear twice in the array — callers
        must ensure at-most-once semantics.

        Uses PostgreSQL || operator on JSONB arrays:
            COALESCE(case_json->'decisions', '[]'::jsonb) || '[{decision}]'::jsonb

        Raises ValueError if no row was updated (case_id + tenant_id not found).
        """
        if not tenant_id or not tenant_id.strip():
            raise ValueError("tenant_id must not be blank — invariant #5")

        decision_json = json.dumps([decision.model_dump(mode="json")])

        result = await conn.execute(
            """
            UPDATE workflow_instances
            SET case_json = jsonb_set(
                case_json,
                '{decisions}',
                COALESCE(case_json->'decisions', '[]'::jsonb) || $1::jsonb
            )
            WHERE case_id = $2 AND tenant_id = $3
            """,
            decision_json,
            case_id,
            tenant_id,
        )
        # asyncpg returns "UPDATE N" — check that exactly one row was updated
        rows_updated = int(result.split()[-1])
        if rows_updated == 0:
            raise ValueError(
                f"No workflow_instances row found for case_id={case_id} "
                f"tenant_id={tenant_id!r} — cannot append decision"
            )
```

- [ ] **Step 3.2: Create `auto_determination.py`**

Create `services/workflow-engine/enstellar_workflow/engine/auto_determination.py`:

```python
"""AutoDeterminator — approve-only auto-determination path.

INVARIANT #1 (NON-NEGOTIABLE):
  This class can only produce Status.approved or Status.clinical_review.
  It is structurally impossible for it to produce denied, partially_denied,
  or adverse_modification. See _approve() and _route_to_clinical_review():
  the only two to_state values ever passed to TransitionEngine.apply() are
  "approved" and "clinical_review".

INVARIANT #2 (DETERMINISTIC DECISION PATH):
  No AI/inference call participates here. The only decision source is
  the deterministic Digicore rule engine.

INVARIANT #5:
  tenant_id flows through every DecisionRequest, TransitionRequest, and
  EventEnvelope created here.

Decision path sensitivity: changes to this file require senior engineer review.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

import asyncpg

from canonical_model.case import Case, Status
from canonical_model.decision import Decision, Outcome
from enstellar_connectors import CircuitOpenError
from enstellar_connectors.digicore.client import DigiCoreClient
from enstellar_connectors.digicore.models import DecisionRequest, DecisionResponse
from enstellar_events import Actor, ActorType, EventEnvelope, Topics

from ..outbox.publisher import OutboxPublisher
from .decision_recorder import DecisionRecorder
from .transitions import TransitionEngine, TransitionRequest

logger = logging.getLogger(__name__)

_ACTOR_ID = "auto-determination"
_ACTOR_TYPE = "system"


class AutoDeterminator:
    """Approve-only auto-determination path.

    INVARIANT: The only to_state values ever passed to engine.apply() are
    "approved" and "clinical_review". The class is deliberately structured
    so that there is no code path to an adverse state:

    * _approve()                  → to_state = "approved"
    * _route_to_clinical_review() → to_state = "clinical_review"
    * All Digicore exceptions     → _route_to_clinical_review()

    The adverse-transition guard in guards.py provides a second defense
    layer; it would reject any attempt to pass an adverse to_state.
    """

    def __init__(
        self,
        engine: TransitionEngine,
        digicore: DigiCoreClient,
    ) -> None:
        self._engine = engine
        self._digicore = digicore
        self._decision_recorder = DecisionRecorder()
        self._publisher = OutboxPublisher()

    async def run(
        self,
        conn: asyncpg.Connection,
        case: Case,
        correlation_id: str,
    ) -> Case:
        """Run auto-determination for one case. Returns the updated case.

        Outcome routing (exhaustive — no other branches exist):
          Digicore returns "approved"       → _approve()
          Digicore returns "pending_review" → _route_to_clinical_review(reason="pending_review")
          Digicore returns "denied"         → _route_to_clinical_review(reason="denied")
          CircuitOpenError                  → _route_to_clinical_review(reason="digicore_unavailable")
          Any other exception               → _route_to_clinical_review(reason="digicore_unavailable")

        The caller must be inside a transaction. Both _approve() and
        _route_to_clinical_review() call engine.apply() which writes to
        workflow_instances, workflow_events, and outbox — all within the
        caller's transaction.
        """
        req = DecisionRequest(
            case_id=str(case.case_id),
            service_code=case.service_lines[0].procedure_code,
            member_id=str(case.member.member_id),
            plan_id=case.coverage.plan_id,
            tenant_id=case.tenant_id,
        )

        try:
            resp: DecisionResponse = await self._digicore.evaluate_request(req)
        except Exception as exc:
            # Digicore unavailable or circuit open — route to human review.
            # Never block the case; never raise here.
            logger.warning(
                "digicore_unavailable case_id=%s tenant_id=%s error=%s",
                case.case_id,
                case.tenant_id,
                type(exc).__name__,
            )
            return await self._route_to_clinical_review(
                conn, case, correlation_id, reason="digicore_unavailable"
            )

        if resp.decision == "approved":
            return await self._approve(conn, case, correlation_id, resp)

        # 'pending_review' or 'denied' from Digicore → clinical review.
        # INVARIANT: 'denied' from Digicore does NOT map to Status.denied here.
        # A human reviewer must make any adverse determination.
        logger.info(
            "digicore_non_approved case_id=%s tenant_id=%s decision=%s → clinical_review",
            case.case_id,
            case.tenant_id,
            resp.decision,
        )
        return await self._route_to_clinical_review(
            conn, case, correlation_id, reason=resp.decision
        )

    async def _approve(
        self,
        conn: asyncpg.Connection,
        case: Case,
        correlation_id: str,
        resp: DecisionResponse,
    ) -> Case:
        """Apply an auto-approval: transition to 'approved' + record Decision + emit event."""
        decided_at = datetime.now(timezone.utc)

        decision = Decision(
            decision_id=uuid.uuid4(),
            tenant_id=case.tenant_id,
            case_id=case.case_id,
            outcome=Outcome.approved,
            rule_artifact_id=resp.structured_trace.artifact,
            rule_version=resp.structured_trace.version,
            criteria_branch=resp.structured_trace.logic_branch,
            evidence_refs=[resp.structured_trace.source],
            human_signoff_required=False,
            human_signoff_actor=None,
            human_signoff_at=None,
            auto_approved=True,
            decided_at=decided_at,
        )

        # 1. Transition the case state to 'approved'.
        #    human_signoff_recorded=False is correct: the adverse-transition guard
        #    only blocks transitions to adverse states; 'approved' is not adverse.
        transition_req = TransitionRequest(
            case_id=case.case_id,
            tenant_id=case.tenant_id,
            to_state=Status.approved,
            actor_id=_ACTOR_ID,
            actor_type=_ACTOR_TYPE,
            correlation_id=correlation_id,
            payload={"decision": decision.model_dump(mode="json")},
            human_signoff_recorded=False,
        )
        updated_case = await self._engine.apply(conn, transition_req)

        # 2. Append the Decision to case_json.decisions (same transaction).
        await self._decision_recorder.append_decision(
            conn,
            case_id=case.case_id,
            tenant_id=case.tenant_id,
            decision=decision,
        )

        # 3. Emit decision.recorded event to the outbox (same transaction).
        event = EventEnvelope(
            event_id=uuid.uuid4(),
            tenant_id=case.tenant_id,
            case_id=case.case_id,
            correlation_id=correlation_id,
            type=Topics.DECISION_RECORDED,
            occurred_at=decided_at,
            actor=Actor(id=_ACTOR_ID, type=ActorType.SYSTEM),
            payload={
                "decision_id": str(decision.decision_id),
                "outcome": decision.outcome.value,
                "auto_approved": True,
                "rule_artifact_id": decision.rule_artifact_id,
                "rule_version": decision.rule_version,
            },
            schema_version="1.0.0",
        )
        await self._publisher.publish(conn, event)

        logger.info(
            "auto_approved case_id=%s tenant_id=%s decision_id=%s artifact=%s version=%s",
            case.case_id,
            case.tenant_id,
            decision.decision_id,
            decision.rule_artifact_id,
            decision.rule_version,
        )

        # Return the updated case with the decision appended in-memory
        return updated_case.model_copy(
            update={
                "decisions": (updated_case.decisions or []) + [decision]
            }
        )

    async def _route_to_clinical_review(
        self,
        conn: asyncpg.Connection,
        case: Case,
        correlation_id: str,
        reason: str,
    ) -> Case:
        """Transition the case to 'clinical_review' for human review.

        This path is taken for:
        - Digicore 'pending_review' response
        - Digicore 'denied' response (INVARIANT: human must make adverse determination)
        - Digicore circuit open or any exception

        No Decision is recorded on this path (a Decision is only recorded on
        the auto-approval path). The human reviewer will record the decision.
        """
        transition_req = TransitionRequest(
            case_id=case.case_id,
            tenant_id=case.tenant_id,
            to_state=Status.clinical_review,
            actor_id=_ACTOR_ID,
            actor_type=_ACTOR_TYPE,
            correlation_id=f"{correlation_id}-to-clinical",
            payload={"reason": reason},
            human_signoff_recorded=False,
        )
        updated_case = await self._engine.apply(conn, transition_req)

        logger.info(
            "routed_to_clinical_review case_id=%s tenant_id=%s reason=%s",
            case.case_id,
            case.tenant_id,
            reason,
        )
        return updated_case
```

- [ ] **Step 3.3: Update `engine/__init__.py` to export `AutoDeterminator` and `DecisionRecorder`**

Edit `services/workflow-engine/enstellar_workflow/engine/__init__.py` (add to existing exports):

```python
"""Workflow engine: guard evaluation, transition application, event recording."""
from .auto_determination import AutoDeterminator
from .decision_recorder import DecisionRecorder
from .guards import ADVERSE_STATES, GuardError, GuardResult, adverse_transition_guard
from .recorder import EventRecorder
from .transitions import TransitionEngine, TransitionRequest

__all__ = [
    "ADVERSE_STATES",
    "AutoDeterminator",
    "DecisionRecorder",
    "GuardError",
    "GuardResult",
    "adverse_transition_guard",
    "EventRecorder",
    "TransitionEngine",
    "TransitionRequest",
]
```

- [ ] **Step 3.4: Commit the implementation**

```bash
cd services/workflow-engine
git add \
  enstellar_workflow/engine/decision_recorder.py \
  enstellar_workflow/engine/auto_determination.py \
  enstellar_workflow/engine/__init__.py
git commit -m "feat(workflow-engine): AutoDeterminator + DecisionRecorder — approve-only auto path"
```

---

## Task 4: Run Property Tests — 100 Examples, All Pass

- [ ] **Step 4.1: Run the property tests and confirm all pass**

```bash
cd services/workflow-engine
uv run pytest tests/test_auto_determination.py -v --hypothesis-seed=0
```

Expected output:
```
tests/test_auto_determination.py::test_auto_determination_never_produces_adverse_outcome PASSED
    (with 100 examples)
tests/test_auto_determination.py::test_approved_response_transitions_to_approved PASSED
tests/test_auto_determination.py::test_approved_path_decision_payload_contains_decision PASSED
tests/test_auto_determination.py::test_approved_path_decision_trace_pinned_to_digicore_artifact PASSED
tests/test_auto_determination.py::test_pending_review_response_routes_to_clinical_review PASSED
tests/test_auto_determination.py::test_denied_response_from_digicore_routes_to_clinical_review_not_denied PASSED
tests/test_auto_determination.py::test_circuit_open_error_routes_to_clinical_review PASSED
tests/test_auto_determination.py::test_unexpected_exception_routes_to_clinical_review PASSED
tests/test_auto_determination.py::test_tenant_id_propagated_to_digicore_request PASSED
tests/test_auto_determination.py::test_tenant_id_propagated_to_transition_request PASSED

============ 10 passed in X.Xs ============
```

If any test fails, do NOT weaken the test. Debug the `AutoDeterminator` implementation until all tests pass.

- [ ] **Step 4.2: Confirm the invariant test runs 100 examples (not fewer)**

```bash
cd services/workflow-engine
uv run pytest tests/test_auto_determination.py::test_auto_determination_never_produces_adverse_outcome -v -s
```

Expected output includes:
```
Trying example: ...
...
(100 examples total)
```

The Hypothesis output should show 100 examples tried and 0 failures.

- [ ] **Step 4.3: Confirm all previously passing tests still pass**

```bash
cd services/workflow-engine
uv run pytest -v --tb=short -q
```

Expected: all tests from T08 + T10 tests pass. Zero failures.

- [ ] **Step 4.4: Commit**

```bash
cd services/workflow-engine
git add tests/test_auto_determination.py
git commit -m "test(workflow-engine): T10 AutoDeterminator tests — 100-example Hypothesis invariant proof (green)"
```

---

## Task 5: `DecisionRecorder` Integration Tests + Trace Integrity Tests

**Files:**
- Create: `services/workflow-engine/tests/test_decision_recorder.py`
- Create: `services/workflow-engine/tests/test_auto_determination_integration.py`

- [ ] **Step 5.1: Write failing `test_decision_recorder.py`**

Create `services/workflow-engine/tests/test_decision_recorder.py`:

```python
"""Integration tests for DecisionRecorder — requires PostgreSQL (Testcontainers).

Verifies that append_decision() correctly updates case_json['decisions'] in
workflow_instances using the targeted JSONB update.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest

from canonical_model.decision import Decision, Outcome
from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.decision_recorder import DecisionRecorder
from tests.conftest import make_case


def make_decision(case_id: uuid.UUID, tenant_id: str) -> Decision:
    return Decision(
        decision_id=uuid.uuid4(),
        tenant_id=tenant_id,
        case_id=case_id,
        outcome=Outcome.approved,
        rule_artifact_id="policy-stub-v1",
        rule_version="1.0.0",
        criteria_branch="auto-approve",
        evidence_refs=["mock-digicore"],
        human_signoff_required=False,
        human_signoff_actor=None,
        human_signoff_at=None,
        auto_approved=True,
        decided_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_append_decision_adds_decision_to_case_json(pg_pool: asyncpg.Pool):
    """append_decision() must add the Decision to case_json['decisions']."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    decision = make_decision(created.case_id, created.tenant_id)
    recorder = DecisionRecorder()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.append_decision(
                conn,
                case_id=created.case_id,
                tenant_id=created.tenant_id,
                decision=decision,
            )

    # Read back the case_json and verify decisions array
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)

    assert fetched is not None
    assert fetched.decisions is not None
    assert len(fetched.decisions) == 1
    assert fetched.decisions[0].decision_id == decision.decision_id
    assert fetched.decisions[0].outcome == Outcome.approved
    assert fetched.decisions[0].auto_approved is True
    assert fetched.decisions[0].human_signoff_required is False


@pytest.mark.asyncio
async def test_append_decision_preserves_other_case_fields(pg_pool: asyncpg.Pool):
    """append_decision() must not overwrite other fields in case_json."""
    service = CaseService(pg_pool)
    case = make_case(tenant_id="tenant-preserve")
    created = await service.create_case(case)

    decision = make_decision(created.case_id, created.tenant_id)
    recorder = DecisionRecorder()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.append_decision(
                conn,
                case_id=created.case_id,
                tenant_id=created.tenant_id,
                decision=decision,
            )

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)

    assert fetched.tenant_id == "tenant-preserve"
    assert fetched.lob == created.lob
    assert fetched.member.first_name == created.member.first_name
    assert len(fetched.service_lines) == len(created.service_lines)


@pytest.mark.asyncio
async def test_append_decision_tenant_isolation(pg_pool: asyncpg.Pool):
    """append_decision() must not update a row for a different tenant_id."""
    service = CaseService(pg_pool)
    case = make_case(tenant_id="tenant-real")
    created = await service.create_case(case)

    decision = make_decision(created.case_id, "tenant-real")
    recorder = DecisionRecorder()

    # Try to append using wrong tenant_id — must raise ValueError
    with pytest.raises(ValueError, match="No workflow_instances row found"):
        async with pg_pool.acquire() as conn:
            async with conn.transaction():
                await recorder.append_decision(
                    conn,
                    case_id=created.case_id,
                    tenant_id="tenant-wrong",  # wrong tenant
                    decision=decision,
                )

    # Verify no decisions were written
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, "tenant-real")

    assert fetched is not None
    assert (fetched.decisions or []) == []


@pytest.mark.asyncio
async def test_append_multiple_decisions_accumulates(pg_pool: asyncpg.Pool):
    """Multiple calls to append_decision() accumulate decisions in order."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    recorder = DecisionRecorder()
    decision1 = make_decision(created.case_id, created.tenant_id)
    decision2 = make_decision(created.case_id, created.tenant_id)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.append_decision(
                conn,
                case_id=created.case_id,
                tenant_id=created.tenant_id,
                decision=decision1,
            )
        async with conn.transaction():
            await recorder.append_decision(
                conn,
                case_id=created.case_id,
                tenant_id=created.tenant_id,
                decision=decision2,
            )

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)

    assert len(fetched.decisions) == 2
    ids = [d.decision_id for d in fetched.decisions]
    assert decision1.decision_id in ids
    assert decision2.decision_id in ids


@pytest.mark.asyncio
async def test_append_decision_blank_tenant_id_raises_value_error(pg_pool: asyncpg.Pool):
    """INVARIANT #5: blank tenant_id raises ValueError before any SQL."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    recorder = DecisionRecorder()
    decision = make_decision(created.case_id, created.tenant_id)

    with pytest.raises(ValueError, match="tenant_id must not be blank"):
        async with pg_pool.acquire() as conn:
            async with conn.transaction():
                await recorder.append_decision(
                    conn,
                    case_id=created.case_id,
                    tenant_id="",  # blank
                    decision=decision,
                )
```

- [ ] **Step 5.2: Write failing `test_auto_determination_integration.py`**

Create `services/workflow-engine/tests/test_auto_determination_integration.py`:

```python
"""End-to-end integration tests for AutoDeterminator — requires PostgreSQL (Testcontainers).

Uses a mocked DigiCoreClient (AsyncMock) but a real PostgreSQL pool via Testcontainers.
Verifies that the full approve path (engine.apply + DecisionRecorder + outbox event)
executes correctly in a real transaction.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import asyncpg
import pytest

from canonical_model.case import Case, Status
from canonical_model.decision import Outcome
from enstellar_connectors.digicore.client import DigiCoreClient
from enstellar_connectors.digicore.models import DecisionResponse, StructuredTrace
from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.auto_determination import AutoDeterminator
from enstellar_workflow.engine.transitions import TransitionEngine
from tests.conftest import make_case


MOCK_TRACE = StructuredTrace(
    artifact="policy-stub-v1",
    version="1.0.0",
    source="mock-digicore",
    logic_branch="auto-approve-stub",
)


def make_mock_digicore(decision: str = "approved") -> AsyncMock:
    mock = AsyncMock(spec=DigiCoreClient)
    mock.evaluate_request.return_value = DecisionResponse(
        decision=decision,
        requirements=[],
        structured_trace=MOCK_TRACE,
    )
    return mock


# ---------------------------------------------------------------------------
# Approved path — full integration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_integration_approved_path_transitions_case_status(pg_pool: asyncpg.Pool):
    """Full integration: approved Digicore response transitions case to Status.approved."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    determinator = AutoDeterminator(
        engine=engine,
        digicore=make_mock_digicore("approved"),
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            updated = await determinator.run(conn, created, f"corr-{uuid.uuid4()}")

    assert updated.status == Status.approved


@pytest.mark.asyncio
async def test_integration_approved_path_appends_decision_to_case_json(pg_pool: asyncpg.Pool):
    """Full integration: Decision is appended to case_json.decisions in workflow_instances."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    determinator = AutoDeterminator(
        engine=engine,
        digicore=make_mock_digicore("approved"),
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await determinator.run(conn, created, f"corr-{uuid.uuid4()}")

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)

    assert fetched is not None
    assert len(fetched.decisions) == 1
    dec = fetched.decisions[0]
    assert dec.outcome == Outcome.approved
    assert dec.auto_approved is True
    assert dec.human_signoff_required is False
    assert dec.human_signoff_actor is None
    assert dec.human_signoff_at is None


# ---------------------------------------------------------------------------
# Trace integrity — INVARIANT: artifact + version pinned from Digicore response
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_integration_decision_trace_pinned_to_digicore_artifact_version(pg_pool: asyncpg.Pool):
    """INVARIANT: Decision.rule_artifact_id and rule_version are pinned to the exact
    Digicore structured_trace values returned at decision time.

    This test verifies the trace cannot drift from what Digicore reported.
    """
    specific_trace = StructuredTrace(
        artifact="clinical-criteria-v3-2026",
        version="3.2.1",
        source="digicore-prod",
        logic_branch="criteria-branch-lumbar-fusion",
    )
    mock_digicore = AsyncMock(spec=DigiCoreClient)
    mock_digicore.evaluate_request.return_value = DecisionResponse(
        decision="approved",
        requirements=[],
        structured_trace=specific_trace,
    )

    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    determinator = AutoDeterminator(engine=engine, digicore=mock_digicore)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await determinator.run(conn, created, f"corr-{uuid.uuid4()}")

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)

    assert fetched.decisions is not None
    assert len(fetched.decisions) == 1
    dec = fetched.decisions[0]
    assert dec.rule_artifact_id == "clinical-criteria-v3-2026", (
        "Decision.rule_artifact_id must be pinned to the Digicore response artifact"
    )
    assert dec.rule_version == "3.2.1", (
        "Decision.rule_version must be pinned to the Digicore response version"
    )
    assert dec.criteria_branch == "criteria-branch-lumbar-fusion"


@pytest.mark.asyncio
async def test_integration_approved_path_emits_decision_recorded_outbox_event(pg_pool: asyncpg.Pool):
    """Full integration: a decision.recorded outbox event is emitted on auto-approval."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    determinator = AutoDeterminator(
        engine=engine,
        digicore=make_mock_digicore("approved"),
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await determinator.run(conn, created, f"corr-{uuid.uuid4()}")

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT type, tenant_id, payload FROM outbox "
            "WHERE case_id = $1 AND type = 'decision.recorded'",
            created.case_id,
        )

    assert row is not None, "Expected a decision.recorded outbox event"
    assert row["type"] == "decision.recorded"
    assert row["tenant_id"] == created.tenant_id

    import json as _json
    payload = _json.loads(row["payload"]) if isinstance(row["payload"], str) else row["payload"]
    assert payload["outcome"] == "approved"
    assert payload["auto_approved"] is True


# ---------------------------------------------------------------------------
# Non-approved paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_integration_pending_review_transitions_to_clinical_review(pg_pool: asyncpg.Pool):
    """'pending_review' from Digicore must transition the case to clinical_review."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    determinator = AutoDeterminator(
        engine=engine,
        digicore=make_mock_digicore("pending_review"),
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            updated = await determinator.run(conn, created, f"corr-{uuid.uuid4()}")

    assert updated.status == Status.clinical_review


@pytest.mark.asyncio
async def test_integration_denied_from_digicore_transitions_to_clinical_review_not_denied(pg_pool: asyncpg.Pool):
    """INVARIANT: 'denied' from Digicore must NOT produce Status.denied.
    The case must go to clinical_review for a human reviewer to make the determination.

    This is the integration-level proof of the no-autonomous-adverse invariant.
    """
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    determinator = AutoDeterminator(
        engine=engine,
        digicore=make_mock_digicore("denied"),
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            updated = await determinator.run(conn, created, f"corr-{uuid.uuid4()}")

    # The case MUST be in clinical_review, NEVER in denied
    assert updated.status == Status.clinical_review, (
        f"INVARIANT VIOLATED: Digicore 'denied' produced Status.{updated.status}; "
        f"expected Status.clinical_review"
    )
    assert updated.status != Status.denied

    # Confirm in the DB
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)
    assert fetched.status == Status.clinical_review

    # Confirm no Decision was recorded (no auto-decision on non-approved path)
    assert (fetched.decisions or []) == []


@pytest.mark.asyncio
async def test_integration_denied_path_does_not_write_decision(pg_pool: asyncpg.Pool):
    """When routing to clinical_review, no Decision must be appended to case_json."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    determinator = AutoDeterminator(
        engine=engine,
        digicore=make_mock_digicore("denied"),
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await determinator.run(conn, created, f"corr-{uuid.uuid4()}")

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)

    assert (fetched.decisions or []) == [], (
        "No Decision must be auto-recorded when routing to clinical_review"
    )


@pytest.mark.asyncio
async def test_integration_circuit_open_routes_to_clinical_review_not_denied(pg_pool: asyncpg.Pool):
    """CircuitOpenError must route to clinical_review — never block or produce adverse state."""
    from enstellar_connectors import CircuitOpenError

    mock_digicore = AsyncMock(spec=DigiCoreClient)
    mock_digicore.evaluate_request.side_effect = CircuitOpenError("open")

    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    determinator = AutoDeterminator(engine=engine, digicore=mock_digicore)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            updated = await determinator.run(conn, created, f"corr-{uuid.uuid4()}")

    assert updated.status == Status.clinical_review


@pytest.mark.asyncio
async def test_integration_all_writes_rollback_on_engine_failure(pg_pool: asyncpg.Pool):
    """If engine.apply() raises, the transaction rolls back and no partial writes persist."""
    from enstellar_workflow.engine.guards import GuardError

    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    # Force the engine to fail by trying to transition to an adverse state without sign-off
    # (We test this indirectly by using a bad to_state — this won't happen in practice
    # because AutoDeterminator never sends adverse to_states, but this verifies rollback.)
    #
    # Instead, test rollback by having the mock digicore return approved but the engine
    # fail mid-transaction with a generic error.
    mock_digicore = AsyncMock(spec=DigiCoreClient)
    mock_digicore.evaluate_request.return_value = DecisionResponse(
        decision="approved",
        requirements=[],
        structured_trace=MOCK_TRACE,
    )

    failing_engine = AsyncMock(spec=TransitionEngine)
    failing_engine.apply.side_effect = RuntimeError("simulated DB failure mid-transaction")

    determinator = AutoDeterminator(engine=failing_engine, digicore=mock_digicore)

    with pytest.raises(RuntimeError, match="simulated DB failure"):
        async with pg_pool.acquire() as conn:
            async with conn.transaction():
                await determinator.run(conn, created, f"corr-{uuid.uuid4()}")

    # After rollback, case must still be in its original status (intake)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)

    assert fetched.status == Status.intake
    assert (fetched.decisions or []) == []
```

- [ ] **Step 5.3: Run tests to confirm they fail with `ModuleNotFoundError` initially (implementation already done in Task 3, so they should be failing for DB-related reasons — `workflow_instances` missing)**

```bash
cd services/workflow-engine
uv run pytest tests/test_decision_recorder.py tests/test_auto_determination_integration.py -v --tb=short
```

If the T08 migration (0002) is not yet applied, the tests will fail with:
```
asyncpg.exceptions.UndefinedTableError: relation "workflow_instances" does not exist
```

This is expected if T08 is not yet complete. The migration must be applied before T10 tests can pass. If T08 is done, these tests should pass directly.

- [ ] **Step 5.4: Run all T10 tests**

```bash
cd services/workflow-engine
uv run pytest tests/test_auto_determination.py tests/test_decision_recorder.py tests/test_auto_determination_integration.py -v
```

Expected output:
```
tests/test_auto_determination.py::test_auto_determination_never_produces_adverse_outcome PASSED
tests/test_auto_determination.py::test_approved_response_transitions_to_approved PASSED
tests/test_auto_determination.py::test_approved_path_decision_payload_contains_decision PASSED
tests/test_auto_determination.py::test_approved_path_decision_trace_pinned_to_digicore_artifact PASSED
tests/test_auto_determination.py::test_pending_review_response_routes_to_clinical_review PASSED
tests/test_auto_determination.py::test_denied_response_from_digicore_routes_to_clinical_review_not_denied PASSED
tests/test_auto_determination.py::test_circuit_open_error_routes_to_clinical_review PASSED
tests/test_auto_determination.py::test_unexpected_exception_routes_to_clinical_review PASSED
tests/test_auto_determination.py::test_tenant_id_propagated_to_digicore_request PASSED
tests/test_auto_determination.py::test_tenant_id_propagated_to_transition_request PASSED
tests/test_decision_recorder.py::test_append_decision_adds_decision_to_case_json PASSED
tests/test_decision_recorder.py::test_append_decision_preserves_other_case_fields PASSED
tests/test_decision_recorder.py::test_append_decision_tenant_isolation PASSED
tests/test_decision_recorder.py::test_append_multiple_decisions_accumulates PASSED
tests/test_decision_recorder.py::test_append_decision_blank_tenant_id_raises_value_error PASSED
tests/test_auto_determination_integration.py::test_integration_approved_path_transitions_case_status PASSED
tests/test_auto_determination_integration.py::test_integration_approved_path_appends_decision_to_case_json PASSED
tests/test_auto_determination_integration.py::test_integration_decision_trace_pinned_to_digicore_artifact_version PASSED
tests/test_auto_determination_integration.py::test_integration_approved_path_emits_decision_recorded_outbox_event PASSED
tests/test_auto_determination_integration.py::test_integration_pending_review_transitions_to_clinical_review PASSED
tests/test_auto_determination_integration.py::test_integration_denied_from_digicore_transitions_to_clinical_review_not_denied PASSED
tests/test_auto_determination_integration.py::test_integration_denied_path_does_not_write_decision PASSED
tests/test_auto_determination_integration.py::test_integration_circuit_open_routes_to_clinical_review_not_denied PASSED
tests/test_auto_determination_integration.py::test_integration_all_writes_rollback_on_engine_failure PASSED

============ 24 passed in X.Xs ============
```

- [ ] **Step 5.5: Commit**

```bash
cd services/workflow-engine
git add \
  tests/test_decision_recorder.py \
  tests/test_auto_determination_integration.py
git commit -m "test(workflow-engine): T10 DecisionRecorder + AutoDeterminator integration tests — trace integrity + no-adverse proofs"
```

---

## Task 6: `AutoDeterminationConsumer` + Wire into State Machine + Makefile + Mark Done

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/consumers/auto_determination_consumer.py`
- Modify: `services/workflow-engine/enstellar_workflow/consumers/__init__.py`
- Modify: `services/workflow-engine/enstellar_workflow/main.py` (wire consumer into lifespan)
- Modify: `.claude/task-graph.md`

- [ ] **Step 6.1: Create `AutoDeterminationConsumer`**

Create `services/workflow-engine/enstellar_workflow/consumers/auto_determination_consumer.py`:

```python
"""AutoDeterminationConsumer — Kafka consumer for the auto-determination state.

Consumes `case.state.transitioned` events where to_state = "auto_determination"
and runs AutoDeterminator.run() for each qualifying case.

INVARIANT: Only cases in auto_determination status are processed. Any case
already in a different status (race condition) is silently skipped.

Decision path sensitivity: changes to this file require senior engineer review.
"""
from __future__ import annotations

import logging

import asyncpg

from canonical_model.case import Case, Status
from enstellar_connectors.digicore.client import DigiCoreClient
from enstellar_events import EventEnvelope, Topics

from ..cases.repository import CaseRepository
from ..engine.auto_determination import AutoDeterminator
from ..engine.transitions import TransitionEngine
from ..kafka.consumer import IdempotentKafkaConsumer

logger = logging.getLogger(__name__)


class AutoDeterminationConsumer(IdempotentKafkaConsumer):
    """Consumes case.state.transitioned events and drives the auto-determination path.

    Only processes events where payload['to_state'] == 'auto_determination'.
    Skips events for other transitions silently (they are still committed to
    avoid reprocessing).
    """

    def __init__(
        self,
        pool: asyncpg.Pool,
        digicore: DigiCoreClient,
    ) -> None:
        super().__init__(
            pool=pool,
            topics=[Topics.CASE_STATE_TRANSITIONED],
            group_id="auto-determination-worker",
        )
        self._repo = CaseRepository()
        self._engine = TransitionEngine()
        self._determinator = AutoDeterminator(
            engine=self._engine,
            digicore=digicore,
        )

    async def handle(self, event: EventEnvelope) -> None:
        """Process a case.state.transitioned event.

        Only acts when to_state == 'auto_determination'. All other transitions
        are silently ignored.

        Acquires a connection from the pool and runs AutoDeterminator.run()
        in a single transaction: guard check → workflow_events row → status update
        → decision append (if approved) → outbox events.
        """
        payload = event.payload
        to_state = payload.get("to_state")

        if to_state != "auto_determination":
            # Not our transition — skip silently
            return

        case_id = event.case_id
        tenant_id = event.tenant_id

        if case_id is None:
            logger.warning(
                "auto_determination_consumer received event with no case_id event_id=%s",
                event.event_id,
            )
            return

        logger.info(
            "auto_determination_consumer processing case_id=%s tenant_id=%s",
            case_id,
            tenant_id,
        )

        async with self._pool.acquire() as conn:
            # Fetch the current case inside the transaction so we have a consistent snapshot
            case = await self._repo.fetch_by_id(conn, case_id, tenant_id)

        if case is None:
            logger.error(
                "auto_determination_consumer case not found case_id=%s tenant_id=%s",
                case_id,
                tenant_id,
            )
            return

        if case.status != Status.auto_determination:
            logger.warning(
                "auto_determination_consumer skipping case not in auto_determination "
                "case_id=%s actual_status=%s",
                case_id,
                case.status,
            )
            return

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                updated = await self._determinator.run(
                    conn,
                    case,
                    event.correlation_id,
                )

        logger.info(
            "auto_determination_consumer completed case_id=%s tenant_id=%s new_status=%s",
            case_id,
            tenant_id,
            updated.status,
        )
```

- [ ] **Step 6.2: Update `consumers/__init__.py`**

If `services/workflow-engine/enstellar_workflow/consumers/__init__.py` does not exist, create it. Otherwise, add the new export:

```python
"""Kafka consumers for the workflow engine."""
from .auto_determination_consumer import AutoDeterminationConsumer

__all__ = ["AutoDeterminationConsumer"]
```

If `IntakeConsumer` already exists in `consumers/`, include it:

```python
"""Kafka consumers for the workflow engine."""
from .auto_determination_consumer import AutoDeterminationConsumer
from .intake_consumer import IntakeConsumer

__all__ = ["AutoDeterminationConsumer", "IntakeConsumer"]
```

- [ ] **Step 6.3: Wire `AutoDeterminationConsumer` into `main.py` lifespan**

Edit `services/workflow-engine/enstellar_workflow/main.py`. Add the consumer to the FastAPI lifespan so it starts with the app:

Find the existing lifespan section (or create one if absent) and add:

```python
# In the lifespan context manager, after pool initialization:
from enstellar_connectors.digicore.client import DigiCoreClient as _DigiCoreClient
from .consumers.auto_determination_consumer import AutoDeterminationConsumer as _AutoDetConsumer
import asyncio as _asyncio

# Start the AutoDeterminationConsumer background task
_digicore = _DigiCoreClient()
_auto_det_consumer = _AutoDetConsumer(pool=app.state.pool, digicore=_digicore)
_auto_det_task = _asyncio.create_task(_auto_det_consumer.run())
```

And in the shutdown section:
```python
await _auto_det_consumer.stop()
_auto_det_task.cancel()
```

Note: If `main.py` does not yet have a lifespan (it may just have startup/shutdown events), use the existing pattern. If there is no pool in `app.state`, initialize it in the lifespan and pass it to the consumer. The exact wiring depends on how T08 completed `main.py`; follow the existing pattern rather than replacing it.

- [ ] **Step 6.4: Run the full test suite (all services)**

```bash
cd services/workflow-engine
uv run pytest -v --tb=short -q
```

Expected: all tests pass including the new T10 tests.

```bash
make test
```

Expected: exits 0.

- [ ] **Step 6.5: Mark T10 done in the task graph**

Edit `.claude/task-graph.md`. Change:
```
| T10 auto-determination (approve-only) + trace | Py | T09 | **sensitive (decision path)** | `[ ]` |
```
to:
```
| T10 auto-determination (approve-only) + trace | Py | T09 | **sensitive (decision path)** | `[x]` |
```

- [ ] **Step 6.6: Final commit**

```bash
cd services/workflow-engine
git add \
  enstellar_workflow/consumers/auto_determination_consumer.py \
  enstellar_workflow/consumers/__init__.py \
  enstellar_workflow/main.py

git add .claude/task-graph.md
git commit -m "feat(workflow-engine): AutoDeterminationConsumer + wire into main.py lifespan; mark T10 done"
```

---

## Verification Checklist

Before marking the PR ready for review:

- [ ] `cd services/workflow-engine && uv run pytest tests/test_auto_determination.py -v --hypothesis-seed=0` — 10 tests pass including 100-example Hypothesis proof
- [ ] `cd services/workflow-engine && uv run pytest tests/test_decision_recorder.py -v` — 5 tests pass
- [ ] `cd services/workflow-engine && uv run pytest tests/test_auto_determination_integration.py -v` — 9 tests pass
- [ ] `make test` — exits 0 (full suite including connectors)
- [ ] **INVARIANT CHECK:** `test_auto_determination_never_produces_adverse_outcome` ran 100 examples with 0 failures
- [ ] **INVARIANT CHECK:** `test_denied_response_from_digicore_routes_to_clinical_review_not_denied` passes — proves Digicore `denied` → `clinical_review`, never `denied`
- [ ] **INVARIANT CHECK:** `test_integration_denied_from_digicore_transitions_to_clinical_review_not_denied` passes — DB-level proof
- [ ] `Decision.rule_artifact_id` and `rule_version` are pinned to Digicore `structured_trace` — proved by `test_integration_decision_trace_pinned_to_digicore_artifact_version`
- [ ] `Decision.auto_approved = True` and `human_signoff_required = False` on the auto path — proved by `test_integration_approved_path_appends_decision_to_case_json`
- [ ] `decision.recorded` outbox event emitted on approval — proved by `test_integration_approved_path_emits_decision_recorded_outbox_event`
- [ ] All writes roll back atomically on engine failure — proved by `test_integration_all_writes_rollback_on_engine_failure`
- [ ] `tenant_id` flows through to `DecisionRequest` and `TransitionRequest` — proved by `test_tenant_id_propagated_to_digicore_request` and `test_tenant_id_propagated_to_transition_request`
- [ ] T10 marked `[x]` in `.claude/task-graph.md`
- [ ] **Mandatory senior engineer review** requested (decision path change — see CLAUDE.md)
