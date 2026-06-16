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
    source="digicore-runtime",
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

    async def mock_engine_apply(conn, req: TransitionRequest) -> tuple[Case, uuid.UUID]:
        applied_states.append(req.to_state)
        # Return a minimal updated case + a dummy event_id
        return (
            make_case().model_copy(
                update={"status": Status(req.to_state), "updated_at": datetime.now(timezone.utc)}
            ),
            uuid.uuid4(),
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
    mock_engine.apply = AsyncMock(return_value=(result_case, uuid.uuid4()))

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
    mock_engine.apply = AsyncMock(return_value=(result_case, uuid.uuid4()))

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
    mock_engine.apply = AsyncMock(return_value=(result_case, uuid.uuid4()))

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
    mock_engine.apply = AsyncMock(return_value=(result_case, uuid.uuid4()))

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
    mock_engine.apply = AsyncMock(return_value=(result_case, uuid.uuid4()))

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
    mock_engine.apply = AsyncMock(return_value=(result_case, uuid.uuid4()))

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
    mock_engine.apply = AsyncMock(return_value=(result_case, uuid.uuid4()))

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
    mock_engine.apply = AsyncMock(return_value=(result_case, uuid.uuid4()))

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
    mock_engine.apply = AsyncMock(return_value=(result_case, uuid.uuid4()))

    determinator = AutoDeterminator(engine=mock_engine, digicore=mock_digicore)
    conn = AsyncMock(spec=asyncpg.Connection)
    case = make_case(tenant_id="tenant-t10-scope")

    await determinator.run(conn, case, f"corr-{uuid.uuid4()}")

    req: TransitionRequest = mock_engine.apply.call_args[0][1]
    assert req.tenant_id == "tenant-t10-scope"
