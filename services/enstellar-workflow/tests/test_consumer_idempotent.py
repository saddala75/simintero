"""Tests for IdempotentKafkaConsumer deduplication logic."""
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest

from enstellar_events import EventEnvelope, Actor, ActorType
from enstellar_workflow.kafka.consumer import IdempotentKafkaConsumer


class _RecordingConsumer(IdempotentKafkaConsumer):
    def __init__(self, pool, topics):
        super().__init__(pool, topics, group_id="test-group")
        self.handled: list[EventEnvelope] = []

    async def handle(self, event: EventEnvelope) -> None:
        self.handled.append(event)


def _make_event() -> EventEnvelope:
    return EventEnvelope(
        event_id=uuid.uuid4(),
        tenant_id="tenant-test",
        correlation_id="corr-idem",
        schema_ref="sim.case.lifecycle/CaseStateChanged/v1",
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="system", type=ActorType.SYSTEM),
        payload={},
    )


@pytest.mark.asyncio
async def test_first_event_is_processed(pg_pool: asyncpg.Pool):
    consumer = _RecordingConsumer(pg_pool, ["sim.case.lifecycle"])
    event = _make_event()
    processed = await consumer._mark_processed(event)
    assert processed is True


@pytest.mark.asyncio
async def test_duplicate_event_is_skipped(pg_pool: asyncpg.Pool):
    consumer = _RecordingConsumer(pg_pool, ["sim.case.lifecycle"])
    event = _make_event()
    first = await consumer._mark_processed(event)
    second = await consumer._mark_processed(event)
    assert first is True
    assert second is False


@pytest.mark.asyncio
async def test_same_event_different_consumer_group(pg_pool: asyncpg.Pool):
    c1 = _RecordingConsumer(pg_pool, ["sim.case.lifecycle"])
    c1._group_id = "group-a"
    c2 = _RecordingConsumer(pg_pool, ["sim.case.lifecycle"])
    c2._group_id = "group-b"

    event = _make_event()
    r1 = await c1._mark_processed(event)
    r2 = await c2._mark_processed(event)
    assert r1 is True
    assert r2 is True
