"""Tests for clock/SLA logic — migration assertions, model unit tests, ClockService integration tests."""
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest

from tests.conftest import make_case


# ---------------------------------------------------------------------------
# Migration assertions (Task 1)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_clocks_table_exists(pg_pool: asyncpg.Pool):
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'clocks'"
        )
    assert row is not None, "clocks table was not created by migration 0003"


@pytest.mark.asyncio
async def test_clocks_deadline_index_exists(pg_pool: asyncpg.Pool):
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT indexname FROM pg_indexes "
            "WHERE tablename = 'clocks' AND indexname = 'ix_clocks_deadline'"
        )
    assert row is not None, "ix_clocks_deadline partial index not found"


@pytest.mark.asyncio
async def test_clocks_unique_constraint_on_case_clock_type(pg_pool: asyncpg.Pool):
    """Inserting the same (case_id, clock_type) twice must raise UniqueViolationError."""
    case_id = uuid.uuid4()
    tenant_id = "tenant-t13-mig"
    deadline = datetime.now(timezone.utc) + timedelta(days=7)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO clocks (tenant_id, case_id, clock_type, urgency, "
                "duration_calendar_days, deadline) VALUES ($1, $2, $3, $4, $5, $6)",
                tenant_id, case_id, "decision", "standard", 7, deadline,
            )
        with pytest.raises(asyncpg.UniqueViolationError):
            async with conn.transaction():
                await conn.execute(
                    "INSERT INTO clocks (tenant_id, case_id, clock_type, urgency, "
                    "duration_calendar_days, deadline) VALUES ($1, $2, $3, $4, $5, $6)",
                    tenant_id, case_id, "decision", "standard", 7, deadline,
                )


# ---------------------------------------------------------------------------
# ClockDefinition + ClockState model tests (Task 3) — no DB, pure unit tests
# ---------------------------------------------------------------------------


def test_for_case_expedited_decision_returns_3_days():
    from enstellar_workflow.clocks.model import ClockDefinition
    defn = ClockDefinition.for_case("expedited", "decision")
    assert defn.duration_calendar_days == 3
    assert defn.clock_type == "decision"
    assert defn.urgency == "expedited"


def test_for_case_standard_decision_returns_7_days():
    from enstellar_workflow.clocks.model import ClockDefinition
    defn = ClockDefinition.for_case("standard", "decision")
    assert defn.duration_calendar_days == 7


def test_for_case_concurrent_decision_returns_1_day():
    from enstellar_workflow.clocks.model import ClockDefinition
    defn = ClockDefinition.for_case("concurrent", "decision")
    assert defn.duration_calendar_days == 1


def test_for_case_unknown_urgency_raises_value_error():
    from enstellar_workflow.clocks.model import ClockDefinition
    with pytest.raises(ValueError, match="No clock rule"):
        ClockDefinition.for_case("unknown_urgency", "decision")


def test_for_case_unknown_clock_type_raises_value_error():
    from enstellar_workflow.clocks.model import ClockDefinition
    with pytest.raises(ValueError, match="No clock rule"):
        ClockDefinition.for_case("standard", "nonexistent_clock")


def test_adjusted_deadline_no_pause():
    """Running clock with zero accumulated pause: adjusted_deadline == deadline."""
    from enstellar_workflow.clocks.model import ClockState
    now = datetime.now(timezone.utc)
    deadline = now + timedelta(days=7)
    state = ClockState(
        clock_id=str(uuid.uuid4()),
        tenant_id="t1",
        case_id=str(uuid.uuid4()),
        clock_type="decision",
        state="running",
        deadline=deadline,
        paused_at=None,
        total_paused_seconds=0.0,
        breached_at=None,
    )
    assert state.adjusted_deadline == deadline


def test_adjusted_deadline_with_accumulated_paused_seconds():
    """3600 accumulated seconds extends deadline by exactly 1 hour."""
    from enstellar_workflow.clocks.model import ClockState
    now = datetime.now(timezone.utc)
    deadline = now + timedelta(days=7)
    state = ClockState(
        clock_id=str(uuid.uuid4()),
        tenant_id="t1",
        case_id=str(uuid.uuid4()),
        clock_type="decision",
        state="running",
        deadline=deadline,
        paused_at=None,
        total_paused_seconds=3600.0,
        breached_at=None,
    )
    expected = deadline + timedelta(seconds=3600)
    assert state.adjusted_deadline == expected


