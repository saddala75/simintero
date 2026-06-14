"""OutboxPublisher — writes an event to the outbox table inside an existing DB transaction."""
import asyncpg

from enstellar_events import EventEnvelope


class OutboxPublisher:
    async def publish(self, conn: asyncpg.Connection, event: EventEnvelope) -> None:
        """Insert the event into the outbox table inside the caller's transaction.

        Raises ValueError if tenant_id is missing (invariant #5).
        The caller must be inside a transaction when calling this method.
        """
        if not event.tenant_id:
            raise ValueError("Event must carry tenant_id — invariant #5")

        await conn.execute(
            """
            INSERT INTO outbox
              (event_id, tenant_id, case_id, type, schema_ref, causation_id, trace_ref,
               payload, schema_version, occurred_at, correlation_id, actor_id, actor_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (event_id) DO NOTHING
            """,
            event.event_id,
            event.tenant_id,
            event.case_id,
            event.type,            # Kafka topic (computed from schema_ref)
            event.schema_ref,      # C-3 schema reference
            event.causation_id,
            event.trace_ref,
            __import__("json").dumps(event.payload),
            event.schema_version,  # version from schema_ref (e.g. "v1")
            event.occurred_at,
            event.correlation_id,
            event.actor.id,
            event.actor.type.value,
        )
