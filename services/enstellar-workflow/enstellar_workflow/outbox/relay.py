"""OutboxRelay — polls shared.outbox and publishes unpublished events to Kafka.

The relay reads rows for EVERY tenant, so it must bypass the RLS tenant_isolation
policy on shared.outbox. It does so by SET ROLE'ing to the BYPASSRLS `sim_relay`
role (created by migration 0011) on each acquired connection. The Kafka payload is
the stored envelope jsonb published verbatim to the row's topic.
"""
import asyncio
import logging
from contextlib import asynccontextmanager

import asyncpg

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

    @asynccontextmanager
    async def _relay_conn(self):
        """Acquire a connection with the BYPASSRLS relay role set (if configured)."""
        role = get_settings().relay_db_role
        async with self._pool.acquire() as conn:
            if role:
                await conn.execute(f'SET ROLE "{role}"')
            try:
                yield conn
            finally:
                if role:
                    await conn.execute("RESET ROLE")

    async def _relay_batch(self, batch_size: int) -> int:
        count = 0
        async with self._relay_conn() as conn:
            async with conn.transaction():
                rows = await conn.fetch(
                    """
                    SELECT event_id, topic, key, envelope
                    FROM shared.outbox
                    WHERE published_at IS NULL
                    ORDER BY event_id ASC
                    LIMIT $1
                    FOR UPDATE SKIP LOCKED
                    """,
                    batch_size,
                )

                for row in rows:
                    envelope = row["envelope"]
                    if isinstance(envelope, str):
                        import json as _json

                        envelope = _json.loads(envelope)
                    await self._producer.send(row["topic"], envelope, key=row["key"])
                    await conn.execute(
                        "UPDATE shared.outbox SET published_at = now() WHERE event_id = $1",
                        row["event_id"],
                    )
                    count += 1

        return count
