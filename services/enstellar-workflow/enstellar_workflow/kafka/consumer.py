"""IdempotentKafkaConsumer base class.

Processing order (Gap 1 fix):
1. Check shared.processed_events — skip if already seen (successful redeliver).
2. Call handle(event).
   - Success → _mark_processed → commit.
   - Exception → _record_failure (increments shared.consumer_failures).
     - attempt < max_retries: do NOT commit, Kafka redelivers.
     - attempt >= max_retries: _send_to_dlq → _mark_processed → commit.
"""
import asyncio
import json
import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

import asyncpg
from aiokafka import AIOKafkaConsumer

from canonical_model import EventEnvelope
from ..config import get_settings

if TYPE_CHECKING:
    from ..kafka.producer import KafkaProducer

logger = logging.getLogger(__name__)


class IdempotentKafkaConsumer(ABC):
    max_retries: int = 3

    def __init__(
        self, pool: asyncpg.Pool, topics: list[str], group_id: str | None = None
    ) -> None:
        settings = get_settings()
        self._pool = pool
        self._topics = topics
        self._group_id = group_id or settings.kafka_consumer_group
        self._running = False
        self._producer: "KafkaProducer | None" = None  # set by main.py after construction

    async def run(self) -> None:
        settings = get_settings()
        consumer = AIOKafkaConsumer(
            *self._topics,
            bootstrap_servers=settings.kafka_bootstrap_servers,
            group_id=self._group_id,
            enable_auto_commit=False,
        )
        await consumer.start()
        self._running = True
        try:
            async for msg in consumer:
                if not self._running:
                    break
                try:
                    event = EventEnvelope.model_validate(json.loads(msg.value))
                    if await self._is_processed(event):
                        await consumer.commit()
                        continue
                    try:
                        await self.handle(event)
                    except Exception as exc:
                        attempt = await self._record_failure(event, exc)
                        if attempt >= self.max_retries:
                            await self._send_to_dlq(event, msg.topic, exc)
                            await self._mark_processed(event)
                            await consumer.commit()
                        # else: no commit — Kafka redelivers
                        continue
                    await self._mark_processed(event)
                    await consumer.commit()
                except Exception:
                    logger.exception("consumer_loop_error topic=%s group=%s", msg.topic, self._group_id)
        finally:
            await consumer.stop()

    async def stop(self) -> None:
        self._running = False

    async def _is_processed(self, event: EventEnvelope) -> bool:
        async with self._pool.acquire() as conn:
            result = await conn.fetchval(
                "SELECT 1 FROM shared.processed_events "
                "WHERE event_id=$1 AND consumer_group=$2",
                str(event.event_id), self._group_id,
            )
            return result is not None

    async def _mark_processed(self, event: EventEnvelope) -> None:
        async with self._pool.acquire() as conn:
            try:
                await conn.execute(
                    "INSERT INTO shared.processed_events (event_id, consumer_group) "
                    "VALUES ($1, $2)",
                    str(event.event_id), self._group_id,
                )
            except asyncpg.UniqueViolationError:
                pass  # race or replay after a previous success

    async def _record_failure(self, event: EventEnvelope, exc: Exception) -> int:
        """Upsert failure row. Returns the new attempt_count."""
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                """
                INSERT INTO shared.consumer_failures
                    (event_id, consumer_group, attempt_count, last_error)
                VALUES ($1, $2, 1, $3)
                ON CONFLICT (event_id, consumer_group) DO UPDATE
                    SET attempt_count     = consumer_failures.attempt_count + 1,
                        last_error        = EXCLUDED.last_error,
                        last_attempted_at = now()
                RETURNING attempt_count
                """,
                str(event.event_id), self._group_id, str(exc),
            )

    async def _send_to_dlq(
        self, event: EventEnvelope, topic: str, exc: Exception
    ) -> None:
        """Write to shared.consumer_dlq (primary) and publish to dead-letter Kafka topic."""
        payload = json.loads(event.model_dump_json())
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO shared.consumer_dlq
                    (event_id, consumer_group, topic, payload, error)
                VALUES ($1, $2, $3, $4, $5)
                """,
                str(event.event_id), self._group_id, topic,
                json.dumps(payload), str(exc),
            )
        if self._producer is not None:
            await self._producer.send(f"{topic}.dead-letter", payload)
        logger.error(
            "consumer_dlq event_id=%s group=%s topic=%s attempts=%d error=%s",
            event.event_id, self._group_id, topic, self.max_retries, exc,
        )

    @abstractmethod
    async def handle(self, event: EventEnvelope) -> None:
        """Process one event. Called only for unseen events."""
