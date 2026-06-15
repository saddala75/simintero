from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from ulid import ULID
from canonical_model import EventEnvelope, Tenant, Actor

# MIGRATION-envelope.md actor mapping.
_ACTOR_TYPE_MAP = {
    "user": "human", "system": "service", "service": "service",
    "human": "human", "model_agent": "model_agent",
}

def map_actor_type(old: str) -> str:
    return _ACTOR_TYPE_MAP.get(old, old)

def new_event_id() -> str:
    return f"evt_{ULID()}"

def make_envelope(
    schema_ref: str, *,
    tenant_id: str, actor_id: str, actor_type: str,
    correlation_id: str, payload: dict[str, Any],
    lob: str | None = None, program: str | None = None,
    product: str | None = None, region: str | None = None,
    causation_id: str | None = None, trace_ref: str | None = None,
    occurred_at: datetime | None = None,
) -> EventEnvelope:
    """Build a platform EventEnvelope (fresh ULID, nested tenant, mapped actor)."""
    return EventEnvelope(
        event_id=new_event_id(),
        schema_ref=schema_ref,
        occurred_at=occurred_at or datetime.now(timezone.utc),
        tenant=Tenant(tenant_id=tenant_id, lob=lob, program=program, product=product, region=region),
        correlation_id=correlation_id,
        causation_id=causation_id,
        actor=Actor(type=map_actor_type(actor_type), id=actor_id),
        trace_ref=trace_ref,
        payload=payload,
    )
