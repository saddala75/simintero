"""OutboxPublisher — thin delegate to the platform shared.outbox writer.

Construction of the platform EventEnvelope happens at the call sites via
``simintero_outbox.make_envelope``. This publisher only persists an already
built envelope into ``shared.outbox`` inside the caller's transaction.
"""
import asyncpg
from canonical_model import EventEnvelope
from simintero_outbox import append_event


# Enstellar Case.lob is lowercase ("commercial"); the platform Tenant.lob enum
# is uppercase (COMMERCIAL/MA/MEDICAID/PUBLIC). Map known values, else None.
_LOB_MAP = {
    "commercial": "COMMERCIAL",
    "ma": "MA",
    "medicare_advantage": "MA",
    "medicaid": "MEDICAID",
    "public": "PUBLIC",
}


def lob_for_envelope(lob: str | None) -> str | None:
    """Map an Enstellar Case.lob string to the platform Tenant.lob enum value."""
    if lob is None:
        return None
    return _LOB_MAP.get(lob.lower())


class OutboxPublisher:
    async def publish(self, conn: asyncpg.Connection, event: EventEnvelope) -> None:
        """Append a platform EventEnvelope to shared.outbox in the caller's transaction.

        The caller MUST already be inside a transaction (and, for tenant-scoped
        writes, inside a tenant_conn so the row passes RLS).
        """
        await append_event(conn, event)
