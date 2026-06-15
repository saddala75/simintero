"""OutboxRelay — polls the outbox table and publishes unpublished events to Kafka."""
import asyncio
import logging

import asyncpg

from enstellar_events import EventEnvelope, Actor, ActorType
from .models import OutboxEntry
from ..config import get_settings
from ..kafka.producer import KafkaProducer

logger = logging.getLogger(__name__)


class OutboxRelay:
    def __init__(self, pool: asyncpg.Pool, producer: KafkaProducer) -> None:
        self._pool = pool
        self._producer = producer
        self._running = False

    async def start(self) -> None:
        self._running = True
        settings = get_settings()
        while self._running:
            try:
                published = await self._relay_batch(settings.outbox_batch_size)
                if published == 0:
                    await asyncio.sleep(settings.outbox_poll_interval_seconds)
            except Exception:
                logger.exception("OutboxRelay error — retrying after sleep")
                await asyncio.sleep(settings.outbox_poll_interval_seconds)

    async def stop(self) -> None:
        self._running = False

    async def _relay_batch(self, batch_size: int) -> int:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, event_id, tenant_id, case_id, schema_ref, payload,
                       occurred_at, correlation_id, actor_id, actor_type,
                       causation_id, trace_ref
                FROM outbox
                WHERE published_at IS NULL
                ORDER BY id ASC
                LIMIT $1
                """,
                batch_size,
            )

        count = 0
        for row in rows:
            event = _row_to_envelope(row)
            topic = event.type  # Kafka topic derived from schema_ref
            await self._producer.send(topic, event)

            async with self._pool.acquire() as conn:
                await conn.execute(
                    "UPDATE outbox SET published_at = now() WHERE id = $1",
                    row["id"],
                )
            count += 1

        return count


def _row_to_envelope(row: asyncpg.Record) -> EventEnvelope:
    import json as _json
    return EventEnvelope(
        event_id=row["event_id"],
        tenant_id=row["tenant_id"],
        case_id=row["case_id"],
        correlation_id=row["correlation_id"],
        schema_ref=row["schema_ref"],
        causation_id=row["causation_id"],
        trace_ref=row["trace_ref"],
        occurred_at=row["occurred_at"],
        actor=Actor(id=row["actor_id"], type=ActorType(row["actor_type"])),
        payload=_json.loads(row["payload"]) if isinstance(row["payload"], str) else row["payload"],
    )