def test_adjusted_deadline_currently_paused_adds_current_pause_time():
    """A currently-paused clock includes the in-progress pause in adjusted_deadline."""
    from enstellar_workflow.clocks.model import ClockState
    now = datetime.now(timezone.utc)
    deadline = now + timedelta(days=7)
    paused_2min_ago = now - timedelta(minutes=2)
    state = ClockState(
        clock_id=str(uuid.uuid4()),
        tenant_id="t1",
        case_id=str(uuid.uuid4()),
        clock_type="decision",
        state="paused",
        deadline=deadline,
        paused_at=paused_2min_ago,
        total_paused_seconds=0.0,
        breached_at=None,
    )
    delta = state.adjusted_deadline - deadline
    # Pause started 2 minutes ago, so delta should be ~2 minutes (with 10s tolerance)
    assert timedelta(minutes=1, seconds=50) < delta < timedelta(minutes=2, seconds=10)


def test_adjusted_deadline_combined_accumulated_and_current_pause():
    """Both accumulated (3600s) and current pause contribute to adjusted_deadline."""
    from enstellar_workflow.clocks.model import ClockState
    now = datetime.now(timezone.utc)
    deadline = now + timedelta(days=7)
    paused_1min_ago = now - timedelta(minutes=1)
    state = ClockState(
        clock_id=str(uuid.uuid4()),
        tenant_id="t1",
        case_id=str(uuid.uuid4()),
        clock_type="decision",
        state="paused",
        deadline=deadline,
        paused_at=paused_1min_ago,
        total_paused_seconds=3600.0,  # 1 hour already accumulated
        breached_at=None,
    )
    delta = state.adjusted_deadline - deadline
    # At least 3600s (accumulated) + ~60s (current pause)
    assert delta >= timedelta(seconds=3600 + 50)


# ---------------------------------------------------------------------------
# ClockService integration tests (Task 4) — require live Postgres
# ---------------------------------------------------------------------------

import asyncio as _asyncio


@pytest.mark.asyncio
async def test_start_creates_running_clock(pg_pool: asyncpg.Pool):
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("standard")
    cid = uuid.uuid4()
    tid = f"tenant-start-{cid}"

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            state = await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)

    assert state.state == "running"
    assert state.clock_type == "decision"
    assert state.total_paused_seconds == 0.0
    assert state.paused_at is None


@pytest.mark.asyncio
async def test_start_duplicate_raises_value_error(pg_pool: asyncpg.Pool):
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("standard")
    cid = uuid.uuid4()
    tid = f"tenant-dup-{cid}"

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            with pytest.raises(ValueError, match="already exists"):
                await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)


@pytest.mark.asyncio
async def test_pause_sets_paused_at(pg_pool: asyncpg.Pool):
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("standard")
    cid = uuid.uuid4()
    tid = f"tenant-pause-{cid}"

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            paused = await svc.pause(conn, tenant_id=tid, case_id=cid)

    assert paused.state == "paused"
    assert paused.paused_at is not None


@pytest.mark.asyncio
async def test_resume_accumulates_pause_seconds(pg_pool: asyncpg.Pool):
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("standard")
    cid = uuid.uuid4()
    tid = f"tenant-resume-{cid}"

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            await svc.pause(conn, tenant_id=tid, case_id=cid)
            await _asyncio.sleep(0.05)  # 50ms pause
            resumed = await svc.resume(conn, tenant_id=tid, case_id=cid)

    assert resumed.state == "running"
    assert resumed.paused_at is None
    assert resumed.total_paused_seconds >= 0.04  # at least 40ms


@pytest.mark.asyncio
async def test_resume_not_paused_raises_value_error(pg_pool: asyncpg.Pool):
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("standard")
    cid = uuid.uuid4()
    tid = f"tenant-resume-err-{cid}"

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            with pytest.raises(ValueError, match="No paused clock"):
                await svc.resume(conn, tenant_id=tid, case_id=cid)


@pytest.mark.asyncio
async def test_start_emits_clock_started_event_to_outbox(pg_pool: asyncpg.Pool):
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("expedited")
    cid = uuid.uuid4()
    tid = f"tenant-evt-start-{cid}"

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            row = await conn.fetchrow(
                "SELECT envelope->>'schema_ref' AS schema_ref FROM shared.outbox"
                " WHERE tenant_id = $1 AND envelope->'payload'->>'case_id' = $2"
                " ORDER BY event_id DESC LIMIT 1",
                tid, str(cid),
            )

    assert row is not None
    assert row["schema_ref"] == "sim.clock/ClockStarted/v1"


@pytest.mark.asyncio
async def test_pause_emits_clock_paused_event_to_outbox(pg_pool: asyncpg.Pool):
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("standard")
    cid = uuid.uuid4()
    tid = f"tenant-evt-pause-{cid}"

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            await svc.pause(conn, tenant_id=tid, case_id=cid, reason="rfi_sent")
            rows = await conn.fetch(
                "SELECT envelope->>'schema_ref' AS schema_ref FROM shared.outbox"
                " WHERE tenant_id = $1 AND envelope->'payload'->>'case_id' = $2"
                " ORDER BY event_id",
                tid, str(cid),
            )

    schema_refs = [r["schema_ref"] for r in rows]
    assert "sim.clock/ClockPaused/v1" in schema_refs


