"""Integration tests for OutboxPublisher → shared.outbox — requires real PostgreSQL."""
import json

import asyncpg
import pytest

from simintero_outbox import SchemaRef, make_envelope
from simintero_tenant_context import tenant_transaction
from enstellar_workflow.outbox.publisher import OutboxPublisher


def _make_event(tenant_id: str = "tenant-test"):
    return make_envelope(
        SchemaRef.CASE_STATE_CHANGED,
        tenant_id=tenant_id,
        actor_id="system",
        actor_type="system",
        correlation_id="corr-001",
        payload={
            "case_id": "11111111-1111-1111-1111-111111111111",
            "from_state": "intake",
            "to_state": "completeness_check",
        },
    )


@pytest.mark.asyncio
async def test_publisher_inserts_outbox_row(pg_pool: asyncpg.Pool):
    publisher = OutboxPublisher()
    event = _make_event()

    async with tenant_transaction(pg_pool, "tenant-test") as conn:
        await publisher.publish(conn, event)

    async with tenant_transaction(pg_pool, "tenant-test") as conn:
        row = await conn.fetchrow(
            "SELECT event_id, topic, key, envelope, tenant_id, published_at "
            "FROM shared.outbox WHERE event_id = $1",
            event.event_id,
        )
    assert row is not None
    assert row["event_id"] == event.event_id
    assert row["topic"] == "sim.case.lifecycle"
    assert row["key"] == "corr-001"
    assert row["tenant_id"] == "tenant-test"
    assert row["published_at"] is None
    envelope = json.loads(row["envelope"]) if isinstance(row["envelope"], str) else row["envelope"]
    assert envelope["tenant"]["tenant_id"] == "tenant-test"
    assert envelope["payload"]["case_id"] == "11111111-1111-1111-1111-111111111111"


@pytest.mark.asyncio
async def test_publisher_deduplicates_same_event_id(pg_pool: asyncpg.Pool):
    publisher = OutboxPublisher()
    event = _make_event()

    async with tenant_transaction(pg_pool, "tenant-test") as conn:
        await publisher.publish(conn, event)
    async with tenant_transaction(pg_pool, "tenant-test") as conn:
        await publisher.publish(conn, event)

    async with tenant_transaction(pg_pool, "tenant-test") as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox WHERE event_id = $1", event.event_id
        )
    assert count == 1
