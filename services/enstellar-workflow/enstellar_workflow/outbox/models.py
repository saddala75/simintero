"""Dataclasses for shared.outbox rows (not ORM — asyncpg raw queries)."""
from dataclasses import dataclass
from datetime import datetime


@dataclass
class OutboxRow:
    """A single shared.outbox row (the relay reads the envelope jsonb directly)."""

    event_id: str
    topic: str
    key: str | None
    envelope: dict
    tenant_id: str
    published_at: datetime | None = None
