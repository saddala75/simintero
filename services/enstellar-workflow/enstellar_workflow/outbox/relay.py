"""OutboxRelay — polls shared.outbox and publishes unpublished events to Kafka.

The relay reads rows for EVERY tenant, so it must bypass the RLS tenant_isolation
policy on shared.outbox. It does so with SET LOCAL ROLE inside the batch transaction
so the BYPASSRLS `sim_relay` role is transaction-scoped and never leaks back to
PgBouncer's connection pool. The Kafka payload is the stored envelope jsonb
published verbatim to the row's topic.

Error handling (migration 0030):
- Each row tracks ``retry_count`` (failures since last success).
- After MAX_RELAY_RETRIES consecutive failures, the row is moved to DLQ status
  (dlq_at + dlq_reason set) and is NEVER retried again — preventing poison
  messages from looping forever.
- A 10-second asyncio timeout on each Kafka send prevents indefinite hangs when
  the broker is unavailable; timeouts increment retry_count like other errors.
"""
from __future__ import annotations

import asyncio
import logging
import asyncpg

from ..config import get_settings
from ..kafka.producer import KafkaProducer

logger = logging.getLogger(__name__)

MAX_RELAY_RETRIES: int = 5
KAFKA_SEND_TIMEOUT_SECONDS: float = 10.0


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
        # ponytail: SET LOCAL ROLE is transaction-scoped; auto-reverts at COMMIT so
        # PgBouncer transaction pooling never sees a leaked sim_relay on the backend.
        role = get_settings().relay_db_role
        count = 0
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                if role:
                    await conn.execute(f'SET LOCAL ROLE "{role}"')
                rows = await conn.fetch(
                    """
                    SELECT event_id, topic, key, envelope, retry_count
                    FROM shared.outbox
                    WHERE published_at IS NULL
                      AND dlq_at IS NULL
                    ORDER BY event_id ASC
                    LIMIT $1
                    FOR UPDATE SKIP LOCKED
                    """,
                    batch_size,
                )

                for row in rows:
                    await self._process_row(conn, row)
                    count += 1

        return count

    async def _process_row(self, conn: asyncpg.Connection, row: asyncpg.Record) -> None:
        """Publish one outbox row to Kafka, handling retries and DLQ routing.

        Args:
            conn:  An active asyncpg connection (inside a transaction).
            row:   The outbox row dict/record with event_id, topic, key,
                   envelope, and retry_count fields.
        """
        event_id = row["event_id"]
        retry_count: int = row.get("retry_count", 0)

        # Poison pill check — move to DLQ instead of retrying forever.
        if retry_count >= MAX_RELAY_RETRIES:
            reason = f"max retries ({MAX_RELAY_RETRIES}) exceeded"
            logger.error(
                "outbox_row_dlq",
                extra={
                    "event_id": str(event_id),
                    "topic": row["topic"],
                    "retry_count": retry_count,
                    "reason": reason,
                },
            )
            await conn.execute(
                """
                UPDATE shared.outbox
                SET dlq_at = now(), dlq_reason = $1
                WHERE event_id = $2
                """,
                reason,
                event_id,
            )
            return

        envelope = row["envelope"]
        if isinstance(envelope, str):
            import json as _json
            envelope = _json.loads(envelope)

        try:
            await asyncio.wait_for(
                self._producer.send(row["topic"], envelope, key=row["key"]),
                timeout=KAFKA_SEND_TIMEOUT_SECONDS,
            )
            await conn.execute(
                "UPDATE shared.outbox SET published_at = now() WHERE event_id = $1",
                event_id,
            )
            logger.debug(
                "outbox_row_published",
                extra={"event_id": str(event_id), "topic": row["topic"]},
            )

        except asyncio.TimeoutError:
            logger.warning(
                "outbox_publish_timeout",
                extra={
                    "event_id": str(event_id),
                    "topic": row["topic"],
                    "timeout_seconds": KAFKA_SEND_TIMEOUT_SECONDS,
                },
            )
            await conn.execute(
                "UPDATE shared.outbox SET retry_count = retry_count + 1 WHERE event_id = $1",
                event_id,
            )

        except Exception as exc:
            logger.error(
                "outbox_publish_error",
                extra={
                    "event_id": str(event_id),
                    "topic": row["topic"],
                    "error": str(exc),
                    "retry_count": retry_count,
                },
            )
            await conn.execute(
                "UPDATE shared.outbox SET retry_count = retry_count + 1 WHERE event_id = $1",
                event_id,
            )
