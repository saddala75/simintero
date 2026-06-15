"""Integration test for OutboxRelay — requires PostgreSQL + Kafka."""
import asyncpg
import pytest

from simintero_outbox import SchemaRef, make_envelope
from simintero_tenant_context import tenant_transaction
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

    tenant_id = "tenant-test"
    event = make_envelope(
        SchemaRef.CASE_STATE_CHANGED,
        tenant_id=tenant_id,
        actor_id="system",
        actor_type="system",
        correlation_id="corr-relay-test",
        payload={
            "case_id": "22222222-2222-2222-2222-222222222222",
            "from_state": "intake",
            "to_state": "completeness_check",
        },
    )

    # Remove any unpublished rows left by earlier tests so the batch count is deterministic.
    # The test connection is a superuser, which bypasses RLS — no role switch needed.
    async with pg_pool.acquire() as conn:
        await conn.execute("DELETE FROM shared.outbox WHERE published_at IS NULL")

    async with tenant_transaction(pg_pool, tenant_id) as conn:
        await publisher.publish(conn, event)

    relay = OutboxRelay(pg_pool, producer)
    published = await relay._relay_batch(10)
    assert published == 1

    await producer.stop()

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT published_at FROM shared.outbox WHERE event_id = $1", event.event_id
        )
    assert row["published_at"] is not None
