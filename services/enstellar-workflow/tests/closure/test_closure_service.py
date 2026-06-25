"""P3 — ClosureService.close_case (explicit terminal close).

Closing a settled case (e.g. `denied`):
  * transition case -> closed, with disposition = the prior settled status
  * stamp workflow_instances.disposition / closed_at / closed_by
  * stop the decision clock (and any appeal clock)
  * emit a CaseClosed outbox event carrying the disposition

Guards:
  * an in-flight case (clinical_review) -> NotCloseableError
  * re-closing an already-closed case -> AlreadyClosedError
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest

from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.closure.service import (
    AlreadyClosedError,
    ClosureService,
    NotCloseableError,
)
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from tests.conftest import make_case


async def _drive_to(pool: asyncpg.Pool, created, to_state: str) -> None:
    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state=to_state,
        actor_id="reviewer-001",
        actor_type="user",
        correlation_id=str(uuid.uuid4()),
        human_signoff_recorded=True,
    )
    async with pool.acquire() as conn:
        async with conn.transaction():
            await engine.apply(conn, req)


async def _seed_denied(pool: asyncpg.Pool, tenant_id: str):
    """Create a fresh case and drive it to `denied` (a settled, closeable state)."""
    created = await CaseService(pool).create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pool, created, "denied")
    return created


@pytest.mark.asyncio
async def test_close_denied_case(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-close-{uuid.uuid4()}"
    created = await _seed_denied(pg_pool, tenant_id)

    result = await ClosureService(pg_pool).close_case(
        case_id=created.case_id,
        tenant_id=tenant_id,
        closed_by="ops-1",
        reason="window lapsed",
    )

    assert result["case_id"] == str(created.case_id)
    assert result["status"] == "closed"
    assert result["disposition"] == "denied"

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, disposition, closed_at, closed_by "
            "FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert row["status"] == "closed"
        assert row["disposition"] == "denied"
        assert row["closed_at"] is not None
        assert row["closed_by"] == "ops-1"

        # CaseClosed outbox event carrying the disposition
        closed_payload = await conn.fetchrow(
            "SELECT envelope->'payload' AS payload FROM shared.outbox "
            "WHERE envelope->>'schema_ref' = 'sim.case.lifecycle/CaseClosed/v1' "
            "AND envelope->'payload'->>'case_id' = $1",
            str(created.case_id),
        )
        assert closed_payload is not None
        import json
        payload = closed_payload["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        assert payload["disposition"] == "denied"

        # the decision clock (started on intake) is now stopped
        clock_state = await conn.fetchval(
            "SELECT state FROM clocks "
            "WHERE case_id=$1 AND tenant_id=$2 AND clock_type='decision'",
            created.case_id, tenant_id,
        )
        if clock_state is not None:
            assert clock_state == "stopped"


@pytest.mark.asyncio
async def test_close_in_flight_case_raises_not_closeable(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-close-{uuid.uuid4()}"
    created = await CaseService(pg_pool).create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pg_pool, created, "clinical_review")

    with pytest.raises(NotCloseableError):
        await ClosureService(pg_pool).close_case(
            case_id=created.case_id,
            tenant_id=tenant_id,
            closed_by="ops-1",
            reason="should not close an in-flight case",
        )

    async with pg_pool.acquire() as conn:
        status = await conn.fetchval(
            "SELECT status FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert status == "clinical_review"


@pytest.mark.asyncio
async def test_reclose_already_closed_raises(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-close-{uuid.uuid4()}"
    created = await _seed_denied(pg_pool, tenant_id)

    await ClosureService(pg_pool).close_case(
        case_id=created.case_id,
        tenant_id=tenant_id,
        closed_by="ops-1",
        reason="window lapsed",
    )

    with pytest.raises(AlreadyClosedError):
        await ClosureService(pg_pool).close_case(
            case_id=created.case_id,
            tenant_id=tenant_id,
            closed_by="ops-2",
            reason="double close",
        )
