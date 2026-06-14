"""Tests for ClinicalReviewConsumer.

Invariants verified:
  #2  No LLM on the decision path — consumer writes advisory rows only.
  #3  PHI-minimum: member name, DOB, MRN must NOT appear in case_summary.
  #4  tenant_id on every row and log line.
  #5  abstained=True → no rows written (only AGENT_ASSIST_FAILED event).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import pytest

from canonical_model import Case, Status
from enstellar_events import Actor, ActorType, EventEnvelope, SchemaRef

from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.consumers.clinical_review_consumer import (
    ClinicalReviewConsumer,
    _build_agent_input,
)
from tests.conftest import make_case


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_clinical_review_event(case: Case) -> EventEnvelope:
    """Build a CASE_STATE_TRANSITIONED event with to_state=clinical_review."""
    return EventEnvelope(
        event_id=uuid.uuid4(),
        tenant_id=case.tenant_id,
        case_id=case.case_id,
        correlation_id=case.correlation_id,
        schema_ref=SchemaRef.CASE_STATE_CHANGED,
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="system", type=ActorType.SYSTEM),
        payload={"from_state": "auto_determination", "to_state": "clinical_review"},
    )


def _make_completeness_output(case: Case, abstained: bool = False) -> dict:
    """Build a realistic completeness AgentOutput dict."""
    if abstained:
        return {
            "agent_id": "completeness-v1",
            "tenant_id": case.tenant_id,
            "case_id": str(case.case_id),
            "confidence": 0.0,
            "citations": [],
            "abstained": True,
            "abstention_reason": "low confidence",
            "result": None,
            "provenance": {
                "model_name": "test-model",
                "timestamp": "2024-01-01T00:00:00+00:00",
            },
        }
    return {
        "agent_id": "completeness-v1",
        "tenant_id": case.tenant_id,
        "case_id": str(case.case_id),
        "confidence": 0.8,
        "citations": ["Da Vinci PA IG 4.0.0 §3.2"],
        "abstained": False,
        "abstention_reason": None,
        "result": {
            "gaps": [
                {
                    "description": "Missing operative report",
                    "required_document_type": "operative_report",
                    "citation": "Da Vinci PA IG 4.0.0 §3.2",
                }
            ],
            "rfi_draft": {
                "subject": "Missing documentation",
                "body": "Please provide the following documents.",
                "required_documents": ["operative_report"],
                "due_date_days": 14,
            },
            "confidence": 0.8,
            "citations": ["Da Vinci PA IG 4.0.0 §3.2"],
        },
        "provenance": {
            "model_name": "test-model",
            "input_hash": "abc123",
            "timestamp": "2024-01-01T00:00:00+00:00",
        },
    }


def _make_triage_output(case: Case, abstained: bool = False) -> dict:
    """Build a realistic triage AgentOutput dict."""
    if abstained:
        return {
            "agent_id": "triage-v1",
            "tenant_id": case.tenant_id,
            "case_id": str(case.case_id),
            "confidence": 0.0,
            "citations": [],
            "abstained": True,
            "abstention_reason": "low confidence",
            "result": None,
            "provenance": {
                "model_name": "test-model",
                "timestamp": "2024-01-01T00:00:00+00:00",
            },
        }
    return {
        "agent_id": "triage-v1",
        "tenant_id": case.tenant_id,
        "case_id": str(case.case_id),
        "confidence": 0.85,
        "citations": ["urgency: standard", "procedure: 99213"],
        "abstained": False,
        "abstention_reason": None,
        "result": {
            "suggested_queue": "standard",
            "rationale": "Routine procedure code 99213 with standard urgency.",
            "confidence": 0.85,
            "citations": ["urgency: standard"],
        },
        "provenance": {
            "model_name": "test-model",
            "input_hash": "def456",
            "timestamp": "2024-01-01T00:00:00+00:00",
        },
    }


def _make_http_mock(completeness_data: dict, triage_data: dict):
    """Build a mock httpx.AsyncClient that returns different responses per URL."""

    def _side_effect(url: str, **kwargs):
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        if "completeness" in url:
            mock_resp.json.return_value = completeness_data
        else:
            mock_resp.json.return_value = triage_data
        return mock_resp

    mock_client = AsyncMock()
    mock_client.post.side_effect = _side_effect
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


# ---------------------------------------------------------------------------
# Unit test — PHI invariant
# ---------------------------------------------------------------------------

def test_phi_not_in_agent_input():
    """INVARIANT #3: member name, DOB, MRN must not appear in case_summary.

    This is a unit test — no DB required.
    """
    case = make_case()
    agent_input = _build_agent_input(case, case.correlation_id)

    summary_str = json.dumps(agent_input["case_summary"])

    # PHI fields must be absent
    assert case.member.first_name not in summary_str, (
        f"first_name {case.member.first_name!r} leaked into case_summary"
    )
    assert case.member.last_name not in summary_str, (
        f"last_name {case.member.last_name!r} leaked into case_summary"
    )
    assert str(case.member.date_of_birth) not in summary_str, (
        f"date_of_birth {case.member.date_of_birth} leaked into case_summary"
    )
    if case.member.mrn is not None:
        assert case.member.mrn not in summary_str, (
            f"mrn {case.member.mrn!r} leaked into case_summary"
        )

    # Expected safe fields must be present
    assert "procedure_codes" in agent_input["case_summary"]
    assert "99213" in agent_input["case_summary"]["procedure_codes"]
    assert "urgency" in agent_input["case_summary"]
    assert "lob" in agent_input["case_summary"]

    # tenant_id and case_id are required for routing — present at top level
    assert agent_input["tenant_id"] == case.tenant_id
    assert agent_input["case_id"] == str(case.case_id)


# ---------------------------------------------------------------------------
# Integration tests — require pg_pool
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_non_clinical_review_transition_is_ignored(pg_pool: asyncpg.Pool):
    """Events with to_state != 'clinical_review' must be ignored without DB writes."""
    consumer = ClinicalReviewConsumer(pg_pool)
    case = make_case()

    # Seed the case so a DB hit would be possible if the guard fails
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    event = EventEnvelope(
        event_id=uuid.uuid4(),
        tenant_id=case.tenant_id,
        case_id=case.case_id,
        correlation_id=case.correlation_id,
        schema_ref=SchemaRef.CASE_STATE_CHANGED,
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="system", type=ActorType.SYSTEM),
        payload={"from_state": "intake", "to_state": "md_review"},
    )

    # Should return immediately — no HTTP calls, no DB writes
    await consumer.handle(event)

    # Verify no criteria rows were written for this case
    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM case_criteria WHERE case_id = $1 AND tenant_id = $2",
            case.case_id,
            case.tenant_id,
        )
    assert count == 0


@pytest.mark.asyncio
async def test_criteria_written_on_completeness_success(pg_pool: asyncpg.Pool, monkeypatch):
    """On success: one criteria gap row and one suggestion row must be written."""
    case = make_case(status=Status.clinical_review)

    # Seed the case in workflow_instances
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    completeness_data = _make_completeness_output(case, abstained=False)
    triage_data = _make_triage_output(case, abstained=False)
    mock_client = _make_http_mock(completeness_data, triage_data)

    monkeypatch.setenv("WORKFLOW_AGENT_LAYER_URL", "http://agent-layer:8000")
    import enstellar_workflow.config as cfg_mod
    cfg_mod._settings = None

    consumer = ClinicalReviewConsumer(pg_pool)
    event = _make_clinical_review_event(case)

    with patch(
        "enstellar_workflow.consumers.clinical_review_consumer.httpx.AsyncClient",
        return_value=mock_client,
    ):
        await consumer.handle(event)

    # Criteria row must exist
    async with pg_pool.acquire() as conn:
        criteria_count = await conn.fetchval(
            "SELECT COUNT(*) FROM case_criteria WHERE case_id = $1 AND tenant_id = $2",
            case.case_id,
            case.tenant_id,
        )
        criteria_row = await conn.fetchrow(
            "SELECT criterion_id, text, status FROM case_criteria "
            "WHERE case_id = $1 AND tenant_id = $2",
            case.case_id,
            case.tenant_id,
        )
        # Suggestion row must exist
        suggestion_count = await conn.fetchval(
            "SELECT COUNT(*) FROM case_suggestions WHERE case_id = $1 AND tenant_id = $2",
            case.case_id,
            case.tenant_id,
        )

    assert criteria_count == 1, f"Expected 1 criteria row, got {criteria_count}"
    assert criteria_row["criterion_id"] == "operative_report"
    assert criteria_row["status"] == "gap"
    assert suggestion_count == 1, f"Expected 1 suggestion row, got {suggestion_count}"


@pytest.mark.asyncio
async def test_no_rows_written_when_abstained(pg_pool: asyncpg.Pool, monkeypatch):
    """INVARIANT #5: abstained=True → zero criteria and suggestion rows written."""
    case = make_case(status=Status.clinical_review)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    completeness_data = _make_completeness_output(case, abstained=True)
    triage_data = _make_triage_output(case, abstained=True)
    mock_client = _make_http_mock(completeness_data, triage_data)

    monkeypatch.setenv("WORKFLOW_AGENT_LAYER_URL", "http://agent-layer:8000")
    import enstellar_workflow.config as cfg_mod
    cfg_mod._settings = None

    consumer = ClinicalReviewConsumer(pg_pool)
    event = _make_clinical_review_event(case)

    with patch(
        "enstellar_workflow.consumers.clinical_review_consumer.httpx.AsyncClient",
        return_value=mock_client,
    ):
        await consumer.handle(event)

    async with pg_pool.acquire() as conn:
        criteria_count = await conn.fetchval(
            "SELECT COUNT(*) FROM case_criteria WHERE case_id = $1 AND tenant_id = $2",
            case.case_id,
            case.tenant_id,
        )
        suggestion_count = await conn.fetchval(
            "SELECT COUNT(*) FROM case_suggestions WHERE case_id = $1 AND tenant_id = $2",
            case.case_id,
            case.tenant_id,
        )

    assert criteria_count == 0, (
        f"INVARIANT #5 violated: {criteria_count} criteria rows written despite abstention"
    )
    assert suggestion_count == 0, (
        f"INVARIANT #5 violated: {suggestion_count} suggestion rows written despite abstention"
    )


