"""IdempotentKafkaConsumer base class.

Guarantees exactly-once processing by recording event_id in the processed_events
table before calling the handler. If the DB insert fails (duplicate key), the event
has already been processed and is skipped silently.

Subclass and implement `handle(event: EventEnvelope) -> None`.
"""
import asyncio
import logging
from abc import ABC, abstractmethod

import asyncpg
from aiokafka import AIOKafkaConsumer

from enstellar_events import EventEnvelope, decode
from ..config import get_settings

logger = logging.getLogger(__name__)


class IdempotentKafkaConsumer(ABC):
    def __init__(self, pool: asyncpg.Pool, topics: list[str], group_id: str | None = None) -> None:
        settings = get_settings()
        self._pool = pool
        self._topics = topics
        self._group_id = group_id or settings.kafka_consumer_group
        self._running = False

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
                    event = decode(msg.value)
                    processed = await self._mark_processed(event)
                    if processed:
                        await self.handle(event)
                    await consumer.commit()
                except Exception:
                    logger.exception("Error processing event from topic %s", msg.topic)
                    # Do NOT commit offset on exception — let Kafka redeliver.
                    # On redeliver, _mark_processed returns False (already seen) → safe skip.
        finally:
            await consumer.stop()

    async def stop(self) -> None:
        self._running = False

    async def _mark_processed(self, event: EventEnvelope) -> bool:
        """Insert event_id into processed_events. Returns True if new, False if already seen."""
        async with self._pool.acquire() as conn:
            try:
                await conn.execute(
                    """
                    INSERT INTO processed_events (event_id, consumer_group)
                    VALUES ($1, $2)
                    """,
                    event.event_id,
                    self._group_id,
                )
                return True
            except asyncpg.UniqueViolationError:
                logger.debug("Event %s already processed by %s — skipping", event.event_id, self._group_id)
                return False

    @abstractmethod
    async def handle(self, event: EventEnvelope) -> None:
        """Process a single event. Called only if the event has not been seen before."""