@pytest.mark.asyncio
async def test_resume_emits_clock_resumed_event(pg_pool: asyncpg.Pool):
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("standard")
    cid = uuid.uuid4()
    tid = f"tenant-evt-resume-{cid}"

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            await svc.pause(conn, tenant_id=tid, case_id=cid)
            await svc.resume(conn, tenant_id=tid, case_id=cid)
            rows = await conn.fetch(
                "SELECT envelope->>'schema_ref' AS schema_ref FROM shared.outbox"
                " WHERE tenant_id = $1 AND envelope->'payload'->>'case_id' = $2"
                " ORDER BY event_id",
                tid, str(cid),
            )

    schema_refs = [r["schema_ref"] for r in rows]
    assert "sim.clock/ClockResumed/v1" in schema_refs


@pytest.mark.asyncio
async def test_pause_nonexistent_clock_raises_value_error(pg_pool: asyncpg.Pool):
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    cid = uuid.uuid4()
    tid = f"tenant-noexist-{cid}"

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            with pytest.raises(ValueError):
                await svc.pause(conn, tenant_id=tid, case_id=cid)


# ---------------------------------------------------------------------------
# ClockService: check_breach + stop (Task 5)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_breach_marks_clock_breached(pg_pool: asyncpg.Pool):
    """A running clock whose deadline is in the past gets marked breached."""
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    tid = f"tenant-breach1-{uuid.uuid4()}"
    cid = uuid.uuid4()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            # Insert a clock with deadline already in the past
            await conn.execute(
                """
                INSERT INTO clocks
                  (clock_id, tenant_id, case_id, clock_type, state, urgency,
                   duration_calendar_days, started_at, deadline,
                   paused_at, total_paused_seconds, breached_at)
                VALUES (gen_random_uuid(), $1, $2, 'decision', 'running', 'standard',
                        7, NOW() - INTERVAL '8 days', NOW() - INTERVAL '1 second',
                        NULL, 0.0, NULL)
                """,
                tid,
                cid,
            )
            breached = await svc.check_breach(conn, tenant_id=tid, case_id=cid)

    assert breached is not None
    assert breached.state == "breached"
    assert breached.breached_at is not None


@pytest.mark.asyncio
async def test_check_breach_returns_none_when_deadline_not_passed(pg_pool: asyncpg.Pool):
    """A running clock whose deadline is still in the future returns None."""
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("standard")
    tid = f"tenant-nobreach-{uuid.uuid4()}"
    cid = uuid.uuid4()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            result = await svc.check_breach(conn, tenant_id=tid, case_id=cid)

    assert result is None


