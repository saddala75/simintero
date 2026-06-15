"""Integration tests for OutboxPublisher — requires real PostgreSQL."""
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest

from enstellar_events import EventEnvelope, Actor, ActorType
from enstellar_workflow.outbox.publisher import OutboxPublisher


def _make_event(tenant_id: str = "tenant-test") -> EventEnvelope:
    return EventEnvelope(
        event_id=uuid.uuid4(),
        tenant_id=tenant_id,
        case_id=uuid.uuid4(),
        correlation_id="corr-001",
        schema_ref="sim.case.lifecycle/CaseStateChanged/v1",
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="system", type=ActorType.SYSTEM),
        payload={"from_state": "intake", "to_state": "completeness_check"},
    )


@pytest.mark.asyncio
async def test_publisher_inserts_outbox_row(pg_pool: asyncpg.Pool):
    publisher = OutboxPublisher()
    event = _make_event()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await publisher.publish(conn, event)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT event_id, tenant_id, published_at FROM outbox WHERE event_id = $1",
            event.event_id,
        )
    assert row is not None
    assert str(row["event_id"]) == str(event.event_id)
    assert row["tenant_id"] == "tenant-test"
    assert row["published_at"] is None


@pytest.mark.asyncio
async def test_publisher_deduplicates_same_event_id(pg_pool: asyncpg.Pool):
    publisher = OutboxPublisher()
    event = _make_event()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await publisher.publish(conn, event)
        async with conn.transaction():
            await publisher.publish(conn, event)

    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM outbox WHERE event_id = $1", event.event_id
        )
    assert count == 1


@pytest.mark.asyncio
async def test_publisher_rejects_missing_tenant_id(pg_pool: asyncpg.Pool):
    publisher = OutboxPublisher()
    import pydantic
    with pytest.raises((ValueError, pydantic.ValidationError)):
        EventEnvelope(
            event_id=uuid.uuid4(),
            tenant_id="",
            correlation_id="corr",
            schema_ref="sim.case.lifecycle/CaseStateChanged/v1",
            occurred_at=datetime.now(timezone.utc),
            actor=Actor(id="system", type=ActorType.SYSTEM),
            payload={},
        )
