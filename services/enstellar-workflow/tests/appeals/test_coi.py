"""Slice S6b Task 2 — COI (conflict-of-interest) guard on appeal decisions.

The appeal reviewer must be independent:
  * reviewer != the original adverse determiner (the human actor on the
    denied/partially_denied/adverse_modification transition, from workflow_events)
  * (level >= 2) reviewer != the prior-level reviewer

A COI violation raises COIError (the route maps it to HTTP 409) and writes
NOTHING — the COI reads run inside the tenant_transaction BEFORE record_outcome,
so a COIError aborts the tx: the appeal stays under_review, the case stays
appeal_review.
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest

from enstellar_workflow.appeals.service import AppealService, COIError
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from tests.conftest import make_case


async def _seed_templates(pool: asyncpg.Pool, tenant_id: str) -> None:
    async with pool.acquire() as conn:
        for event_type, body in (
            ("appeal_filed",
             "Your appeal (level {{ level }}) is under review."),
            ("appeal_overturned",
             "Your appeal (level {{ level }}) was overturned."),
            ("appeal_upheld",
             "Your appeal (level {{ level }}) was upheld."),
        ):
            await conn.execute(
                "INSERT INTO notification_templates "
                "(tenant_id, event_type, channel, subject_template, body_template) "
                "VALUES ($1, $2, 'portal', 'Appeal update', $3)",
                tenant_id, event_type, body,
            )


async def _drive_to_denied(pool: asyncpg.Pool, created, actor_id: str) -> None:
    """Drive a fresh case to `denied` by a HUMAN actor (the adverse determiner)."""
    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="denied",
        actor_id=actor_id,
        actor_type="user",
        correlation_id=created.correlation_id,
        human_signoff_recorded=True,
    )
    async with pool.acquire() as conn:
        async with conn.transaction():
            await engine.apply(conn, req)


async def _setup(pool: asyncpg.Pool, tenant_id: str, determiner: str):
    """Create a case, drive it to denied by `determiner` (human), file an appeal."""
    await _seed_templates(pool, tenant_id)
    service = CaseService(pool)
    created = await service.create_case(make_case(tenant_id=tenant_id))
    await _drive_to_denied(pool, created, determiner)
    result = await AppealService(pool).file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-7",
        reason="Disagree with the denial",
    )
    return created, result["appeal_id"]


@pytest.mark.asyncio
async def test_coi_reviewer_equals_determiner_blocks(pg_pool: asyncpg.Pool):
    """reviewer == the original adverse determiner → COIError, NO write."""
    tenant_id = f"tenant-coi-{uuid.uuid4()}"
    created, appeal_id = await _setup(pg_pool, tenant_id, determiner="clinician-7")

    with pytest.raises(COIError):
        await AppealService(pg_pool).decide_appeal(
            case_id=created.case_id,
            tenant_id=tenant_id,
            appeal_id=uuid.UUID(appeal_id),
            outcome="overturned",
            reviewer_actor="clinician-7",
            reason="The original determiner cannot review their own appeal",
            human_signoff_recorded=False,
        )

    # NO write: appeal still under_review, case still appeal_review.
    async with pg_pool.acquire() as conn:
        appeal_status = await conn.fetchval(
            "SELECT status FROM appeals WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(appeal_id), tenant_id,
        )
        assert appeal_status == "under_review"
        case_status = await conn.fetchval(
            "SELECT status FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert case_status == "appeal_review"


@pytest.mark.asyncio
async def test_coi_independent_reviewer_succeeds(pg_pool: asyncpg.Pool):
    """An independent reviewer (!= determiner) decides successfully."""
    tenant_id = f"tenant-coi-{uuid.uuid4()}"
    created, appeal_id = await _setup(pg_pool, tenant_id, determiner="clinician-7")

    result = await AppealService(pg_pool).decide_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id),
        outcome="overturned",
        reviewer_actor="rev-1",
        reason="Medical necessity established on independent review",
        human_signoff_recorded=False,
    )

    assert result["status"] == "appeal_overturned"
    async with pg_pool.acquire() as conn:
        appeal_row = await conn.fetchrow(
            "SELECT status, reviewer_actor FROM appeals WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(appeal_id), tenant_id,
        )
        assert appeal_row["status"] == "overturned"
        assert appeal_row["reviewer_actor"] == "rev-1"


@pytest.mark.asyncio
async def test_coi_level2_prior_reviewer_blocks(pg_pool: asyncpg.Pool):
    """L2 reviewer == the L1 (prior-level) reviewer → COIError; a fresh one succeeds."""
    tenant_id = f"tenant-coi-{uuid.uuid4()}"
    svc = AppealService(pg_pool)
    created, l1_appeal_id = await _setup(pg_pool, tenant_id, determiner="clinician-7")

    # Uphold L1 by rev-1 (with sign-off).
    await svc.decide_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        appeal_id=uuid.UUID(l1_appeal_id),
        outcome="upheld",
        reviewer_actor="rev-1",
        reason="Continued adverse — denial upheld",
        human_signoff_recorded=True,
    )

    # Re-appeal → L2.
    l2 = await svc.file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-7",
        reason="Escalate to independent review",
    )
    assert l2["level"] == 2
    l2_appeal_id = l2["appeal_id"]

    # COI: the L2 reviewer cannot be the L1 (prior-level) reviewer rev-1.
    with pytest.raises(COIError):
        await svc.decide_appeal(
            case_id=created.case_id,
            tenant_id=tenant_id,
            appeal_id=uuid.UUID(l2_appeal_id),
            outcome="overturned",
            reviewer_actor="rev-1",
            reason="Prior-level reviewer cannot re-review",
            human_signoff_recorded=False,
        )

    async with pg_pool.acquire() as conn:
        l2_status = await conn.fetchval(
            "SELECT status FROM appeals WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(l2_appeal_id), tenant_id,
        )
        assert l2_status == "under_review"

    # A fresh independent L2 reviewer succeeds.
    result = await svc.decide_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        appeal_id=uuid.UUID(l2_appeal_id),
        outcome="overturned",
        reviewer_actor="rev-2",
        reason="Medical necessity established on independent review",
        human_signoff_recorded=False,
    )
    assert result["status"] == "appeal_overturned"
