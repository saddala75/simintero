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


# ---------------------------------------------------------------------------
# Slice S6a review fix F2 — appeal_filed ack notice must render even when
# reason=None when the production template body references {% if reason %}
# ---------------------------------------------------------------------------


async def _seed_prod_appeal_filed_template(pool: asyncpg.Pool, tenant_id: str) -> None:
    """Seed the PRODUCTION-shaped appeal_filed template.

    Body references ``{% if reason %}`` — exactly as in
    db/seeds/notification_templates.sql.  When ``reason`` is absent from the
    Jinja context AND StrictUndefined is active, this raises UndefinedError
    → comms catches it → skips the notice → 0 notification_log rows.
    """
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'appeal_filed', 'portal', "
            "'Appeal update', "
            "'Your appeal (level {{ level }}) has been received and is under review."
            "{% if reason %} Reason on file: {{ reason }}.{% endif %}')",
            tenant_id,
        )


@pytest.mark.asyncio
async def test_appeal_filed_notice_renders_with_prod_template_reason_none(
    pg_pool: asyncpg.Pool,
):
    """appeal_filed ack notice must render (notification_log row created) even
    when reason=None — production template shape used.

    Regression: file_appeal passed context={'case_id': ..., 'level': ...}
    WITHOUT 'reason'.  Jinja2 StrictUndefined raised UndefinedError on
    ``{% if reason %}``, comms caught it and silently skipped the notice.
    After the fix (``"reason": reason`` always present in context), the render
    must succeed: None is falsy so ``{% if reason %}`` skips the clause, and
    a notification_log row IS created.
    """
    tenant_id = f"tenant-appeal-prod-none-{uuid.uuid4()}"
    await _seed_prod_appeal_filed_template(pg_pool, tenant_id)

    service = CaseService(pg_pool)
    created = await service.create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pg_pool, created, "denied")

    await AppealService(pg_pool).file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-999",
        reason=None,
    )

    async with pg_pool.acquire() as conn:
        notice_count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log "
            "WHERE tenant_id=$1 AND case_id=$2 AND event_type='appeal_filed'",
            tenant_id,
            created.case_id,
        )
    assert notice_count == 1, (
        "appeal_filed notice was not created (notice_count=0) — "
        "likely Jinja2 StrictUndefined raised UndefinedError for absent "
        "'reason' key; fix: add \"reason\": reason to file_appeal notice context"
    )


@pytest.mark.asyncio
async def test_appeal_filed_notice_renders_with_prod_template_reason_present(
    pg_pool: asyncpg.Pool,
):
    """appeal_filed ack notice renders and includes reason text when reason is set."""
    tenant_id = f"tenant-appeal-prod-reason-{uuid.uuid4()}"
    await _seed_prod_appeal_filed_template(pg_pool, tenant_id)

    service = CaseService(pg_pool)
    created = await service.create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pg_pool, created, "denied")

    await AppealService(pg_pool).file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-999",
        reason="Disagree with the outcome",
    )

    async with pg_pool.acquire() as conn:
        notice_count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log "
            "WHERE tenant_id=$1 AND case_id=$2 AND event_type='appeal_filed'",
            tenant_id,
            created.case_id,
        )
    assert notice_count == 1, "appeal_filed notice must be created when reason is set"


# ---------------------------------------------------------------------------
# Task 3 (S6b) — partial unique index + concurrent double-file guard
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_double_file_on_active_appeal_raises(pg_pool: asyncpg.Pool):
    """Concurrent double-file race: AppealNotAllowedError when an under_review
    appeal already exists for the same (case_id, tenant_id).

    Simulates the race: the case stays 'denied' (still eligible) but a competing
    request has already committed an under_review appeal row.  Without the
    partial unique index + error translation the second INSERT would silently
    succeed (two active appeals).  With both in place the UniqueViolationError
    is caught in file_appeal and re-raised as AppealNotAllowedError (→ 409).

    RED: before the migration + try/except the second INSERT succeeds → test
    fails with "DID NOT RAISE".  GREEN: after both changes the test passes.
    """
    tenant_id = f"tenant-dbl-{uuid.uuid4()}"
    await _seed_appeal_filed_template(pg_pool, tenant_id)

    service = CaseService(pg_pool)
    created = await service.create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pg_pool, created, "denied")

    # Pre-insert an under_review appeal directly (the "race winner").
    # The test pool is a superuser → RLS is bypassed; no GUC setup needed.
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO appeals (case_id, tenant_id, level, appealed_ref, filed_by) "
            "VALUES ($1, $2, 1, $3, 'race-winner')",
            created.case_id, tenant_id, str(created.case_id),
        )

    # file_appeal: case is still 'denied' (eligible) → passes the eligibility
    # guard → hits insert_appeal → unique constraint → AppealNotAllowedError.
    with pytest.raises(AppealNotAllowedError, match="already under review"):
        await AppealService(pg_pool).file_appeal(
            case_id=created.case_id,
            tenant_id=tenant_id,
            filed_by="member-8",
            reason="Concurrent filer — should be blocked",
        )


@pytest.mark.asyncio
async def test_re_appeal_after_uphold_succeeds(pg_pool: asyncpg.Pool):
    """After L1 is upheld (status='upheld', NOT 'under_review') a L2 re-appeal
    is allowed — the partial unique index (WHERE status='under_review') must not
    block a new filing once the prior appeal is decided.

    This is a regression guard: ensures the partial unique does not accidentally
    break the re-appeal ladder.
    """
    tenant_id = f"tenant-re-appeal-{uuid.uuid4()}"
    # Seed both templates needed for file + uphold flows.
    async with pg_pool.acquire() as conn:
        for event_type, body in (
            ("appeal_filed",
             "Your appeal (level {{ level }}) is under review."),
            ("appeal_upheld",
             "Your appeal (level {{ level }}) was upheld."),
        ):
            await conn.execute(
                "INSERT INTO notification_templates "
                "(tenant_id, event_type, channel, subject_template, body_template) "
                "VALUES ($1, $2, 'portal', 'Appeal update', $3)",
                tenant_id, event_type, body,
            )

    service = CaseService(pg_pool)
    created = await service.create_case(make_case(tenant_id=tenant_id))
    # _drive_to uses actor_id="reviewer-001" → that becomes the adverse determiner.
    await _drive_to(pg_pool, created, "denied")

    svc = AppealService(pg_pool)

    # File L1 → under_review.
    l1 = await svc.file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-7",
        reason="First appeal",
    )
    assert l1["level"] == 1

    # Uphold L1 (L1 status becomes 'upheld', not 'under_review').
    # reviewer_actor must differ from the adverse determiner ("reviewer-001").
    from enstellar_workflow.appeals.service import AppealService as _AS  # noqa: F401
    await svc.decide_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        appeal_id=uuid.UUID(l1["appeal_id"]),
        outcome="upheld",
        reviewer_actor="rev-independent",
        reason="Denial upheld on review",
        human_signoff_recorded=True,
    )

    # Re-appeal L2 — must SUCCEED because L1 is 'upheld' (not 'under_review');
    # the partial unique only blocks duplicate under_review rows.
    l2 = await svc.file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-7",
        reason="Escalating to independent review",
    )
    assert l2["level"] == 2
    assert l2["status"] == "appeal_review"

    async with pg_pool.acquire() as conn:
        l2_row = await conn.fetchrow(
            "SELECT status FROM appeals WHERE appeal_id = $1",
            uuid.UUID(l2["appeal_id"]),
        )
    assert l2_row["status"] == "under_review"
