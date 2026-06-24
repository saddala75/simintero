"""RfiService — dispatches structured RFI requests to providers.

RFI dispatch is an outbox event (sim.case.lifecycle/RFIDispatched/v1). The actual delivery
channel (fax, portal, direct messaging) is handled downstream by the
comms service consuming that event.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

import asyncpg

from simintero_outbox import SchemaRef, make_envelope
from ..outbox.publisher import OutboxPublisher


@dataclass
class RfiRequest:
    case_id: uuid.UUID
    tenant_id: str
    provider_npi: str = ""
    document_types: list[str] = field(default_factory=list)
    free_text: str | None = None
    requested_by: str = "system"
    request_id: uuid.UUID = field(default_factory=uuid.uuid4)
    requirement_ids: list[str] = field(default_factory=list)


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
        event = make_envelope(
            SchemaRef.RFI_DISPATCHED,
            tenant_id=request.tenant_id,
            actor_id=request.requested_by,
            actor_type="system",
            correlation_id=str(request.request_id),
            payload={
                "case_id": str(request.case_id),
                "request_id": str(request.request_id),
                "provider_npi": request.provider_npi,
                "document_types": request.document_types,
                "free_text": request.free_text,
                "requirement_ids": request.requirement_ids,
            },
        )
        await self._pub.publish(conn, event)
        return request.request_id
