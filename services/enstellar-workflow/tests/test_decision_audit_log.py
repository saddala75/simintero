"""Tests for Clinical Decision Audit Log (Slice 2A).

Verifies that every determination writes a row to ens.decision_audit_log in the
same transaction, capturing decided_by (JWT sub), decided_at, outcome, rule_ids,
ai_advisory_used, evidence_refs, and rationale.
"""
from __future__ import annotations

import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_decision_audit_log_written_on_determination():
    """record_decision or transition to determination state must write to ens.decision_audit_log."""
    from enstellar_workflow.cases.service import CaseService

    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value=None)
    mock_conn.fetchval = AsyncMock(return_value=0)

    # Context manager setup for tenant_transaction
    mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    service = CaseService(mock_pool)

    case_id = uuid.uuid4()
    tenant_id = "tenant-dev"
    actor_id = "reviewer-sub-123"

    await service.record_decision_audit(
        conn=mock_conn,
        tenant_id=tenant_id,
        case_id=case_id,
        decided_by=actor_id,
        outcome="denied",
        rule_ids=["RULE-001"],
        ai_advisory_used=True,
        evidence_refs=["fabric:resource/123"],
        rationale="Not medically necessary",
    )

    mock_conn.execute.assert_called_once()
    call_args = mock_conn.execute.call_args
    sql = call_args[0][0]
    assert "ens.decision_audit_log" in sql or "decision_audit_log" in sql
    assert call_args[0][1] == tenant_id
    assert call_args[0][2] == case_id
    assert call_args[0][3] == actor_id
    assert call_args[0][4] == "denied"


@pytest.mark.asyncio
async def test_transition_engine_writes_audit_log_on_determination():
    """TransitionEngine.apply must execute insert into ens.decision_audit_log on determination."""
    from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
    from canonical_model import Case, Status, Urgency
    from datetime import datetime, timezone

    engine = TransitionEngine()

    case_id = uuid.uuid4()
    tenant_id = "tenant-dev"
    actor_id = "reviewer-sub-456"

    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock()

    # Construct mock case via model_construct to bypass schema field requirements
    dummy_case = Case.model_construct(
        case_id=case_id,
        tenant_id=tenant_id,
        correlation_id="corr-123",
        lob="commercial",
        program="prior_auth",
        status=Status("clinical_review"),
        urgency=Urgency("standard"),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    with patch("enstellar_workflow.engine.transitions.CaseRepository.fetch_by_id", AsyncMock(return_value=dummy_case)), \
         patch("enstellar_workflow.engine.transitions.EventRecorder.record", AsyncMock(return_value=uuid.uuid4())), \
         patch("enstellar_workflow.engine.transitions.CaseRepository.update_status", AsyncMock(return_value=dummy_case.model_copy(update={"status": Status("approved")}))), \
         patch("enstellar_workflow.engine.transitions.OutboxPublisher.publish", AsyncMock()):

        req = TransitionRequest(
            case_id=case_id,
            tenant_id=tenant_id,
            to_state="approved",
            actor_id=actor_id,
            actor_type="user",
            correlation_id="corr-123",
            payload={"reason": "Criteria met", "rule_ids": ["RULE-A"]},
        )

        await engine.apply(mock_conn, req)

    # Check that execute was called with decision_audit_log insert
    executed_sqls = [call[0][0] for call in mock_conn.execute.call_args_list]
    assert any("ens.decision_audit_log" in s for s in executed_sqls)