@pytest.mark.asyncio
async def test_check_breach_publishes_clock_breached_event(pg_pool: asyncpg.Pool):
    """Breach detection writes a clock.breached event to the outbox."""
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    tid = f"tenant-breach-evt-{uuid.uuid4()}"
    cid = uuid.uuid4()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO clocks
                  (clock_id, tenant_id, case_id, clock_type, state, urgency,
                   duration_calendar_days, started_at, deadline,
                   paused_at, total_paused_seconds, breached_at)
                VALUES (gen_random_uuid(), $1, $2, 'decision', 'running', 'standard',
                        7, NOW() - INTERVAL '8 days', NOW() - INTERVAL '1 second',
                        NULL, 0.0, NULL)
                """,
                tid,
                cid,
            )
            await svc.check_breach(conn, tenant_id=tid, case_id=cid)
            row = await conn.fetchrow(
                "SELECT envelope->>'schema_ref' AS schema_ref FROM shared.outbox"
                " WHERE tenant_id = $1 AND envelope->'payload'->>'case_id' = $2"
                " ORDER BY event_id DESC LIMIT 1",
                tid,
                str(cid),
            )

    assert row is not None
    assert row["schema_ref"] == "sim.clock/ClockBreached/v1"


@pytest.mark.asyncio
async def test_stop_sets_state_to_stopped(pg_pool: asyncpg.Pool):
    """stop() transitions a running clock to stopped."""
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("expedited")
    tid = f"tenant-stop1-{uuid.uuid4()}"
    cid = uuid.uuid4()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            stopped = await svc.stop(conn, tenant_id=tid, case_id=cid)

    assert stopped.state == "stopped"


@pytest.mark.asyncio
async def test_stop_also_stops_paused_clock(pg_pool: asyncpg.Pool):
    """stop() works on a paused clock too."""
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("standard")
    tid = f"tenant-stop-paused-{uuid.uuid4()}"
    cid = uuid.uuid4()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            await svc.pause(conn, tenant_id=tid, case_id=cid)
            stopped = await svc.stop(conn, tenant_id=tid, case_id=cid)

    assert stopped.state == "stopped"


# ---------------------------------------------------------------------------
# Pause-aware check_breach + warn (Slice S3, Task 3)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_breach_accounts_for_pause(pg_pool: asyncpg.Pool):
    """check_breach is pause-aware: deadline + total_paused_seconds is the
    effective deadline.

    A running clock whose RAW deadline is just past now but whose accumulated
    pause time pushes the effective deadline into the future must NOT breach.
    A running clock whose effective deadline is already past must breach.
    """
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())

    # Case A: raw deadline 1 minute ago, but 1 hour of accumulated pause →
    # effective deadline ~59 minutes in the future → NOT breached.
    tid_a = f"tenant-breach-pause-future-{uuid.uuid4()}"
    cid_a = uuid.uuid4()
    # Case B: raw deadline 1 hour ago, 1 minute of accumulated pause →
    # effective deadline ~59 minutes ago → breached.
    tid_b = f"tenant-breach-pause-past-{uuid.uuid4()}"
    cid_b = uuid.uuid4()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO clocks
                  (clock_id, tenant_id, case_id, clock_type, state, urgency,
                   duration_calendar_days, started_at, deadline,
                   paused_at, total_paused_seconds, breached_at)
                VALUES (gen_random_uuid(), $1, $2, 'decision', 'running', 'standard',
                        7, NOW() - INTERVAL '8 days', NOW() - INTERVAL '1 minute',
                        NULL, 3600.0, NULL)
                """,
                tid_a,
                cid_a,
            )
            result_a = await svc.check_breach(conn, tenant_id=tid_a, case_id=cid_a)

            await conn.execute(
                """
                INSERT INTO clocks
                  (clock_id, tenant_id, case_id, clock_type, state, urgency,
                   duration_calendar_days, started_at, deadline,
                   paused_at, total_paused_seconds, breached_at)
                VALUES (gen_random_uuid(), $1, $2, 'decision', 'running', 'standard',
                        7, NOW() - INTERVAL '8 days', NOW() - INTERVAL '1 hour',
                        NULL, 60.0, NULL)
                """,
                tid_b,
                cid_b,
            )
            result_b = await svc.check_breach(conn, tenant_id=tid_b, case_id=cid_b)

            breached_row = await conn.fetchrow(
                "SELECT envelope->>'schema_ref' AS schema_ref FROM shared.outbox"
                " WHERE tenant_id = $1 AND envelope->'payload'->>'case_id' = $2"
                " ORDER BY event_id DESC LIMIT 1",
                tid_b,
                str(cid_b),
            )

    # Case A: pause pushed the effective deadline into the future → no breach.
    assert result_a is None

    # Case B: effective deadline already passed → breached + event emitted.
    assert result_b is not None
    assert result_b.state == "breached"
    assert breached_row is not None
    assert breached_row["schema_ref"] == "sim.clock/ClockBreached/v1"


@pytest.mark.asyncio
async def test_warn_sets_warned_at_once_and_emits(pg_pool: asyncpg.Pool):
    """warn() sets warned_at + emits CLOCK_AT_RISK once; a 2nd warn is a no-op."""
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("standard")
    tid = f"tenant-warn-{uuid.uuid4()}"
    cid = uuid.uuid4()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)

            first = await svc.warn(conn, tenant_id=tid, case_id=cid)

            warned_at = await conn.fetchval(
                "SELECT warned_at FROM clocks WHERE case_id = $1 AND clock_type = 'decision'",
                cid,
            )
            at_risk_count_1 = await conn.fetchval(
                "SELECT count(*) FROM shared.outbox"
                " WHERE tenant_id = $1 AND envelope->'payload'->>'case_id' = $2"
                " AND envelope->>'schema_ref' = 'sim.clock/ClockAtRisk/v1'",
                tid,
                str(cid),
            )

            second = await svc.warn(conn, tenant_id=tid, case_id=cid)

            at_risk_count_2 = await conn.fetchval(
                "SELECT count(*) FROM shared.outbox"
                " WHERE tenant_id = $1 AND envelope->'payload'->>'case_id' = $2"
                " AND envelope->>'schema_ref' = 'sim.clock/ClockAtRisk/v1'",
                tid,
                str(cid),
            )

    assert first is not None
    assert warned_at is not None
    assert at_risk_count_1 == 1
    # Idempotent: 2nd warn returns None and emits no new event.
    assert second is None
    assert at_risk_count_2 == 1
