"""P3 — auto-close wiring: cleanly-final cases auto-transition to `closed`.

auto_close_if_resolved is hooked at the three transition sites:
  * AutoDeterminator._approve   (approved → closed/approved)
  * AppealService.decide_appeal (appeal_overturned → closed/appeal_overturned;
                                 appeal_upheld is a no-op)
  * CaseService.transition      (a manual `denied` is NOT auto-closed)

Every assertion RE-FETCHES the row from workflow_instances — closure is a DB
side effect; the returned snapshot still reflects the determination outcome.
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import asyncpg
import pytest

from canonical_model.case import Status
from enstellar_connectors.digicore.client import DigiCoreClient
from enstellar_connectors.digicore.models import DecisionResponse, StructuredTrace
from enstellar_workflow.appeals.service import AppealService
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.auto_determination import AutoDeterminator
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from tests.conftest import make_case


def _approved_response() -> DecisionResponse:
    return DecisionResponse(
        decision="approved",
        requirements=[],
        structured_trace=StructuredTrace(
            artifact="policy-v2", version="2.1.0",
            source="digicore-rules", logic_branch="auto-approve-standard",
        ),
    )


async def _seed_appeal_templates(pool: asyncpg.Pool, tenant_id: str) -> None:
    async with pool.acquire() as conn:
        for event_type in ("appeal_filed", "appeal_overturned", "appeal_upheld"):
            await conn.execute(
                "INSERT INTO notification_templates "
                "(tenant_id, event_type, channel, subject_template, body_template) "
                "VALUES ($1, $2, 'portal', 'Appeal update', "
                "'Appeal for case {{ case_id }} at level {{ level }}')",
                tenant_id, event_type,
            )


async def _drive_to(pool: asyncpg.Pool, created, to_state: str) -> None:
    engine = TransitionEngine()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await engine.apply(conn, TransitionRequest(
                case_id=created.case_id,
                tenant_id=created.tenant_id,
                to_state=to_state,
                actor_id="reviewer-001",
                actor_type="user",
                correlation_id=str(uuid.uuid4()),
                human_signoff_recorded=True,
            ))


async def _setup_appeal_review(pool: asyncpg.Pool, tenant_id: str):
    """Denied case → file_appeal → appeal_review + under_review appeal."""
    created = await CaseService(pool).create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pool, created, "denied")
    result = await AppealService(pool).file_appeal(
        case_id=created.case_id, tenant_id=tenant_id,
        filed_by="member-7", reason="Disagree with the denial",
    )
    return created, result["appeal_id"]


@pytest.mark.asyncio
async def test_auto_approved_case_auto_closes(pg_pool: asyncpg.Pool):
    """approved → closed/approved; CaseClosed emitted; DECISION_RECORDED retained."""
    tenant_id = f"tenant-autoclose-{uuid.uuid4()}"
    case = await CaseService(pg_pool).create_case(
        make_case(tenant_id=tenant_id, status=Status.auto_determination)
    )

    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.return_value = _approved_response()
    auto = AutoDeterminator(engine=TransitionEngine(), digicore=digicore)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            result = await auto.run(conn, case, f"corr-{uuid.uuid4()}")

    # The returned snapshot still reflects the determination outcome (approved).
    assert result.status == Status.approved

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, disposition FROM workflow_instances "
            "WHERE case_id=$1 AND tenant_id=$2",
            case.case_id, tenant_id,
        )
        assert row["status"] == "closed"
        assert row["disposition"] == "approved"

        closed = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' = 'sim.case.lifecycle/CaseClosed/v1'",
            str(case.case_id),
        )
        assert closed == 1

        # closure did NOT suppress the approval DECISION_RECORDED event.
        decision_recorded = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' LIKE '%DecisionRecorded%'",
            str(case.case_id),
        )
        assert decision_recorded == 1


@pytest.mark.asyncio
async def test_overturned_appeal_auto_closes(pg_pool: asyncpg.Pool):
    """appeal_overturned → closed/appeal_overturned; CaseClosed emitted."""
    tenant_id = f"tenant-autoclose-{uuid.uuid4()}"
    await _seed_appeal_templates(pg_pool, tenant_id)
    created, appeal_id = await _setup_appeal_review(pg_pool, tenant_id)
    svc = AppealService(pg_pool)
    await svc.assign_reviewer(
        case_id=created.case_id, tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id), reviewer_id="rev-1", assigned_by="coord",
    )

    result = await svc.decide_appeal(
        case_id=created.case_id, tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id), outcome="overturned",
        reviewer_actor="rev-1", reason="Medical necessity established",
        human_signoff_recorded=False,
    )
    # The returned dict still reflects the appeal decision (side effect only).
    assert result["status"] == "appeal_overturned"

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, disposition FROM workflow_instances "
            "WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert row["status"] == "closed"
        assert row["disposition"] == "appeal_overturned"

        closed = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' = 'sim.case.lifecycle/CaseClosed/v1'",
            str(created.case_id),
        )
        assert closed == 1


@pytest.mark.asyncio
async def test_upheld_appeal_does_not_auto_close(pg_pool: asyncpg.Pool):
    """appeal_upheld stays appeal_upheld (NOT closed) — next-level appeal still works."""
    tenant_id = f"tenant-autoclose-{uuid.uuid4()}"
    await _seed_appeal_templates(pg_pool, tenant_id)
    created, appeal_id = await _setup_appeal_review(pg_pool, tenant_id)
    svc = AppealService(pg_pool)
    await svc.assign_reviewer(
        case_id=created.case_id, tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id), reviewer_id="rev-1", assigned_by="coord",
    )

    result = await svc.decide_appeal(
        case_id=created.case_id, tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id), outcome="upheld",
        reviewer_actor="rev-1", reason="Continued adverse — upheld",
        human_signoff_recorded=True,
    )
    assert result["status"] == "appeal_upheld"

    async with pg_pool.acquire() as conn:
        status = await conn.fetchval(
            "SELECT status FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert status == "appeal_upheld"  # NOT closed — appeal rights preserved

        closed = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' = 'sim.case.lifecycle/CaseClosed/v1'",
            str(created.case_id),
        )
        assert closed == 0

    # The appeal_upheld status still admits a next-level appeal.
    l2 = await svc.file_appeal(
        case_id=created.case_id, tenant_id=tenant_id,
        filed_by="member-7", reason="Escalate to independent review",
    )
    assert l2["level"] == 2
    assert l2["status"] == "appeal_review"


@pytest.mark.asyncio
async def test_denied_determination_does_not_auto_close(pg_pool: asyncpg.Pool):
    """A manual `denied` is an adverse determination — it stays open for appeal."""
    tenant_id = f"tenant-autoclose-{uuid.uuid4()}"
    created = await CaseService(pg_pool).create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pg_pool, created, "clinical_review")

    result = await CaseService(pg_pool).transition(TransitionRequest(
        case_id=created.case_id,
        tenant_id=tenant_id,
        to_state="denied",
        actor_id="reviewer-001",
        actor_type="user",
        correlation_id=str(uuid.uuid4()),
        human_signoff_recorded=True,
    ))
    assert result.status == Status.denied

    async with pg_pool.acquire() as conn:
        status = await conn.fetchval(
            "SELECT status FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert status == "denied"  # NOT auto-closed

        closed = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' = 'sim.case.lifecycle/CaseClosed/v1'",
            str(created.case_id),
        )
        assert closed == 0
