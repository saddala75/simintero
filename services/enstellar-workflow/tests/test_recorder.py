"""Integration tests for EventRecorder — requires PostgreSQL (Testcontainers)."""
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest

from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.engine.recorder import EventRecorder
from tests.conftest import make_case


@pytest.mark.asyncio
async def test_recorder_inserts_event_row(pg_pool: asyncpg.Pool):
    # Setup: insert a case row first (workflow_events has FK to workflow_instances)
    case = make_case()
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    recorder = EventRecorder()
    occurred_at = datetime.now(timezone.utc)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.record(
                conn,
                case_id=case.case_id,
                tenant_id=case.tenant_id,
                event_type="case.state.transitioned",
                from_state="intake",
                to_state="completeness_check",
                actor_id="system",
                actor_type="system",
                correlation_id=case.correlation_id,
                payload={"reason": "auto"},
                occurred_at=occurred_at,
            )

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT event_type, from_state, to_state, actor_id, actor_type "
            "FROM workflow_events WHERE case_id = $1",
            case.case_id,
        )

    assert row is not None
    assert row["event_type"] == "case.state.transitioned"
    assert row["from_state"] == "intake"
    assert row["to_state"] == "completeness_check"
    assert row["actor_id"] == "system"
    assert row["actor_type"] == "system"


@pytest.mark.asyncio
async def test_recorder_propagates_tenant_id(pg_pool: asyncpg.Pool):
    case = make_case(tenant_id="tenant-rec-check")
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    recorder = EventRecorder()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.record(
                conn,
                case_id=case.case_id,
                tenant_id=case.tenant_id,
                event_type="case.state.transitioned",
                from_state="intake",
                to_state="completeness_check",
                actor_id="system",
                actor_type="system",
                correlation_id=case.correlation_id,
                payload={},
            )

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT tenant_id FROM workflow_events WHERE case_id = $1",
            case.case_id,
        )

    assert row is not None
    assert row["tenant_id"] == "tenant-rec-check"


@pytest.mark.asyncio
async def test_recorder_stores_payload(pg_pool: asyncpg.Pool):
    case = make_case()
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    recorder = EventRecorder()
    payload = {"extra_key": "extra_value", "count": 42}

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.record(
                conn,
                case_id=case.case_id,
                tenant_id=case.tenant_id,
                event_type="case.state.transitioned",
                from_state="intake",
                to_state="completeness_check",
                actor_id="system",
                actor_type="system",
                correlation_id=case.correlation_id,
                payload=payload,
            )

    async with pg_pool.acquire() as conn:
        raw = await conn.fetchval(
            "SELECT payload FROM workflow_events WHERE case_id = $1",
            case.case_id,
        )

    # asyncpg may return JSONB as dict or str
    import json as _json
    stored = _json.loads(raw) if isinstance(raw, str) else raw
    assert stored["extra_key"] == "extra_value"
    assert stored["count"] == 42


@pytest.mark.asyncio
async def test_recorder_multiple_events_ordered_by_id(pg_pool: asyncpg.Pool):
    """Multiple events for the same case must be stored and retrieval order matches insertion."""
    case = make_case()
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    recorder = EventRecorder()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.record(
                conn,
                case_id=case.case_id,
                tenant_id=case.tenant_id,
                event_type="case.state.transitioned",
                from_state="intake",
                to_state="completeness_check",
                actor_id="system",
                actor_type="system",
                correlation_id=case.correlation_id,
                payload={},
            )
        async with conn.transaction():
            await recorder.record(
                conn,
                case_id=case.case_id,
                tenant_id=case.tenant_id,
                event_type="case.state.transitioned",
                from_state="completeness_check",
                to_state="auto_determination",
                actor_id="system",
                actor_type="system",
                correlation_id=case.correlation_id,
                payload={},
            )

    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT from_state, to_state FROM workflow_events "
            "WHERE case_id = $1 ORDER BY id ASC",
            case.case_id,
        )

    assert len(rows) == 2
    assert rows[0]["from_state"] == "intake"
    assert rows[0]["to_state"] == "completeness_check"
    assert rows[1]["from_state"] == "completeness_check"
    assert rows[1]["to_state"] == "auto_determination"
