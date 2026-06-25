"""Integration tests for GrievanceSlaPoller (B3) — requires PostgreSQL.

These drive ``GrievanceSlaPoller._poll_batch()`` directly against the live test
DB (the infinite ``start()`` loop is never run), mirroring tests/test_sla_poller.py.
The scan would SET ROLE to the BYPASSRLS sim_relay role in production; in the test
env the superuser pool is used (same as the proven SlaPoller tests). Every write
goes through tenant_transaction.

Grievance SLA breaches:
  - ack-breach: status='filed' + acknowledgement_due_at past + flag NULL
  - resolution-breach: status<>'resolved' + resolution_due_at past + flag NULL
Each stamps the corresponding breach flag ONCE, emits ONE GrievanceSlaBreached
event, and dispatches ONE internal overdue notice. Resolved grievances are skipped.
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest

from simintero_outbox import SchemaRef
from enstellar_workflow.grievances.sla_poller import GrievanceSlaPoller

pytestmark = pytest.mark.asyncio


async def _seed_templates(pool: asyncpg.Pool, tenant_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, lob, subject_template, body_template) "
            "VALUES ($1,'grievance_acknowledgement_overdue','internal',NULL,'Overdue',"
            "'Grievance {{ grievance_id }} {{ breach_type }} overdue')",
            tenant_id,
        )
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, lob, subject_template, body_template) "
            "VALUES ($1,'grievance_resolution_overdue','internal',NULL,'Overdue',"
            "'Grievance {{ grievance_id }} {{ breach_type }} overdue')",
            tenant_id,
        )


async def _seed_grievance(
    pool: asyncpg.Pool,
    *,
    tenant_id: str,
    status: str,
    ack_due_sql: str,
    res_due_sql: str,
    lob: str | None = "commercial",
) -> uuid.UUID:
    async with pool.acquire() as conn:
        gid = await conn.fetchval(
            f"""
            INSERT INTO grievances
              (tenant_id, member_ref, category, urgency, lob, status, filed_by,
               acknowledgement_due_at, resolution_due_at)
            VALUES ($1, 'member-1', 'access', 'standard', $2, $3, 'system',
                    {ack_due_sql}, {res_due_sql})
            RETURNING grievance_id
            """,
            tenant_id, lob, status,
        )
    return gid


async def _count_breach_events(pool, tenant_id, grievance_id, breach_type=None) -> int:
    sql = (
        "SELECT count(*) FROM shared.outbox"
        " WHERE tenant_id = $1"
        " AND envelope->'payload'->>'grievance_id' = $2"
        " AND envelope->>'schema_ref' = $3"
    )
    args = [tenant_id, str(grievance_id), SchemaRef.GRIEVANCE_SLA_BREACHED]
    if breach_type is not None:
        sql += " AND envelope->'payload'->>'breach_type' = $4"
        args.append(breach_type)
    async with pool.acquire() as conn:
        return await conn.fetchval(sql, *args)


async def _flags(pool, grievance_id):
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            "SELECT acknowledgement_breached_at, resolution_breached_at "
            "FROM grievances WHERE grievance_id=$1",
            grievance_id,
        )


async def _count_notices(pool, tenant_id, grievance_id, event_type) -> int:
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT count(*) FROM notification_log "
            "WHERE tenant_id=$1 AND case_id=$2 AND event_type=$3",
            tenant_id, grievance_id, event_type,
        )


# ---------------------------------------------------------------------------
# 1. Ack-breach → flag + one event + one notice; idempotent on re-poll.
# ---------------------------------------------------------------------------


async def test_ack_breach_escalates_once(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-griev-ack-{uuid.uuid4()}"
    await _seed_templates(pg_pool, tenant_id)
    gid = await _seed_grievance(
        pg_pool,
        tenant_id=tenant_id,
        status="filed",
        ack_due_sql="now() - interval '1 day'",
        res_due_sql="now() + interval '20 days'",
    )

    poller = GrievanceSlaPoller(pg_pool)
    await poller._poll_batch()

    flags = await _flags(pg_pool, gid)
    assert flags["acknowledgement_breached_at"] is not None
    assert flags["resolution_breached_at"] is None

    assert await _count_breach_events(pg_pool, tenant_id, gid, "acknowledgement") == 1
    assert await _count_breach_events(pg_pool, tenant_id, gid) == 1
    assert await _count_notices(pg_pool, tenant_id, gid, "grievance_acknowledgement_overdue") == 1

    # 2nd poll → idempotent (flag already stamped → no fresh breach).
    await poller._poll_batch()
    assert await _count_breach_events(pg_pool, tenant_id, gid) == 1


# ---------------------------------------------------------------------------
# 2. Resolution-breach → resolution flag + one event.
# ---------------------------------------------------------------------------


async def test_resolution_breach_escalates_once(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-griev-res-{uuid.uuid4()}"
    await _seed_templates(pg_pool, tenant_id)
    gid = await _seed_grievance(
        pg_pool,
        tenant_id=tenant_id,
        status="investigating",
        ack_due_sql="now() - interval '5 days'",
        res_due_sql="now() - interval '1 day'",
    )

    poller = GrievanceSlaPoller(pg_pool)
    await poller._poll_batch()

    flags = await _flags(pg_pool, gid)
    assert flags["resolution_breached_at"] is not None
    # status != 'filed' → ack breach does NOT fire.
    assert flags["acknowledgement_breached_at"] is None

    assert await _count_breach_events(pg_pool, tenant_id, gid, "resolution") == 1
    assert await _count_breach_events(pg_pool, tenant_id, gid) == 1
    assert await _count_notices(pg_pool, tenant_id, gid, "grievance_resolution_overdue") == 1


# ---------------------------------------------------------------------------
# 3. Both due-dates past on a filed grievance → two events.
# ---------------------------------------------------------------------------


async def test_both_breaches_fire_two_events(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-griev-both-{uuid.uuid4()}"
    await _seed_templates(pg_pool, tenant_id)
    gid = await _seed_grievance(
        pg_pool,
        tenant_id=tenant_id,
        status="filed",
        ack_due_sql="now() - interval '2 days'",
        res_due_sql="now() - interval '1 day'",
    )

    poller = GrievanceSlaPoller(pg_pool)
    await poller._poll_batch()

    flags = await _flags(pg_pool, gid)
    assert flags["acknowledgement_breached_at"] is not None
    assert flags["resolution_breached_at"] is not None

    assert await _count_breach_events(pg_pool, tenant_id, gid, "acknowledgement") == 1
    assert await _count_breach_events(pg_pool, tenant_id, gid, "resolution") == 1
    assert await _count_breach_events(pg_pool, tenant_id, gid) == 2


# ---------------------------------------------------------------------------
# 4. Resolved grievance is skipped entirely.
# ---------------------------------------------------------------------------


async def test_resolved_grievance_skipped(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-griev-resolved-{uuid.uuid4()}"
    await _seed_templates(pg_pool, tenant_id)
    gid = await _seed_grievance(
        pg_pool,
        tenant_id=tenant_id,
        status="resolved",
        ack_due_sql="now() - interval '5 days'",
        res_due_sql="now() - interval '1 day'",
    )

    poller = GrievanceSlaPoller(pg_pool)
    await poller._poll_batch()

    flags = await _flags(pg_pool, gid)
    assert flags["acknowledgement_breached_at"] is None
    assert flags["resolution_breached_at"] is None
    assert await _count_breach_events(pg_pool, tenant_id, gid) == 0


# ---------------------------------------------------------------------------
# Write-level status guard (closes the scan→process TOCTOU): mark_breached only
# stamps when the grievance is still in a state the breach applies to.
# ---------------------------------------------------------------------------


async def test_mark_breached_status_guard_closes_toctou(pg_pool: asyncpg.Pool):
    from enstellar_workflow.grievances.repository import GrievanceRepository
    from simintero_tenant_context import tenant_transaction

    tenant_id = f"tenant-griev-toctou-{uuid.uuid4()}"
    repo = GrievanceRepository()

    # A grievance ACKNOWLEDGED past its ack-due: an ack-breach must NOT stamp
    # (the breach applies only while status='filed' — simulates a resolve/ack
    # that happened between the scan and the write).
    acked = await _seed_grievance(
        pg_pool, tenant_id=tenant_id, status="acknowledged",
        ack_due_sql="now() - interval '1 day'", res_due_sql="now() + interval '20 days'",
    )
    # A RESOLVED grievance past its resolution-due: a resolution-breach must NOT stamp.
    resolved = await _seed_grievance(
        pg_pool, tenant_id=tenant_id, status="resolved",
        ack_due_sql="now() - interval '5 days'", res_due_sql="now() - interval '1 day'",
    )
    async with tenant_transaction(pg_pool, tenant_id) as conn:
        assert await repo.mark_breached(conn, grievance_id=acked, tenant_id=tenant_id, breach_type="acknowledgement") is False
        assert await repo.mark_breached(conn, grievance_id=resolved, tenant_id=tenant_id, breach_type="resolution") is False

    for gid in (acked, resolved):
        flags = await _flags(pg_pool, gid)
        assert flags["acknowledgement_breached_at"] is None
        assert flags["resolution_breached_at"] is None
