"""Tests for adverse transition structured payload emission."""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from simintero_outbox import SchemaRef
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
        actor_type="user",
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

    conn = AsyncMock()
    await engine.apply(conn, req)

    # CASE_STATE_CHANGED + ADVERSE_STRUCTURED + DECISION_RECORDED (every
    # determination now also emits the regulatory-notice trigger).
    assert engine._publisher.publish.call_count == 3
    schema_refs = [c.args[1].schema_ref for c in engine._publisher.publish.call_args_list]
    assert SchemaRef.CASE_STATE_CHANGED in schema_refs
    assert SchemaRef.ADVERSE_STRUCTURED in schema_refs
    assert SchemaRef.DECISION_RECORDED in schema_refs
    # Verify both publish calls used the same connection (same transaction)
    for call in engine._publisher.publish.call_args_list:
        assert call.args[0] is conn


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
    structured_call = next(c for c in calls if c.args[1].schema_ref == SchemaRef.ADVERSE_STRUCTURED)
    ev = structured_call.args[1]
    assert ev.payload["determination_type"] == "partially_denied"
    assert ev.payload["reason_codes"] == ["M54.5", "M51.16"]
    assert ev.payload["citations"] == ["Policy §4.2.1"]
    assert ev.payload["finding_sections"][0]["criterion_id"] == "C-02"
    assert ev.tenant.tenant_id == "t1"


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
    assert any(c.args[1].schema_ref == SchemaRef.ADVERSE_STRUCTURED for c in calls)
    structured_call = next(c for c in calls if c.args[1].schema_ref == SchemaRef.ADVERSE_STRUCTURED)
    ev = structured_call.args[1]
    # determination_type defaults to to_state when not in payload
    assert ev.payload["determination_type"] == "denied"
    assert ev.payload["finding_sections"] is None
    assert ev.payload["reason_codes"] is None
    assert ev.payload["citations"] is None


@pytest.mark.asyncio
async def test_non_adverse_transition_does_not_emit_structured_event():
    """Approved transition emits CASE_STATE_CHANGED + DECISION_RECORDED but NO
    ADVERSE_STRUCTURED (approval is a determination, but not an adverse one)."""
    engine = _make_engine()
    req = _make_req(to_state="approved", payload={"reason": "All criteria met"})

    await engine.apply(AsyncMock(), req)

    schema_refs = [c.args[1].schema_ref for c in engine._publisher.publish.call_args_list]
    assert SchemaRef.CASE_STATE_CHANGED in schema_refs
    assert SchemaRef.DECISION_RECORDED in schema_refs
    assert SchemaRef.ADVERSE_STRUCTURED not in schema_refs
