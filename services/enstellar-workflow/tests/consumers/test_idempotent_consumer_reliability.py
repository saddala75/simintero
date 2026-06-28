"""Unit tests for the retry/DLQ mechanics of IdempotentKafkaConsumer.

Tests call the helper methods directly (no Kafka needed).
The full run() loop is covered by existing consumer integration tests.
"""
import uuid
import pytest
from unittest.mock import AsyncMock

from simintero_outbox import SchemaRef, make_envelope
from enstellar_workflow.kafka.consumer import IdempotentKafkaConsumer


class _Noop(IdempotentKafkaConsumer):
    """Minimal concrete subclass for testing base-class helpers."""
    def __init__(self, pool):
        super().__init__(pool, ["test-topic"], group_id="test-group")

    async def handle(self, event):
        pass


def _evt():
    return make_envelope(
        SchemaRef.CASE_STATE_CHANGED,
        tenant_id="tenant-test",
        actor_id="system",
        actor_type="service",
        correlation_id=str(uuid.uuid4()),
        payload={"state": "clinical_review"},
    )


@pytest.mark.asyncio
async def test_not_processed_before_mark(pg_pool):
    c = _Noop(pg_pool)
    assert not await c._is_processed(_evt())


@pytest.mark.asyncio
async def test_mark_processed_makes_is_processed_true(pg_pool):
    c = _Noop(pg_pool)
    ev = _evt()
    await c._mark_processed(ev)
    assert await c._is_processed(ev)


@pytest.mark.asyncio
async def test_mark_processed_twice_is_idempotent(pg_pool):
    c = _Noop(pg_pool)
    ev = _evt()
    await c._mark_processed(ev)
    # Should not raise UniqueViolationError
    await c._mark_processed(ev)
    assert await c._is_processed(ev)


@pytest.mark.asyncio
async def test_record_failure_increments(pg_pool):
    c = _Noop(pg_pool)
    ev = _evt()
    count1 = await c._record_failure(ev, ValueError("err1"))
    assert count1 == 1
    count2 = await c._record_failure(ev, ValueError("err2"))
    assert count2 == 2
    count3 = await c._record_failure(ev, ValueError("err3"))
    assert count3 == 3


@pytest.mark.asyncio
async def test_send_to_dlq_writes_db_row(pg_pool):
    c = _Noop(pg_pool)
    ev = _evt()
    exc = RuntimeError("poison message")
    await c._send_to_dlq(ev, "test-topic", exc)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT topic, error FROM shared.consumer_dlq "
            "WHERE event_id=$1 AND consumer_group=$2",
            str(ev.event_id), "test-group",
        )
    assert row is not None
    assert row["topic"] == "test-topic"
    assert "poison message" in row["error"]


@pytest.mark.asyncio
async def test_send_to_dlq_publishes_to_kafka_when_producer_set(pg_pool):
    c = _Noop(pg_pool)
    mock_producer = AsyncMock()
    c._producer = mock_producer
    ev = _evt()
    await c._send_to_dlq(ev, "sim.case.lifecycle", RuntimeError("fail"))
    mock_producer.send.assert_awaited_once()
    topic_arg = mock_producer.send.call_args[0][0]
    assert topic_arg == "sim.case.lifecycle.dead-letter"


@pytest.mark.asyncio
async def test_send_to_dlq_no_kafka_when_producer_not_set(pg_pool):
    c = _Noop(pg_pool)
    # _producer is None by default — should not raise
    ev = _evt()
    await c._send_to_dlq(ev, "sim.case.lifecycle", RuntimeError("fail"))
    # No assertion needed — if it raised, the test would fail
