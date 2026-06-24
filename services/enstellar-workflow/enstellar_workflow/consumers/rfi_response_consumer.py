"""RfiResponseConsumer — resumes the decision clock when documentation arrives.

Subscribes to rfi.response.received events (published by the comms service
when provider documentation is received). On each event:
  1. Resume the decision clock (extends deadline by accumulated pause time)
  2. Transition the case from 'pend_rfi' → 'auto_determination' (re-gate)

The re-gate (step 2) routes the case back into auto_determination so the
completeness gate (AutoDeterminator) can re-evaluate the now-arrived evidence.
If the evidence is now complete, the case is approved; if it is still incomplete
(already RFI-gated once, rfi_gated_at IS NOT NULL), it routes to clinical_review
for human review.  Both side-effects are in a single transaction.
"""
from __future__ import annotations

import logging
import uuid

import asyncpg

from canonical_model import EventEnvelope
from ..clocks.service import ClockService
from simintero_tenant_context import tenant_transaction
from ..engine.transitions import TransitionEngine
from ..outbox.publisher import OutboxPublisher

logger = logging.getLogger(__name__)


class RfiResponseConsumer:
    """Consumes rfi.response.received events from Kafka / Redpanda."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool
        self._publisher = OutboxPublisher()
        self._clock_svc = ClockService(self._publisher)
        self._engine = TransitionEngine()

    async def handle(self, event: EventEnvelope) -> None:
        """Process one rfi.response.received event.

        Expected payload keys:
          - case_id: UUID (in event.payload["case_id"])
          - provider_npi: str
          - document_types: list[str]
        """
        tenant_id = event.tenant.tenant_id
        case_id = uuid.UUID(str(event.payload["case_id"]))

        async with tenant_transaction(self._pool, tenant_id) as conn:
            # 1. Resume the paused decision clock
            try:
                await self._clock_svc.resume(
                    conn,
                    tenant_id=tenant_id,
                    case_id=case_id,
                )
            except ValueError:
                logger.warning(
                    "No paused clock for case_id=%s tenant=%s; skipping resume",
                    case_id,
                    tenant_id,
                )

            # 2. Transition case to auto_determination (re-gate): the completeness
            # gate (AutoDeterminator) will re-evaluate the now-arrived evidence.
            # Complete evidence → approved; still-incomplete (rfi_gated_at set) →
            # clinical_review.  This is the S4 re-gate loop.
            from ..engine.transitions import TransitionRequest
            from ..cases.repository import CaseRepository
            repo = CaseRepository()
            req = TransitionRequest(
                case_id=case_id,
                tenant_id=tenant_id,
                to_state="auto_determination",
                actor_id="system",
                actor_type="system",
                # Preserve the triggering event's correlation_id (do NOT regenerate);
                # carry its event_id as causation_id so the emitted transition event
                # records the causal chain back to rfi.response.received.
                correlation_id=event.correlation_id,
                causation_id=event.event_id,
                payload={"reason": "rfi_response_received"},
            )
            pre_case = await repo.fetch_by_id(conn, case_id, tenant_id)
            rfi_from_state = pre_case.status.value if pre_case is not None else "pend_rfi"
            rfi_event_id: uuid.UUID | None = None
            try:
                _result_case, rfi_event_id = await self._engine.apply(conn, req)
            except Exception as exc:
                logger.warning(
                    "Could not transition case %s to auto_determination (re-gate): %s",
                    case_id,
                    exc,
                )
                raise

        # Notify platform OUTSIDE the transaction (fire-and-forget)
        if rfi_event_id is not None:
            await self._engine.notify_platform(req, from_state=rfi_from_state, event_id=rfi_event_id)
