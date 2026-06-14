"""Dataclasses for outbox rows (not ORM — we use asyncpg raw queries for performance)."""
import uuid
from dataclasses import dataclass
from datetime import datetime


@dataclass
class OutboxEntry:
    event_id: uuid.UUID
    tenant_id: str
    case_id: uuid.UUID | None
    type: str
    payload: dict
    schema_version: str
    occurred_at: datetime
    correlation_id: str
    actor_id: str
    actor_type: str
