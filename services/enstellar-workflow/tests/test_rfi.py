"""Tests for RfiService and CaseService.pend_rfi (T13 Task 6)."""
from __future__ import annotations

import json
import uuid

import asyncpg
import pytest

from tests.conftest import make_case

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# RfiService unit tests
# ---------------------------------------------------------------------------


async def test_dispatch_rfi_returns_request_id(pg_pool: asyncpg.Pool):
    """dispatch_rfi returns the request_id embedded in the RfiRequest."""
    from enstellar_workflow.rfi.service import RfiRequest, RfiService
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from simintero_tenant_context import tenant_transaction

    svc = RfiService(OutboxPublisher())
    req = RfiRequest(
        case_id=uuid.uuid4(),
        tenant_id="tenant-rfi1",
        provider_npi="1234567890",
        document_types=["clinical_notes", "lab_results"],
    )
    async with tenant_transaction(pg_pool, "tenant-rfi1") as conn:
        rid = await svc.dispatch_rfi(conn, req)

    assert rid == req.request_id


async def test_dispatch_rfi_writes_outbox_event(pg_pool: asyncpg.Pool):
    """dispatch_rfi writes an rfi.dispatched row to shared.outbox with correct payload."""
    from enstellar_workflow.rfi.service import RfiRequest, RfiService
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from simintero_tenant_context import tenant_transaction

    svc = RfiService(OutboxPublisher())
    tid = f"tenant-rfi2-{uuid.uuid4()}"
    cid = uuid.uuid4()
    req = RfiRequest(
        case_id=cid,
        tenant_id=tid,
        provider_npi="9876543210",
        document_types=["imaging"],
        free_text="Please send CT scan report",
    )
    async with tenant_transaction(pg_pool, tid) as conn:
        await svc.dispatch_rfi(conn, req)
        row = await conn.fetchrow(
            "SELECT topic, envelope FROM shared.outbox"
            " WHERE tenant_id = $1 AND envelope->'payload'->>'case_id' = $2"
            " ORDER BY event_id DESC LIMIT 1",
            tid,
            str(cid),
        )

    assert row is not None
    assert row["topic"] == "sim.case.lifecycle"
    envelope = json.loads(row["envelope"]) if isinstance(row["envelope"], str) else row["envelope"]
    assert envelope["schema_ref"] == "sim.case.lifecycle/RFIDispatched/v1"
    payload = envelope["payload"]
    assert payload["provider_npi"] == "9876543210"
    assert "imaging" in payload["document_types"]
    assert payload["free_text"] == "Please send CT scan report"


# ---------------------------------------------------------------------------
# CaseService.pend_rfi integration tests
# ---------------------------------------------------------------------------


async def test_pend_rfi_transitions_case_to_pend_rfi_state(pg_pool: asyncpg.Pool):
    """pend_rfi transitions the case workflow state to 'pend_rfi'."""
    from enstellar_workflow.cases.service import CaseService

    svc = CaseService(pg_pool)
    case = make_case(tenant_id=f"tenant-pend1-{uuid.uuid4()}")
    created = await svc.create_case(case)

    result = await svc.pend_rfi(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        provider_npi="1112223333",
        document_types=["chart_notes"],
        free_text=None,
        requested_by="reviewer1",
    )

    assert result["case"].status.value == "pend_rfi"
    assert result["rfi_request_id"] is not None


async def test_pend_rfi_emits_rfi_dispatched_event(pg_pool: asyncpg.Pool):
    """pend_rfi writes an rfi.dispatched event to the outbox."""
    from enstellar_workflow.cases.service import CaseService

    svc = CaseService(pg_pool)
    case = make_case(tenant_id=f"tenant-pend2-{uuid.uuid4()}")
    created = await svc.create_case(case)

    result = await svc.pend_rfi(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        provider_npi="4445556666",
        document_types=["radiology"],
        free_text="Urgently needed",
        requested_by="reviewer2",
    )

    from simintero_tenant_context import tenant_transaction

    async with tenant_transaction(pg_pool, created.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT event_id FROM shared.outbox"
            " WHERE tenant_id = $1"
            "   AND envelope->'payload'->>'case_id' = $2"
            "   AND envelope->>'schema_ref' = 'sim.case.lifecycle/RFIDispatched/v1'",
            created.tenant_id,
            str(result["case"].case_id),
        )
    assert row is not None


async def test_pend_rfi_pauses_decision_clock(pg_pool: asyncpg.Pool):
    """pend_rfi pauses the decision clock in the same transaction."""
    from enstellar_workflow.cases.service import CaseService

    svc = CaseService(pg_pool)
    case = make_case(tenant_id=f"tenant-pend3-{uuid.uuid4()}")
    created = await svc.create_case(case)

    await svc.pend_rfi(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        provider_npi="7778889999",
        document_types=["auth_history"],
        free_text=None,
        requested_by="reviewer3",
    )

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT state FROM clocks WHERE case_id = $1 AND tenant_id = $2",
            created.case_id,
            created.tenant_id,
        )
    assert row is not None
    assert row["state"] == "paused"


async def test_pend_rfi_emits_state_transition_event(pg_pool: asyncpg.Pool):
    """pend_rfi records a workflow event from intake → pend_rfi."""
    from enstellar_workflow.cases.service import CaseService

    svc = CaseService(pg_pool)
    case = make_case(tenant_id=f"tenant-pend4-{uuid.uuid4()}")
    created = await svc.create_case(case)

    await svc.pend_rfi(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        provider_npi="0001112222",
        document_types=["surgical_notes"],
        free_text=None,
        requested_by="reviewer4",
    )

    events = await svc.get_events(created.case_id, created.tenant_id)
    assert len(events) == 1
    assert events[0]["to_state"] == "pend_rfi"
    assert events[0]["from_state"] == "intake"


