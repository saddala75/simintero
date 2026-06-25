"""Integration tests for AutoDeterminator — requires PostgreSQL (Testcontainers).

Verifies the full approve path and all routing decisions against a real DB,
including DB-level proof that 'denied' from Digicore cannot produce Status.denied
in the case (INVARIANT #1).
"""
from __future__ import annotations

import json
import uuid
from unittest.mock import AsyncMock, patch

import asyncpg
import pytest

from canonical_model.case import Status
from canonical_model.decision import Outcome
from enstellar_connectors import CircuitOpenError
from enstellar_connectors.digicore.client import DigiCoreClient
from enstellar_connectors.digicore.models import DecisionResponse, StructuredTrace
from simintero_outbox import SchemaRef
from enstellar_workflow.cases.repository import CaseRepository
from simintero_tenant_context import tenant_transaction
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.auto_determination import AutoDeterminator
from enstellar_workflow.engine.transitions import TransitionEngine
from tests.conftest import make_case

_ARTIFACT = "policy-v2"
_VERSION = "2.1.0"
_SOURCE = "digicore-rules"
_BRANCH = "auto-approve-standard"


def _approved_response() -> DecisionResponse:
    return DecisionResponse(
        decision="approved",
        requirements=[],
        structured_trace=StructuredTrace(
            artifact=_ARTIFACT,
            version=_VERSION,
            source=_SOURCE,
            logic_branch=_BRANCH,
        ),
    )


def _make_auto(digicore: DigiCoreClient) -> AutoDeterminator:
    return AutoDeterminator(engine=TransitionEngine(), digicore=digicore)


async def _create_auto_determination_case(
    pool: asyncpg.Pool,
    tenant_id: str = "tenant-t10",
) -> object:
    """Create a case in auto_determination state — the entry state for AutoDeterminator."""
    service = CaseService(pool)
    case = make_case(tenant_id=tenant_id, status=Status.auto_determination)
    return await service.create_case(case)


# ---------------------------------------------------------------------------
# Full approve path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_approve_path_transitions_case_to_approved(pg_pool: asyncpg.Pool):
    """Full approve path: DB status must become 'approved'."""
    case = await _create_auto_determination_case(pg_pool)

    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.return_value = _approved_response()
    auto = _make_auto(digicore)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            result = await auto.run(conn, case, f"corr-{uuid.uuid4()}")

    # The returned snapshot reflects the determination outcome (approved); the
    # case is then auto-closed (cleanly-final) as a DB side effect.
    assert result.status == Status.approved

    # DB-level proof: approved is auto-closed, with the disposition preserved.
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)
        disposition = await conn.fetchval(
            "SELECT disposition FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id, case.tenant_id,
        )
    assert fetched.status == Status.closed
    assert disposition == "approved"


@pytest.mark.asyncio
async def test_approve_path_appends_decision_to_case_json(pg_pool: asyncpg.Pool):
    """Full approve path: case_json.decisions must contain exactly one Decision."""
    case = await _create_auto_determination_case(pg_pool)

    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.return_value = _approved_response()
    auto = _make_auto(digicore)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await auto.run(conn, case, f"corr-{uuid.uuid4()}")

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)

    assert fetched.decisions is not None
    assert len(fetched.decisions) == 1
    decision = fetched.decisions[0]
    assert decision.outcome == Outcome.approved
    assert decision.auto_approved is True
    assert decision.human_signoff_required is False


@pytest.mark.asyncio
async def test_approve_path_pins_trace_to_digicore_artifact(pg_pool: asyncpg.Pool):
    """Decision must carry the artifact/version/branch from Digicore's structured_trace."""
    case = await _create_auto_determination_case(pg_pool)

    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.return_value = _approved_response()
    auto = _make_auto(digicore)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await auto.run(conn, case, f"corr-{uuid.uuid4()}")

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)

    d = fetched.decisions[0]
    assert d.rule_artifact_id == _ARTIFACT
    assert d.rule_version == _VERSION
    assert d.criteria_branch == _BRANCH
    assert _SOURCE in d.evidence_refs


@pytest.mark.asyncio
async def test_approve_path_emits_decision_recorded_outbox_event(pg_pool: asyncpg.Pool):
    """Full approve path: a 'decision.recorded' outbox row must be written."""
    case = await _create_auto_determination_case(pg_pool)

    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.return_value = _approved_response()
    auto = _make_auto(digicore)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await auto.run(conn, case, f"corr-{uuid.uuid4()}")

    async with tenant_transaction(pg_pool, case.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT envelope FROM shared.outbox"
            " WHERE envelope->'payload'->>'case_id' = $1"
            "   AND envelope->>'schema_ref' = $2",
            str(case.case_id),
            SchemaRef.DECISION_RECORDED,
        )

    assert row is not None
    envelope = row["envelope"]
    if isinstance(envelope, str):
        envelope = json.loads(envelope)
    payload = envelope["payload"]
    assert payload["outcome"] == "approved"
    assert payload["auto_approved"] is True
    assert payload["rule_artifact_id"] == _ARTIFACT
    assert payload["rule_version"] == _VERSION


