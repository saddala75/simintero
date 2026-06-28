"""Tests for IdempotentKafkaConsumer deduplication logic."""
import asyncpg
import pytest

from canonical_model import EventEnvelope
from simintero_outbox import SchemaRef, make_envelope
from enstellar_workflow.kafka.consumer import IdempotentKafkaConsumer


class _RecordingConsumer(IdempotentKafkaConsumer):
    def __init__(self, pool, topics):
        super().__init__(pool, topics, group_id="test-group")
        self.handled: list[EventEnvelope] = []

    async def handle(self, event: EventEnvelope) -> None:
        self.handled.append(event)


def _make_event() -> EventEnvelope:
    return make_envelope(
        SchemaRef.CASE_STATE_CHANGED,
        tenant_id="tenant-test",
        actor_id="system",
        actor_type="system",
        correlation_id="corr-idem",
        payload={},
    )


@pytest.mark.asyncio
async def test_first_event_is_not_processed_before_mark(pg_pool: asyncpg.Pool):
    consumer = _RecordingConsumer(pg_pool, ["sim.case.lifecycle"])
    event = _make_event()
    assert not await consumer._is_processed(event)


@pytest.mark.asyncio
async def test_mark_processed_makes_event_seen(pg_pool: asyncpg.Pool):
    consumer = _RecordingConsumer(pg_pool, ["sim.case.lifecycle"])
    event = _make_event()
    await consumer._mark_processed(event)
    assert await consumer._is_processed(event)


@pytest.mark.asyncio
async def test_duplicate_event_is_skipped(pg_pool: asyncpg.Pool):
    consumer = _RecordingConsumer(pg_pool, ["sim.case.lifecycle"])
    event = _make_event()
    await consumer._mark_processed(event)
    # Second mark should be idempotent (no error)
    await consumer._mark_processed(event)
    assert await consumer._is_processed(event)


@pytest.mark.asyncio
async def test_same_event_different_consumer_group(pg_pool: asyncpg.Pool):
    c1 = _RecordingConsumer(pg_pool, ["sim.case.lifecycle"])
    c1._group_id = "group-a"
    c2 = _RecordingConsumer(pg_pool, ["sim.case.lifecycle"])
    c2._group_id = "group-b"

    event = _make_event()
    assert not await c1._is_processed(event)
    assert not await c2._is_processed(event)
    await c1._mark_processed(event)
    assert await c1._is_processed(event)
    assert not await c2._is_processed(event)
