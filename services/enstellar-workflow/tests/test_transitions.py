"""Integration tests for TransitionEngine.

CRITICAL: This file contains the invariant proof for T08.
test_engine_denied_without_signoff_raises_guard_error proves that the
adverse-transition guard cannot be bypassed even by direct engine call.
"""
import uuid

import asyncpg
import pytest

from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.guards import GuardError
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from tests.conftest import make_case


@pytest.mark.asyncio
async def test_engine_intake_to_completeness_check_emits_workflow_event(pg_pool: asyncpg.Pool):
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            updated, _event_id = await engine.apply(conn, req)

    assert updated.status.value == "completeness_check"

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT from_state, to_state FROM workflow_events "
            "WHERE case_id = $1 AND to_state = 'completeness_check'",
            created.case_id,
        )

    assert row is not None
    assert row["from_state"] == "intake"
    assert row["to_state"] == "completeness_check"


@pytest.mark.asyncio
async def test_engine_transition_emits_outbox_row(pg_pool: asyncpg.Pool):
    """Transition must write an outbox row in the same transaction."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await engine.apply(conn, req)

    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' = 'sim.case.lifecycle/CaseStateChanged/v1'",
            str(created.case_id),
        )

    assert count >= 1


@pytest.mark.asyncio
async def test_engine_updates_status_in_workflow_instances(pg_pool: asyncpg.Pool):
    from enstellar_workflow.cases.repository import CaseRepository
    from canonical_model import Status

    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="auto_determination",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await engine.apply(conn, req)

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)

    assert fetched is not None
    assert fetched.status == Status.auto_determination


@pytest.mark.asyncio
async def test_engine_raises_value_error_for_missing_case(pg_pool: asyncpg.Pool):
    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=uuid.uuid4(),  # does not exist
        tenant_id="tenant-t08",
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id="corr-missing",
    )

    with pytest.raises(ValueError, match="not found"):
        async with pg_pool.acquire() as conn:
            async with conn.transaction():
                await engine.apply(conn, req)


# ============================================================
# INVARIANT #1 PROOF — This test is SACRED. Never weaken it.
# ============================================================


@pytest.mark.asyncio
async def test_engine_denied_without_signoff_raises_guard_error(pg_pool: asyncpg.Pool):
    """INVARIANT #1: Direct call to TransitionEngine.apply with to_state='denied'
    and human_signoff_recorded=False MUST raise GuardError.

    This test proves the guard cannot be bypassed even at the engine level,
    before any HTTP layer is involved.
    """
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="denied",
        actor_id="direct-api-caller",
        actor_type="service",
        correlation_id=created.correlation_id,
        human_signoff_recorded=False,  # <-- no sign-off
    )

    with pytest.raises(GuardError) as exc_info:
        async with pg_pool.acquire() as conn:
            async with conn.transaction():
                await engine.apply(conn, req)

    assert "human sign-off" in str(exc_info.value)
    assert "denied" in str(exc_info.value)

    # Verify NO workflow_events row was written (transaction must have rolled back)
    async with pg_pool.acquire() as conn:
        we_count = await conn.fetchval(
            "SELECT COUNT(*) FROM workflow_events "
            "WHERE case_id = $1 AND to_state = 'denied'",
            created.case_id,
        )
    assert we_count == 0, (
        "INVARIANT VIOLATED: a denied workflow_events row was written "
        "without human sign-off"
    )


@pytest.mark.asyncio
async def test_engine_denied_with_signoff_succeeds(pg_pool: asyncpg.Pool):
    """Transition to denied IS allowed when human_signoff_recorded=True."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="denied",
        actor_id="reviewer-001",
        actor_type="user",
        correlation_id=created.correlation_id,
        human_signoff_recorded=True,  # <-- sign-off present
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            updated, _event_id = await engine.apply(conn, req)

    assert updated.status.value == "denied"


@pytest.mark.asyncio
async def test_adverse_transition_writes_structured_outbox_row(pg_pool: asyncpg.Pool):
    """Adverse transition writes BOTH case.state.transitioned AND case.adverse.structured to outbox."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="denied",
        actor_id="reviewer-001",
        actor_type="user",
        correlation_id=created.correlation_id,
        human_signoff_recorded=True,
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await engine.apply(conn, req)

    async with pg_pool.acquire() as conn:
        transitioned_count = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' = 'sim.case.lifecycle/CaseStateChanged/v1'",
            str(created.case_id),
        )
        structured_count = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' = 'sim.case.lifecycle/AdverseDetermination/v1'",
            str(created.case_id),
        )

    assert transitioned_count >= 1, "Missing CaseStateChanged outbox row"
    assert structured_count >= 1, "Missing AdverseDetermination outbox row"


@pytest.mark.asyncio
async def test_notify_platform_calls_platform_client(pg_pool):
    """platform_client.post_transition() is called after a successful apply()."""
    from unittest.mock import AsyncMock, patch
    from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
    from enstellar_workflow.cases.repository import CaseRepository
    from tests.conftest import make_case

    case = make_case()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    engine = TransitionEngine()
    platform_calls: list[dict] = []

    async def fake_post_transition(*, req, from_state, event_id):
        platform_calls.append({"req": req, "from_state": from_state})

    with patch.object(engine._platform_client, "post_transition", side_effect=fake_post_transition):
        async with pg_pool.acquire() as conn:
            async with conn.transaction():
                result_case, event_id = await engine.apply(
                    conn,
                    TransitionRequest(
                        case_id=case.case_id,
                        tenant_id=case.tenant_id,
                        to_state="clinical_review",
                        actor_id="system",
                        actor_type="system",
                        correlation_id=case.correlation_id,
                        human_signoff_recorded=False,
                    ),
                )
        # notify_platform called OUTSIDE the transaction
        req = TransitionRequest(
            case_id=case.case_id,
            tenant_id=case.tenant_id,
            to_state="clinical_review",
            actor_id="system",
            actor_type="system",
            correlation_id=case.correlation_id,
            human_signoff_recorded=False,
        )
        await engine.notify_platform(req, from_state=case.status.value, event_id=event_id)

    assert len(platform_calls) == 1
    assert platform_calls[0]["from_state"] == case.status.value
    assert platform_calls[0]["req"].to_state == "clinical_review"


@pytest.mark.asyncio
async def test_platform_failure_does_not_propagate(pg_pool):
    """Platform HTTP failure is swallowed in notify_platform() — Enstellar write is unaffected."""
    import httpx as httpx_mod
    from unittest.mock import AsyncMock, patch
    from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
    from enstellar_workflow.cases.repository import CaseRepository
    from tests.conftest import make_case

    case = make_case()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    engine = TransitionEngine()

    async def raise_network(*, req, from_state, event_id):
        raise httpx_mod.ConnectError("connection refused")

    req = TransitionRequest(
        case_id=case.case_id,
        tenant_id=case.tenant_id,
        to_state="clinical_review",
        actor_id="system",
        actor_type="system",
        correlation_id=case.correlation_id,
        human_signoff_recorded=False,
    )

    # apply() — normal Enstellar write
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            result_case, event_id = await engine.apply(conn, req)

    # notify_platform() swallows the network error
    with patch.object(engine._platform_client, "post_transition", side_effect=raise_network):
        # Must NOT raise
        await engine.notify_platform(req, from_state=case.status.value, event_id=event_id)

    # Enstellar write happened
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status FROM workflow_instances WHERE case_id = $1 AND tenant_id = $2",
            case.case_id, case.tenant_id,
        )
    assert row["status"] == "clinical_review"
