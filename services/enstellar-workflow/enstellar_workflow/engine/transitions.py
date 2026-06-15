"""TransitionEngine — applies a state transition atomically.

All three side-effects (workflow_events row, workflow_instances status update,
outbox row) happen in the caller's transaction. If any step raises, the
transaction rolls back and nothing is persisted.
"""
from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import asyncpg

from canonical_model import Case, Status
from simintero_outbox import SchemaRef, make_envelope

from .guards import ADVERSE_STATES, GuardError, adverse_transition_guard
from .platform_client import PlatformCaseClient
from .recorder import EventRecorder
from ..cases.repository import CaseRepository
from ..outbox.publisher import OutboxPublisher, lob_for_envelope

logger = logging.getLogger(__name__)


@dataclass
class TransitionRequest:
    case_id: uuid.UUID
    tenant_id: str
    to_state: str
    actor_id: str
    actor_type: str  # 'user' | 'system' | 'service'
    correlation_id: str
    payload: dict = field(default_factory=dict)
    human_signoff_recorded: bool = False


class TransitionEngine:
    """Applies a validated state transition inside a caller-supplied transaction."""

    def __init__(self) -> None:
        self._repo = CaseRepository()
        self._recorder = EventRecorder()
        self._publisher = OutboxPublisher()
        platform_url = os.environ.get("PLATFORM_CASE_SERVICE_URL", "http://localhost:8091")
        self._platform_client = PlatformCaseClient(base_url=platform_url)

    async def apply(self, conn: asyncpg.Connection, req: TransitionRequest) -> tuple[Case, str]:
        """Evaluate guards, record event, update status, publish outbox event.

        All writes happen inside the caller's transaction.
        Raises GuardError if any guard fails (caller's transaction rolls back).
        Raises ValueError if the case is not found.
        """
        # 1. Fetch current case (validates case_id + tenant_id)
        case = await self._repo.fetch_by_id(conn, req.case_id, req.tenant_id)
        if case is None:
            raise ValueError(
                f"Case {req.case_id} not found for tenant {req.tenant_id!r}"
            )

        from_state = case.status.value

        # 2. Evaluate the adverse-transition guard (INVARIANT #1 — non-bypassable)
        guard_result = adverse_transition_guard(req.to_state, req.human_signoff_recorded)
        if not guard_result.passed:
            raise GuardError(guard_result.reason)  # type: ignore[arg-type]

        occurred_at = datetime.now(timezone.utc)

        # 3. Write an immutable workflow_events row
        await self._recorder.record(
            conn,
            case_id=req.case_id,
            tenant_id=req.tenant_id,
            event_type=SchemaRef.CASE_STATE_CHANGED,
            from_state=from_state,
            to_state=req.to_state,
            actor_id=req.actor_id,
            actor_type=req.actor_type,
            correlation_id=req.correlation_id,
            payload=req.payload,
            occurred_at=occurred_at,
        )

        # 4. Update the workflow_instances status + case_json snapshot
        await self._repo.update_status(conn, case, req.to_state, occurred_at)

        # 5. Write an outbox event (picked up by OutboxRelay → Kafka)
        lob = lob_for_envelope(case.lob)
        event = make_envelope(
            SchemaRef.CASE_STATE_CHANGED,
            tenant_id=req.tenant_id,
            actor_id=req.actor_id,
            actor_type=req.actor_type,
            correlation_id=req.correlation_id,
            occurred_at=occurred_at,
            lob=lob,
            payload={
                "case_id": str(req.case_id),
                "from_state": from_state,
                "to_state": req.to_state,
                **req.payload,
            },
        )
        await self._publisher.publish(conn, event)

        # 6. If adverse, emit a second structured-payload event for downstream consumers
        if req.to_state in ADVERSE_STATES:
            structured_event = make_envelope(
                SchemaRef.ADVERSE_STRUCTURED,
                tenant_id=req.tenant_id,
                actor_id=req.actor_id,
                actor_type=req.actor_type,
                correlation_id=req.correlation_id,
                occurred_at=occurred_at,
                lob=lob,
                causation_id=event.event_id,
                payload={
                    "case_id": str(req.case_id),
                    "determination_type": req.payload.get(
                        "determination_type", req.to_state
                    ),
                    "finding_sections": req.payload.get("finding_sections"),
                    "reason_codes": req.payload.get("reason_codes"),
                    "citations": req.payload.get("citations"),
                    "reason": req.payload.get("reason"),
                },
            )
            await self._publisher.publish(conn, structured_event)

        # 7. Return the updated case (constructed locally — no extra DB round-trip)
        return case.model_copy(
            update={"status": Status(req.to_state), "updated_at": occurred_at}
        ), event.event_id

    async def notify_platform(
        self,
        req: TransitionRequest,
        from_state: str,
        event_id: str,
    ) -> None:
        """Call the platform case service after the Enstellar transaction has committed.

        Fire-and-forget: platform failures are logged but NOT propagated.
        The outbox relay will deliver the same event via Kafka as a fallback.
        """
        try:
            await self._platform_client.post_transition(
                req=req,
                from_state=from_state,
                event_id=event_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "platform notify failed for case=%s %s→%s: %s",
                req.case_id,
                from_state,
                req.to_state,
                exc,
            )
