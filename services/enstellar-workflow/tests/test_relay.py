"""Integration test for OutboxRelay — requires PostgreSQL + Kafka."""
import asyncio
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest

from enstellar_events import EventEnvelope, Actor, ActorType, decode
from enstellar_workflow.config import get_settings
from enstellar_workflow.kafka.producer import KafkaProducer
from enstellar_workflow.outbox.publisher import OutboxPublisher
from enstellar_workflow.outbox.relay import OutboxRelay


@pytest.mark.asyncio
async def test_relay_publishes_to_kafka_and_marks_published(
    pg_pool: asyncpg.Pool, kafka_bootstrap: str, monkeypatch
):
    monkeypatch.setenv("WORKFLOW_KAFKA_BOOTSTRAP_SERVERS", kafka_bootstrap)
    import enstellar_workflow.config as cfg_module
    cfg_module._settings = None

    publisher = OutboxPublisher()
    producer = KafkaProducer()
    await producer.start()

    event = EventEnvelope(
        event_id=uuid.uuid4(),
        tenant_id="tenant-test",
        case_id=uuid.uuid4(),
        correlation_id="corr-relay-test",
        schema_ref="sim.case.lifecycle/CaseStateChanged/v1",
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="system", type=ActorType.SYSTEM),
        payload={"from_state": "intake", "to_state": "completeness_check"},
    )

    # Remove any unpublished rows left by earlier tests so the batch count is deterministic.
    async with pg_pool.acquire() as conn:
        await conn.execute("DELETE FROM outbox WHERE published_at IS NULL")

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await publisher.publish(conn, event)

    relay = OutboxRelay(pg_pool, producer)
    published = await relay._relay_batch(10)
    assert published == 1

    await producer.stop()

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT published_at FROM outbox WHERE event_id = $1", event.event_id
        )
    assert row["published_at"] is not None
