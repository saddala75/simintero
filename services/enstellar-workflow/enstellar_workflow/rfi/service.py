"""RfiService — dispatches structured RFI requests to providers.

RFI dispatch is an outbox event (sim.case.lifecycle/RFIDispatched/v1). The actual delivery
channel (fax, portal, direct messaging) is handled downstream by the
comms service consuming that event.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import asyncpg

from enstellar_events import Actor, ActorType, EventEnvelope, SchemaRef
from ..outbox.publisher import OutboxPublisher


@dataclass
class RfiRequest:
    case_id: uuid.UUID
    tenant_id: str
    provider_npi: str
    document_types: list[str]
    free_text: str | None = None
    requested_by: str = "system"
    request_id: uuid.UUID = field(default_factory=uuid.uuid4)


class RfiService:
    def __init__(self, publisher: OutboxPublisher) -> None:
        self._pub = publisher

    async def dispatch_rfi(
        self,
        conn: asyncpg.Connection,
        request: RfiRequest,
    ) -> uuid.UUID:
        """Write an RFIDispatched outbox event and return the request_id.

        The RFI is purely an event — no separate rfi table yet.
        The comms service subscribes to sim.case.lifecycle and handles delivery.
        """
        now = datetime.now(timezone.utc)
        event = EventEnvelope(
            event_id=uuid.uuid4(),
            tenant_id=request.tenant_id,
            case_id=request.case_id,
            correlation_id=str(request.request_id),
            schema_ref=SchemaRef.RFI_DISPATCHED,
            occurred_at=now,
            actor=Actor(id=request.requested_by, type=ActorType.SYSTEM),
            payload={
                "request_id": str(request.request_id),
                "provider_npi": request.provider_npi,
                "document_types": request.document_types,
                "free_text": request.free_text,
            },
        )
        await self._pub.publish(conn, event)
        return request.request_id
