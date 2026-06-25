"""Task 4 — AppealService.decide_appeal (overturn / uphold, uphold sign-off-gated).

Deciding an under_review appeal on an appeal_review case:
  * overturn → case appeal_overturned, appeals row overturned (+reviewer_actor,
    decided_at), the appeal clock STOPPED, an AppealDecided outbox event, an
    appeal_overturned notice (notification_log row).
  * uphold WITH human_signoff_recorded=True → case appeal_upheld, row upheld.
  * uphold WITHOUT sign-off → a guard error; NO transition (case still
    appeal_review, appeal row still under_review).
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest

from enstellar_workflow.appeals.service import AppealService
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.guards import GuardError
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from tests.conftest import make_case


async def _seed_template(pool: asyncpg.Pool, tenant_id: str, event_type: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, $2, 'portal', "
            "'Appeal decided', 'Appeal for case {{ case_id }} at level {{ level }}')",
            tenant_id, event_type,
        )


async def _drive_to(pool: asyncpg.Pool, created, to_state: str) -> None:
    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state=to_state,
        actor_id="reviewer-001",
        actor_type="user",
        correlation_id=created.correlation_id,
        human_signoff_recorded=True,
    )
    async with pool.acquire() as conn:
        async with conn.transaction():
            await engine.apply(conn, req)


async def _setup_appeal_review(pool: asyncpg.Pool, tenant_id: str):
    """Drive a fresh case to denied then file_appeal → appeal_review + under_review
    appeal + a running appeal clock. Returns (created, appeal_id)."""
    await _seed_template(pool, tenant_id, "appeal_filed")
    service = CaseService(pool)
    created = await service.create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pool, created, "denied")
    result = await AppealService(pool).file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-7",
        reason="Disagree with the denial",
    )
    return created, result["appeal_id"]


@pytest.mark.asyncio
async def test_decide_appeal_overturn(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-decide-{uuid.uuid4()}"
    await _seed_template(pg_pool, tenant_id, "appeal_overturned")
    created, appeal_id = await _setup_appeal_review(pg_pool, tenant_id)
    await AppealService(pg_pool).assign_reviewer(
        case_id=created.case_id, tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id), reviewer_id="rev-1", assigned_by="coord",
    )

    result = await AppealService(pg_pool).decide_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id),
        outcome="overturned",
        reviewer_actor="rev-1",
        reason="Medical necessity established on review",
        human_signoff_recorded=False,
    )

    assert result["appeal_id"] == appeal_id
    assert result["outcome"] == "overturned"
    assert result["status"] == "appeal_overturned"

    async with pg_pool.acquire() as conn:
        case_status = await conn.fetchval(
            "SELECT status FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert case_status == "appeal_overturned"

        appeal_row = await conn.fetchrow(
            "SELECT * FROM appeals WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(appeal_id), tenant_id,
        )
        assert appeal_row["status"] == "overturned"
        assert appeal_row["reviewer_actor"] == "rev-1"
        assert appeal_row["decided_at"] is not None

        # appeal clock stopped
        appeal_clock = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id=$1 AND tenant_id=$2 AND clock_type='appeal'",
            created.case_id, tenant_id,
        )
        assert appeal_clock == "stopped"

        # AppealDecided outbox event
        decided = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' = 'sim.case.lifecycle/AppealDecided/v1'",
            str(created.case_id),
        )
        assert decided == 1

        # the appeal_overturned notice was rendered
        notice = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log "
            "WHERE tenant_id=$1 AND case_id=$2 AND event_type='appeal_overturned'",
            tenant_id, created.case_id,
        )
        assert notice == 1

        # No DECISION_RECORDED double-fire: only the original `denied`
        # determination fired one — the appeal_overturned transition adds none
        # (appeal_* states are excluded from DETERMINATION_STATES).
        decision_recorded = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' LIKE '%DecisionRecorded%'",
            str(created.case_id),
        )
        assert decision_recorded == 1


@pytest.mark.asyncio
async def test_decide_appeal_uphold_with_signoff(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-decide-{uuid.uuid4()}"
    await _seed_template(pg_pool, tenant_id, "appeal_upheld")
    created, appeal_id = await _setup_appeal_review(pg_pool, tenant_id)
    await AppealService(pg_pool).assign_reviewer(
        case_id=created.case_id, tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id), reviewer_id="rev-2", assigned_by="coord",
    )

    result = await AppealService(pg_pool).decide_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id),
        outcome="upheld",
        reviewer_actor="rev-2",
        reason="Continued adverse — denial upheld",
        human_signoff_recorded=True,
    )

    assert result["status"] == "appeal_upheld"
    assert result["outcome"] == "upheld"

    async with pg_pool.acquire() as conn:
        case_status = await conn.fetchval(
            "SELECT status FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert case_status == "appeal_upheld"
        appeal_status = await conn.fetchval(
            "SELECT status FROM appeals WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(appeal_id), tenant_id,
        )
        assert appeal_status == "upheld"


@pytest.mark.asyncio
async def test_decide_appeal_uphold_without_signoff_blocks(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-decide-{uuid.uuid4()}"
    created, appeal_id = await _setup_appeal_review(pg_pool, tenant_id)
    await AppealService(pg_pool).assign_reviewer(
        case_id=created.case_id, tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id), reviewer_id="rev-3", assigned_by="coord",
    )

    with pytest.raises(GuardError):
        await AppealService(pg_pool).decide_appeal(
            case_id=created.case_id,
            tenant_id=tenant_id,
            appeal_id=uuid.UUID(appeal_id),
            outcome="upheld",
            reviewer_actor="rev-3",
            reason="No sign-off recorded",
            human_signoff_recorded=False,
        )

    # The gate fired before any write: case still appeal_review, appeal still under_review.
    async with pg_pool.acquire() as conn:
        case_status = await conn.fetchval(
            "SELECT status FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert case_status == "appeal_review"
        appeal_status = await conn.fetchval(
            "SELECT status FROM appeals WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(appeal_id), tenant_id,
        )
        assert appeal_status == "under_review"
