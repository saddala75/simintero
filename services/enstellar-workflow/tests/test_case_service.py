"""Integration tests for CaseService — requires PostgreSQL (Testcontainers)."""
import uuid
from datetime import timezone

import asyncpg
import pytest

from canonical_model import Status
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.guards import GuardError
from enstellar_workflow.engine.transitions import TransitionRequest
from tests.conftest import make_case


@pytest.mark.asyncio
async def test_create_case_returns_case(pg_pool: asyncpg.Pool):
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    assert created.case_id == case.case_id
    assert created.tenant_id == case.tenant_id
    assert created.status == Status.intake


@pytest.mark.asyncio
async def test_create_case_emits_intake_outbox_event(pg_pool: asyncpg.Pool):
    """create_case must publish a case.intake.received outbox event."""
    service = CaseService(pg_pool)
    case = make_case(correlation_id=f"corr-svc-intake-{uuid.uuid4()}")
    await service.create_case(case)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT envelope->>'schema_ref' AS schema_ref, tenant_id FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1",
            str(case.case_id),
        )

    assert row is not None
    assert row["schema_ref"] == "sim.case.lifecycle/CaseIntakeReceived/v1"
    assert row["tenant_id"] == case.tenant_id


@pytest.mark.asyncio
async def test_create_case_idempotent_on_correlation_id(pg_pool: asyncpg.Pool):
    """Calling create_case twice with the same correlation_id returns the same case."""
    service = CaseService(pg_pool)
    correlation_id = f"corr-idem-svc-{uuid.uuid4()}"

    case1 = make_case(correlation_id=correlation_id)
    case2 = make_case(correlation_id=correlation_id)  # different case_id, same corr_id

    first = await service.create_case(case1)
    second = await service.create_case(case2)

    assert first.case_id == second.case_id  # same persisted row returned


@pytest.mark.asyncio
async def test_create_case_idempotent_no_duplicate_outbox_event(pg_pool: asyncpg.Pool):
    """Duplicate create_case calls must NOT produce a second outbox event."""
    service = CaseService(pg_pool)
    correlation_id = f"corr-idem-outbox-{uuid.uuid4()}"

    case = make_case(correlation_id=correlation_id)
    await service.create_case(case)
    await service.create_case(case)  # duplicate

    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox "
            "WHERE envelope->>'correlation_id' = $1 "
            "AND envelope->>'schema_ref' = 'sim.case.lifecycle/CaseIntakeReceived/v1'",
            correlation_id,
        )

    assert count == 1  # exactly one, not two


@pytest.mark.asyncio
async def test_transition_changes_case_status(pg_pool: asyncpg.Pool):
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    )
    updated = await service.transition(req)

    assert updated.status == Status.completeness_check


@pytest.mark.asyncio
async def test_transition_denied_without_signoff_raises_guard_error(pg_pool: asyncpg.Pool):
    """INVARIANT #1: CaseService.transition must propagate GuardError for adverse transitions."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="denied",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
        human_signoff_recorded=False,
    )

    with pytest.raises(GuardError, match="human sign-off"):
        await service.transition(req)


@pytest.mark.asyncio
async def test_get_events_returns_events_in_order(pg_pool: asyncpg.Pool):
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    # Apply two transitions
    await service.transition(TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    ))
    await service.transition(TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="auto_determination",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    ))

    events = await service.get_events(created.case_id, created.tenant_id)

    assert len(events) == 2
    assert events[0]["from_state"] == "intake"
    assert events[0]["to_state"] == "completeness_check"
    assert events[1]["from_state"] == "completeness_check"
    assert events[1]["to_state"] == "auto_determination"


@pytest.mark.asyncio
async def test_get_events_returns_empty_list_for_new_case(pg_pool: asyncpg.Pool):
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    events = await service.get_events(created.case_id, created.tenant_id)

    assert events == []


@pytest.mark.asyncio
async def test_get_events_tenant_isolation(pg_pool: asyncpg.Pool):
    """Events must not be returned for a different tenant_id."""
    service = CaseService(pg_pool)
    case = make_case(tenant_id="tenant-svc-iso")
    created = await service.create_case(case)

    await service.transition(TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    ))

    events = await service.get_events(created.case_id, "tenant-other")
    assert events == []
