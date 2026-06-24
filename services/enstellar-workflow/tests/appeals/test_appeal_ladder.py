"""Task 5 — the multi-level appeal ladder + the eligibility matrix.

End-to-end across file_appeal/decide_appeal:
  file L1 → uphold → re-appeal L2 (independent_review, appealed_ref=L1) →
  overturn — and the appeals table holds exactly 2 rows (L1 upheld,
  L2 overturned).

Eligibility matrix:
  * file_appeal on an approved (non-adverse) case → AppealNotAllowedError.
  * drive the ladder to L3 upheld, then file_appeal again → AppealNotAllowedError
    (beyond MAX_APPEAL_LEVEL=3).
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest

from enstellar_workflow.appeals.service import (
    AppealService,
    AppealNotAllowedError,
    MAX_APPEAL_LEVEL,
)
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from tests.conftest import make_case


async def _seed_appeal_templates(pool: asyncpg.Pool, tenant_id: str) -> None:
    """Seed the three appeal notice templates for the test tenant (the file/decide
    flows render these via render_and_dispatch — StrictUndefined-safe bodies)."""
    async with pool.acquire() as conn:
        for event_type, body in (
            ("appeal_filed",
             "Your appeal (level {{ level }}) has been received and is under review."),
            ("appeal_overturned",
             "Your appeal (level {{ level }}) was overturned — "
             "the prior determination is reversed."),
            ("appeal_upheld",
             "Your appeal (level {{ level }}) was upheld."),
        ):
            await conn.execute(
                "INSERT INTO notification_templates "
                "(tenant_id, event_type, channel, subject_template, body_template) "
                "VALUES ($1, $2, 'portal', 'Appeal update', $3)",
                tenant_id, event_type, body,
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


async def _make_denied_case(pool: asyncpg.Pool, tenant_id: str):
    service = CaseService(pool)
    created = await service.create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pool, created, "denied")
    return created


@pytest.mark.asyncio
async def test_multi_level_appeal_ladder(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-ladder-{uuid.uuid4()}"
    await _seed_appeal_templates(pg_pool, tenant_id)
    svc = AppealService(pg_pool)

    created = await _make_denied_case(pg_pool, tenant_id)

    # ── File L1 ────────────────────────────────────────────────────────────
    l1 = await svc.file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-7",
        reason="Disagree with the denial",
    )
    assert l1["level"] == 1
    assert l1["status"] == "appeal_review"
    l1_appeal_id = l1["appeal_id"]

    async with pg_pool.acquire() as conn:
        case_row = await conn.fetchrow(
            "SELECT status, assignee_queue FROM workflow_instances "
            "WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert case_row["status"] == "appeal_review"
        assert case_row["assignee_queue"] == "appeal_l1_review"
        l1_row = await conn.fetchrow(
            "SELECT * FROM appeals WHERE case_id=$1 AND tenant_id=$2 AND level=1",
            created.case_id, tenant_id,
        )
        assert l1_row["status"] == "under_review"

    # ── Uphold L1 (with sign-off) ──────────────────────────────────────────
    up1 = await svc.decide_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        appeal_id=uuid.UUID(l1_appeal_id),
        outcome="upheld",
        reviewer_actor="rev-1",
        reason="Continued adverse — denial upheld",
        human_signoff_recorded=True,
    )
    assert up1["status"] == "appeal_upheld"

    async with pg_pool.acquire() as conn:
        case_status = await conn.fetchval(
            "SELECT status FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert case_status == "appeal_upheld"
        l1_status = await conn.fetchval(
            "SELECT status FROM appeals WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(l1_appeal_id), tenant_id,
        )
        assert l1_status == "upheld"
        # the L1 appeal clock is stopped after the uphold decision
        l1_clock = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id=$1 AND tenant_id=$2 AND clock_type='appeal'",
            created.case_id, tenant_id,
        )
        assert l1_clock == "stopped"

    # ── Re-appeal → L2 ─────────────────────────────────────────────────────
    l2 = await svc.file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-7",
        reason="Escalate to independent review",
    )
    assert l2["level"] == 2
    assert l2["status"] == "appeal_review"
    l2_appeal_id = l2["appeal_id"]

    async with pg_pool.acquire() as conn:
        case_row = await conn.fetchrow(
            "SELECT status, assignee_queue FROM workflow_instances "
            "WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert case_row["status"] == "appeal_review"
        assert case_row["assignee_queue"] == "independent_review"
        l2_row = await conn.fetchrow(
            "SELECT * FROM appeals WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(l2_appeal_id), tenant_id,
        )
        assert l2_row["level"] == 2
        assert l2_row["status"] == "under_review"
        # appealed_ref of L2 points at the L1 appeal_id
        assert l2_row["appealed_ref"] == l1_appeal_id
        # a fresh appeal clock is running again
        l2_clock = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id=$1 AND tenant_id=$2 AND clock_type='appeal'",
            created.case_id, tenant_id,
        )
        assert l2_clock == "running"

    # ── Overturn L2 ────────────────────────────────────────────────────────
    ov2 = await svc.decide_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        appeal_id=uuid.UUID(l2_appeal_id),
        outcome="overturned",
        reviewer_actor="rev-2",
        reason="Medical necessity established on independent review",
        human_signoff_recorded=False,
    )
    assert ov2["status"] == "appeal_overturned"

    async with pg_pool.acquire() as conn:
        case_status = await conn.fetchval(
            "SELECT status FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert case_status == "appeal_overturned"

        rows = await conn.fetch(
            "SELECT level, status FROM appeals WHERE case_id=$1 AND tenant_id=$2 "
            "ORDER BY level",
            created.case_id, tenant_id,
        )
        # exactly 2 appeal rows: L1 upheld, L2 overturned
        assert len(rows) == 2
        assert (rows[0]["level"], rows[0]["status"]) == (1, "upheld")
        assert (rows[1]["level"], rows[1]["status"]) == (2, "overturned")


@pytest.mark.asyncio
async def test_file_appeal_on_approved_case_raises(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-ladder-{uuid.uuid4()}"
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


@pytest.mark.asyncio
async def test_file_appeal_beyond_max_level_raises(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-ladder-{uuid.uuid4()}"
    await _seed_appeal_templates(pg_pool, tenant_id)
    svc = AppealService(pg_pool)

    created = await _make_denied_case(pg_pool, tenant_id)

    # Climb the ladder: file → uphold for each level up to MAX_APPEAL_LEVEL.
    for level in range(1, MAX_APPEAL_LEVEL + 1):
        filed = await svc.file_appeal(
            case_id=created.case_id,
            tenant_id=tenant_id,
            filed_by="member-7",
            reason=f"Appeal at level {level}",
        )
        assert filed["level"] == level
        await svc.decide_appeal(
            case_id=created.case_id,
            tenant_id=tenant_id,
            appeal_id=uuid.UUID(filed["appeal_id"]),
            outcome="upheld",
            reviewer_actor=f"rev-{level}",
            reason="Continued adverse — upheld",
            human_signoff_recorded=True,
        )

    # The case is now appeal_upheld at L3 — a further appeal exceeds MAX.
    async with pg_pool.acquire() as conn:
        top_level = await conn.fetchval(
            "SELECT max(level) FROM appeals WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
    assert top_level == MAX_APPEAL_LEVEL

    with pytest.raises(AppealNotAllowedError):
        await svc.file_appeal(
            case_id=created.case_id,
            tenant_id=tenant_id,
            filed_by="member-7",
            reason="Beyond the maximum appeal level",
        )