@pytest.mark.asyncio
async def test_no_rows_written_on_http_error(pg_pool: asyncpg.Pool, monkeypatch):
    """HTTP error from agent-layer must not crash the consumer and must not write rows."""
    case = make_case(status=Status.clinical_review)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    # Both agents return HTTP errors
    def _raise(url: str, **kwargs):
        raise httpx.ConnectError("connection refused")

    mock_client = AsyncMock()
    mock_client.post.side_effect = _raise
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    monkeypatch.setenv("WORKFLOW_AGENT_LAYER_URL", "http://agent-layer:8000")
    import enstellar_workflow.config as cfg_mod
    cfg_mod._settings = None

    consumer = ClinicalReviewConsumer(pg_pool)
    event = _make_clinical_review_event(case)

    import httpx as _httpx  # noqa: PLC0415 — needed for patch target

    with patch(
        "enstellar_workflow.consumers.clinical_review_consumer.httpx.AsyncClient",
        return_value=mock_client,
    ):
        # Must NOT raise — errors are logged and swallowed
        await consumer.handle(event)

    async with pg_pool.acquire() as conn:
        criteria_count = await conn.fetchval(
            "SELECT COUNT(*) FROM case_criteria WHERE case_id = $1 AND tenant_id = $2",
            case.case_id,
            case.tenant_id,
        )
    assert criteria_count == 0

    async with pg_pool.acquire() as conn:
        count_suggestions = await conn.fetchval(
            "SELECT COUNT(*) FROM case_suggestions WHERE case_id = $1", case.case_id
        )
    assert count_suggestions == 0