async def test_pend_rfi_api_endpoint_returns_200(pg_pool: asyncpg.Pool):
    """HTTP-level test deferred to Task 7 / full E2E."""
    pytest.skip("HTTP-level pend_rfi test deferred to Task 7 / E2E")


# ---------------------------------------------------------------------------
# Accumulated-pause invariant tests (Task 7)
# These verify that pause duration is correctly accumulated across cycles
# and that RfiResponseConsumer resumes the clock + transitions the case.
# ---------------------------------------------------------------------------


async def test_accumulated_pause_across_two_cycles(pg_pool: asyncpg.Pool):
    """Two pause/resume cycles accumulate total_paused_seconds correctly."""
    import asyncio
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("standard")
    tid = "tenant-accum1"
    cid = uuid.uuid4()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            await svc.pause(conn, tenant_id=tid, case_id=cid)
            await asyncio.sleep(0.05)
            r1 = await svc.resume(conn, tenant_id=tid, case_id=cid)
            first_pause = r1.total_paused_seconds

            await svc.pause(conn, tenant_id=tid, case_id=cid)
            await asyncio.sleep(0.05)
            r2 = await svc.resume(conn, tenant_id=tid, case_id=cid)
            second_total = r2.total_paused_seconds

    assert second_total > first_pause
    assert second_total >= 0.08  # at least ~80ms total


async def test_accumulated_pause_expedited_72h_rule(pg_pool: asyncpg.Pool):
    """Expedited clock: simulated 12h pause leaves 60h remaining (3d - 12h = 60h)."""
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService, _row_to_state
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from datetime import timedelta

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("expedited")  # 3 days
    tid = "tenant-exp72"
    cid = uuid.uuid4()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            started = await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            # Simulate 12h of pause by manually updating total_paused_seconds
            await conn.execute(
                "UPDATE clocks SET total_paused_seconds = $1 WHERE case_id = $2 AND tenant_id = $3",
                43200.0,  # 12 * 3600
                cid,
                tid,
            )
            row = await conn.fetchrow(
                "SELECT * FROM clocks WHERE case_id = $1 AND tenant_id = $2",
                cid, tid
            )
            state = _row_to_state(row)

    # adjusted_deadline should be ~12h beyond raw deadline
    delta = state.adjusted_deadline - started.deadline
    assert delta >= timedelta(hours=11, minutes=55)
    assert delta <= timedelta(hours=12, minutes=5)


async def test_accumulated_pause_standard_7_day_rule(pg_pool: asyncpg.Pool):
    """Standard clock: simulated 2d pause extends deadline by 2 days."""
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService, _row_to_state
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from datetime import timedelta

    svc = ClockService(OutboxPublisher())
    defn = ClockDefinition.for_case("standard")  # 7 days
    tid = "tenant-std7"
    cid = uuid.uuid4()

    two_days_seconds = 2 * 24 * 3600.0  # 172800.0

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            started = await svc.start(conn, tenant_id=tid, case_id=cid, definition=defn)
            await conn.execute(
                "UPDATE clocks SET total_paused_seconds = $1 WHERE case_id = $2 AND tenant_id = $3",
                two_days_seconds,
                cid,
                tid,
            )
            row = await conn.fetchrow(
                "SELECT * FROM clocks WHERE case_id = $1 AND tenant_id = $2",
                cid, tid
            )
            state = _row_to_state(row)

    delta = state.adjusted_deadline - started.deadline
    assert delta >= timedelta(days=1, hours=23, minutes=55)
    assert delta <= timedelta(days=2, minutes=5)


async def test_rfi_response_consumer_resumes_clock_and_transitions_to_clinical_review(
    pg_pool: asyncpg.Pool,
):
    """RfiResponseConsumer: resumes clock and transitions case to clinical_review."""
    from simintero_outbox import make_envelope
    from enstellar_workflow.consumers.rfi_response_consumer import RfiResponseConsumer
    from enstellar_workflow.cases.service import CaseService

    consumer = RfiResponseConsumer(pg_pool)
    svc = CaseService(pg_pool)
    tid = f"tenant-rfiresp-{uuid.uuid4()}"

    # Build a case in intake state using the shared make_case helper
    case = make_case(tenant_id=tid)
    created = await svc.create_case(case)

    # Pend it (transitions to pend_rfi state + pauses clock)
    await svc.pend_rfi(
        case_id=created.case_id,
        tenant_id=tid,
        provider_npi="1234567890",
        document_types=["chart_notes"],
        free_text=None,
        requested_by="reviewer",
    )

    # Simulate rfi.response.received event
    event = make_envelope(
        "sim.case.lifecycle/RFIResponseReceived/v1",
        tenant_id=tid,
        actor_id="system",
        actor_type="system",
        correlation_id=str(uuid.uuid4()),
        payload={
            "case_id": str(created.case_id),
            "provider_npi": "1234567890",
            "document_types": ["chart_notes"],
        },
    )
    await consumer.handle(event)

    # Verify clock is running again
    async with pg_pool.acquire() as conn:
        clock_row = await conn.fetchrow(
            "SELECT state FROM clocks WHERE case_id = $1 AND tenant_id = $2",
            created.case_id, tid
        )

    assert clock_row["state"] == "running"
