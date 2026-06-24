"""Task 3 — AppealService.file_appeal.

Filing an appeal on an adverse case:
  * returns {appeal_id, level:1, status:"appeal_review"}
  * the case row is appeal_review
  * an appeals row (level 1, under_review, appealed_ref set)
  * the prior decision clock is STOPPED, a fresh appeal clock RUNNING
  * an AppealFiled outbox event
  * assignee_queue = appeal_l1_review
  * an appeal_filed notice is rendered (notification_log row)
Filing on an approved (non-adverse) case raises AppealNotAllowedError.
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest

from canonical_model import Status
from enstellar_workflow.appeals.service import AppealService, AppealNotAllowedError
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from tests.conftest import make_case


async def _seed_appeal_filed_template(pool: asyncpg.Pool, tenant_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'appeal_filed', 'portal', "
            "'Appeal filed', 'Appeal for case {{ case_id }} at level {{ level }}')",
            tenant_id,
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


@pytest.mark.asyncio
async def test_file_appeal_on_denied_case(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-appeal-{uuid.uuid4()}"
    await _seed_appeal_filed_template(pg_pool, tenant_id)

    service = CaseService(pg_pool)
    created = await service.create_case(make_case(tenant_id=tenant_id))
    # create_case starts the decision clock; drive the case to denied (adverse).
    await _drive_to(pg_pool, created, "denied")

    # Sanity: the decision clock is running before the appeal is filed.
    async with pg_pool.acquire() as conn:
        pre = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id=$1 AND tenant_id=$2 AND clock_type='decision'",
            created.case_id, tenant_id,
        )
    assert pre == "running"

    result = await AppealService(pg_pool).file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-7",
        reason="Disagree with the denial",
    )

    assert result["level"] == 1
    assert result["status"] == "appeal_review"
    assert uuid.UUID(result["appeal_id"])

    async with pg_pool.acquire() as conn:
        # case row → appeal_review + queue
        case_row = await conn.fetchrow(
            "SELECT status, assignee_queue FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert case_row["status"] == "appeal_review"
        assert case_row["assignee_queue"] == "appeal_l1_review"

        # appeals row
        appeal_row = await conn.fetchrow(
            "SELECT * FROM appeals WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert appeal_row["level"] == 1
        assert appeal_row["status"] == "under_review"
        assert appeal_row["appealed_ref"] == str(created.case_id)
        assert str(appeal_row["appeal_id"]) == result["appeal_id"]

        # decision clock stopped, appeal clock running
        decision_state = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id=$1 AND tenant_id=$2 AND clock_type='decision'",
            created.case_id, tenant_id,
        )
        assert decision_state == "stopped"
        appeal_state = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id=$1 AND tenant_id=$2 AND clock_type='appeal'",
            created.case_id, tenant_id,
        )
        assert appeal_state == "running"

        # AppealFiled outbox event
        appeal_filed = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' = 'sim.case.lifecycle/AppealFiled/v1'",
            str(created.case_id),
        )
        assert appeal_filed == 1

        # the appeal_filed notice was rendered
        notice_count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log "
            "WHERE tenant_id=$1 AND case_id=$2 AND event_type='appeal_filed'",
            tenant_id, created.case_id,
        )
        assert notice_count == 1


@pytest.mark.asyncio
async def test_file_appeal_on_approved_case_raises(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-appeal-{uuid.uuid4()}"
    service = CaseService(pg_pool)
    created = await service.create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pg_pool, created, "approved")

    with pytest.raises(AppealNotAllowedError):
        await AppealService(pg_pool).file_appeal(
            case_id=created.case_id,
            tenant_id=tenant_id,
            filed_by="member-7",
            reason=None,
        )