@pytest.mark.asyncio
async def test_tenant_isolation(pg_pool: asyncpg.Pool, monkeypatch):
    """Criteria rows must carry the tenant_id from the case, not a cross-tenant value."""
    tenant_a = "tenant-A-cr"
    case = make_case(tenant_id=tenant_a, status=Status.clinical_review)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    completeness_data = _make_completeness_output(case, abstained=False)
    triage_data = _make_triage_output(case, abstained=False)
    mock_client = _make_http_mock(completeness_data, triage_data)

    monkeypatch.setenv("WORKFLOW_AGENT_LAYER_URL", "http://agent-layer:8000")
    import enstellar_workflow.config as cfg_mod
    cfg_mod._settings = None

    consumer = ClinicalReviewConsumer(pg_pool)
    event = _make_clinical_review_event(case)

    with patch(
        "enstellar_workflow.consumers.clinical_review_consumer.httpx.AsyncClient",
        return_value=mock_client,
    ):
        await consumer.handle(event)

    # Query with tenant-B must see nothing
    async with pg_pool.acquire() as conn:
        cross_tenant_count = await conn.fetchval(
            "SELECT COUNT(*) FROM case_criteria WHERE case_id = $1 AND tenant_id = $2",
            case.case_id,
            "tenant-B-cr",
        )
        correct_tenant_count = await conn.fetchval(
            "SELECT COUNT(*) FROM case_criteria WHERE case_id = $1 AND tenant_id = $2",
            case.case_id,
            tenant_a,
        )

    assert cross_tenant_count == 0, "Criteria row visible under wrong tenant — invariant #4"
    assert correct_tenant_count == 1


# Import httpx at module level so the patch target below resolves correctly.
import httpx  # noqa: E402, F401
