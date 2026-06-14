from __future__ import annotations
import asyncpg
from canonical_model import EventEnvelope
from .topics import topic_for

async def append_event(conn: asyncpg.Connection, envelope: EventEnvelope) -> None:
    """Append an event to shared.outbox in the caller's transaction.

    The caller MUST already be inside a transaction (and, for tenant-scoped
    writes, inside a tenant_transaction so the row passes RLS).
    """
    topic = topic_for(envelope.schema_ref)
    await conn.execute(
        """
        INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
        VALUES ($1, $2, $3, $4::jsonb, $5)
        ON CONFLICT (event_id) DO NOTHING
        """,
        envelope.event_id,
        topic,
        envelope.correlation_id,
        envelope.model_dump_json(),
        envelope.tenant.tenant_id,
    )
