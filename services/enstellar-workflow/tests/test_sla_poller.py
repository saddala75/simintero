"""Integration tests for SlaPoller — requires PostgreSQL (Testcontainers).

These drive ``SlaPoller._poll_batch()`` directly against the live test DB (the
infinite ``start()`` loop is never run). The scan uses the BYPASSRLS sim_relay
role exactly as production does; every write goes through tenant_transaction.
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest

from canonical_model import Status
from tests.conftest import make_case
from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.clocks.sla_poller import SlaPoller

pytestmark = pytest.mark.asyncio


async def _seed_case(pool: asyncpg.Pool, *, tenant_id: str, status: Status):
    case = make_case(tenant_id=tenant_id, status=status)
    repo = CaseRepository()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)
    return case


async def _seed_clock(pool: asyncpg.Pool, *, tenant_id, case_id, started_sql, deadline_sql,
                      total_paused_seconds=0.0, clock_type="decision", urgency="standard",
                      duration_calendar_days=7):
    """Insert a running clock with explicit started_at/deadline SQL."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                f"""
                INSERT INTO clocks
                  (clock_id, tenant_id, case_id, clock_type, state, urgency,
                   duration_calendar_days, started_at, deadline,
                   paused_at, total_paused_seconds, breached_at, warned_at)
                VALUES (gen_random_uuid(), $1, $2, $4, 'running', $5,
                        $6, {started_sql}, {deadline_sql},
                        NULL, $3, NULL, NULL)
                """,
                tenant_id,
                case_id,
                total_paused_seconds,
                clock_type,
                urgency,
                duration_calendar_days,
            )


async def _count_events(pool, tenant_id, case_id, schema_ref) -> int:
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT count(*) FROM shared.outbox"
            " WHERE tenant_id = $1 AND envelope->'payload'->>'case_id' = $2"
            " AND envelope->>'schema_ref' = $3",
            tenant_id,
            str(case_id),
            schema_ref,
        )


# ---------------------------------------------------------------------------
# Breach + escalate (+ idempotent on a 2nd tick)
# ---------------------------------------------------------------------------


async def test_poll_batch_breaches_and_escalates_overdue_clock(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-sla-breach-{uuid.uuid4()}"
    case = await _seed_case(pg_pool, tenant_id=tenant_id, status=Status.clinical_review)
    await _seed_clock(
        pg_pool,
        tenant_id=tenant_id,
        case_id=case.case_id,
        started_sql="NOW() - INTERVAL '8 days'",
        deadline_sql="NOW() - INTERVAL '1 second'",
    )

    poller = SlaPoller(pg_pool)
    await poller._poll_batch()

    async with pg_pool.acquire() as conn:
        clock_state = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id=$1 AND clock_type='decision'",
            case.case_id,
        )
        queue = await conn.fetchval(
            "SELECT assignee_queue FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id,
            tenant_id,
        )
    assert clock_state == "breached"
    assert queue == "md_review"

    breached_1 = await _count_events(pg_pool, tenant_id, case.case_id, "sim.clock/ClockBreached/v1")
    assigned_1 = await _count_events(
        pg_pool, tenant_id, case.case_id, "sim.case.lifecycle/CaseAssigned/v1"
    )
    assert breached_1 == 1
    assert assigned_1 == 1

    # 2nd tick: clock is no longer running → no new breach/escalation.
    await poller._poll_batch()
    breached_2 = await _count_events(pg_pool, tenant_id, case.case_id, "sim.clock/ClockBreached/v1")
    assigned_2 = await _count_events(
        pg_pool, tenant_id, case.case_id, "sim.case.lifecycle/CaseAssigned/v1"
    )
    assert breached_2 == 1
    assert assigned_2 == 1


# ---------------------------------------------------------------------------
# Warn (+ no re-warn on a 2nd tick)
# ---------------------------------------------------------------------------


async def test_poll_batch_warns_at_risk_clock_once(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-sla-warn-{uuid.uuid4()}"
    case = await _seed_case(pg_pool, tenant_id=tenant_id, status=Status.clinical_review)
    # ~90% elapsed: started 90 min ago, deadline 10 min from now → past the
    # default 75% warning threshold, but the deadline has NOT passed.
    await _seed_clock(
        pg_pool,
        tenant_id=tenant_id,
        case_id=case.case_id,
        started_sql="NOW() - INTERVAL '90 minutes'",
        deadline_sql="NOW() + INTERVAL '10 minutes'",
    )

    poller = SlaPoller(pg_pool)
    await poller._poll_batch()

    async with pg_pool.acquire() as conn:
        warned_at = await conn.fetchval(
            "SELECT warned_at FROM clocks WHERE case_id=$1 AND clock_type='decision'",
            case.case_id,
        )
        clock_state = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id=$1 AND clock_type='decision'",
            case.case_id,
        )
    assert warned_at is not None
    assert clock_state == "running"

    at_risk_1 = await _count_events(pg_pool, tenant_id, case.case_id, "sim.clock/ClockAtRisk/v1")
    assert at_risk_1 == 1

    # 2nd tick: warned_at is set → no re-warn.
    await poller._poll_batch()
    at_risk_2 = await _count_events(pg_pool, tenant_id, case.case_id, "sim.clock/ClockAtRisk/v1")
    assert at_risk_2 == 1


# ---------------------------------------------------------------------------
# Terminal case excluded by the scan
# ---------------------------------------------------------------------------


async def test_poll_batch_excludes_terminal_case(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-sla-terminal-{uuid.uuid4()}"
    case = await _seed_case(pg_pool, tenant_id=tenant_id, status=Status.closed)
    await _seed_clock(
        pg_pool,
        tenant_id=tenant_id,
        case_id=case.case_id,
        started_sql="NOW() - INTERVAL '8 days'",
        deadline_sql="NOW() - INTERVAL '1 second'",
    )

    poller = SlaPoller(pg_pool)
    await poller._poll_batch()

    async with pg_pool.acquire() as conn:
        clock_state = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id=$1 AND clock_type='decision'",
            case.case_id,
        )
    # Excluded by the scan's status <> ALL(TERMINAL_STATES) → never breached.
    assert clock_state == "running"

    breached = await _count_events(pg_pool, tenant_id, case.case_id, "sim.clock/ClockBreached/v1")
    assert breached == 0


# ---------------------------------------------------------------------------
# Appeal clock — the poller now monitors clock_type='appeal' too
# ---------------------------------------------------------------------------


async def test_poll_batch_breaches_and_escalates_overdue_appeal_clock(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-sla-appeal-{uuid.uuid4()}"
    case = await _seed_case(pg_pool, tenant_id=tenant_id, status=Status.appeal_review)
    await _seed_clock(
        pg_pool,
        tenant_id=tenant_id,
        case_id=case.case_id,
        started_sql="NOW() - INTERVAL '31 days'",
        deadline_sql="NOW() - INTERVAL '1 second'",
        clock_type="appeal",
        duration_calendar_days=30,
    )

    poller = SlaPoller(pg_pool)
    await poller._poll_batch()

    async with pg_pool.acquire() as conn:
        clock_state = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id=$1 AND clock_type='appeal'",
            case.case_id,
        )
        queue = await conn.fetchval(
            "SELECT assignee_queue FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id,
            tenant_id,
        )
    assert clock_state == "breached"
    assert queue == "md_review"

    breached = await _count_events(pg_pool, tenant_id, case.case_id, "sim.clock/ClockBreached/v1")
    assigned = await _count_events(
        pg_pool, tenant_id, case.case_id, "sim.case.lifecycle/CaseAssigned/v1"
    )
    assert breached == 1
    assert assigned == 1


# ---------------------------------------------------------------------------
# Appeal Status values + resolve_clock appeal duration (CLOCK_RULES fallback)
# ---------------------------------------------------------------------------


async def test_appeal_status_values_and_resolve_clock_appeal_duration(pg_pool: asyncpg.Pool):
    assert Status.appeal_review == "appeal_review"
    assert Status.appeal_overturned == "appeal_overturned"
    assert Status.appeal_upheld == "appeal_upheld"

    from enstellar_workflow.workflow_config import ConfigService
    from simintero_tenant_context import tenant_transaction

    tenant_id = f"tenant-appeal-clock-{uuid.uuid4()}"
    config = ConfigService()
    async with tenant_transaction(pg_pool, tenant_id) as conn:
        defn = await config.resolve_clock(
            conn,
            tenant_id=tenant_id,
            lob="commercial",
            urgency="standard",
            clock_type="appeal",
        )
    assert defn.duration_calendar_days == 30
    assert defn.clock_type == "appeal"