# ---------------------------------------------------------------------------
# Routing paths that produce clinical_review
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pending_review_routes_to_clinical_review(pg_pool: asyncpg.Pool):
    """Digicore 'pending_review' response must route to clinical_review."""
    case = await _create_auto_determination_case(pg_pool)

    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.return_value = DecisionResponse(
        decision="pending_review",
        requirements=["additional_documentation"],
        structured_trace=StructuredTrace(
            artifact="policy-v2", version="2.1.0",
            source="digicore-rules", logic_branch="pend",
        ),
    )
    auto = _make_auto(digicore)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            result = await auto.run(conn, case, f"corr-{uuid.uuid4()}")

    assert result.status == Status.clinical_review

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)
    assert fetched.status == Status.clinical_review


@pytest.mark.asyncio
async def test_denied_routes_to_clinical_review_not_denied(pg_pool: asyncpg.Pool):
    """INVARIANT #1: Digicore 'denied' must route to clinical_review, NOT to denied.

    DB-level proof: the workflow_instances.status column must be 'clinical_review'
    after a Digicore 'denied' response — never 'denied'.
    """
    case = await _create_auto_determination_case(pg_pool)

    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.return_value = DecisionResponse(
        decision="denied",
        requirements=[],
        structured_trace=StructuredTrace(
            artifact="policy-v2", version="2.1.0",
            source="digicore-rules", logic_branch="deny",
        ),
    )
    auto = _make_auto(digicore)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            result = await auto.run(conn, case, f"corr-{uuid.uuid4()}")

    # Must be clinical_review — NOT denied
    assert result.status == Status.clinical_review
    assert result.status != Status.denied

    # DB-level proof — read the workflow_instances row directly
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status FROM workflow_instances WHERE case_id = $1 AND tenant_id = $2",
            case.case_id,
            case.tenant_id,
        )
    assert row["status"] == "clinical_review"
    assert row["status"] != "denied"


@pytest.mark.asyncio
async def test_denied_path_does_not_write_decision(pg_pool: asyncpg.Pool):
    """Digicore 'denied' → clinical_review: no Decision must be written.

    Only an auto-approval writes a Decision. Adverse routing must leave it to
    a human reviewer to record the decision.
    """
    case = await _create_auto_determination_case(pg_pool)

    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.return_value = DecisionResponse(
        decision="denied",
        requirements=[],
        structured_trace=StructuredTrace(
            artifact="policy-v2", version="2.1.0",
            source="digicore-rules", logic_branch="deny",
        ),
    )
    auto = _make_auto(digicore)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await auto.run(conn, case, f"corr-{uuid.uuid4()}")

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)

    assert (fetched.decisions or []) == []


@pytest.mark.asyncio
async def test_circuit_open_routes_to_clinical_review(pg_pool: asyncpg.Pool):
    """CircuitOpenError must be caught and route to clinical_review (never block a case)."""
    case = await _create_auto_determination_case(pg_pool)

    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.side_effect = CircuitOpenError("circuit open")
    auto = _make_auto(digicore)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            result = await auto.run(conn, case, f"corr-{uuid.uuid4()}")

    assert result.status == Status.clinical_review

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)
    assert fetched.status == Status.clinical_review


# ---------------------------------------------------------------------------
# Rollback on engine failure
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rollback_on_engine_failure(pg_pool: asyncpg.Pool):
    """If engine.apply() raises, the entire transaction must roll back.

    No partial state (status change, workflow_event, outbox row) must be
    visible in the DB after the exception.
    """
    case = await _create_auto_determination_case(pg_pool)

    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.return_value = _approved_response()

    engine = TransitionEngine()
    auto = AutoDeterminator(engine=engine, digicore=digicore)

    with patch.object(engine, "apply", new_callable=AsyncMock, side_effect=RuntimeError("db blew up")):
        with pytest.raises(RuntimeError, match="db blew up"):
            async with pg_pool.acquire() as conn:
                async with conn.transaction():
                    await auto.run(conn, case, f"corr-{uuid.uuid4()}")

    # Case must still be in auto_determination — transaction rolled back
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)
    assert fetched.status == Status.auto_determination
    assert (fetched.decisions or []) == []

    # No workflow_events for this case (the one written by create_case is CASE_INTAKE_RECEIVED,
    # which writes no workflow_events row — only outbox). The failed transition must leave
    # no workflow_events row with to_state in ('approved', 'clinical_review').
    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM workflow_events "
            "WHERE case_id = $1 AND to_state IN ('approved', 'clinical_review')",
            case.case_id,
        )
    assert count == 0
