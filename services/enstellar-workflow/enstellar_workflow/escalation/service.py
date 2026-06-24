"""EscalationService — escalates a case to the MD review queue.

Validates that the case is in 'clinical_review' state, updates
assignee_queue='md_review', and emits a CaseAssigned outbox event.

No LLM call, no coverage determination — this is a pure state-machine
side effect.

All writes must occur inside the caller's transaction.
"""
from __future__ import annotations

import uuid

import asyncpg

from simintero_outbox import SchemaRef, make_envelope
from enstellar_workflow.outbox.publisher import OutboxPublisher

# Terminal case states that must never be (re-)escalated by the SLA breach monitor.
TERMINAL_STATES = (
    "approved",
    "denied",
    "partially_denied",
    "adverse_modification",
    "withdrawn",
    "closed",
    "determined",
    "voided",
)


class EscalationService:
    def __init__(self, publisher: OutboxPublisher) -> None:
        self._pub = publisher

    async def escalate(
        self,
        conn: asyncpg.Connection,
        case_id: str,
        tenant_id: str,
        actor_id: str,
        actor_type: str,
        reason: str | None = None,
        correlation_id: str | None = None,
        queue: str = "md_review",
        breach_mode: bool = False,
    ) -> dict:
        """Escalate a case to the given review queue.

        Default (HTTP) path: validate that the current status is
        'clinical_review', set assignee_queue=queue, emit CaseAssigned.

        breach_mode (SLA poller) path: escalate ANY non-terminal open case to
        ``queue`` without the clinical_review guard. If the case is terminal or
        not found (UPDATE 0) it is a no-op (returns escalated=False) and does
        NOT raise, so the cross-tenant poller never crashes on a raced case.

        Writes a CaseAssigned event to the outbox (same transaction) only when
        the UPDATE actually happened.

        Args:
            conn:       asyncpg connection; the caller must be in a transaction.
            case_id:    UUID string of the case to escalate.
            tenant_id:  Tenant owning the case.
            actor_id:   The id of the principal performing the escalation.
            actor_type: The actor type ('user' | 'system' | 'service').
            reason:         Optional human-readable escalation reason.
            correlation_id: Optional correlation ID propagated to the outbox event;
                            a new UUID is generated if not provided.
            queue:      Target assignee queue (defaults to 'md_review').
            breach_mode: When True, skip the clinical_review guard and escalate
                        any non-terminal open case (no-op on terminal/not-found).

        Returns:
            dict with keys 'case_id', 'queue', and 'escalated'.

        Raises:
            ValueError: (non-breach mode only) if the case is not found, or is
                        not in clinical_review.
        """
        if breach_mode:
            status = await conn.execute(
                """
                UPDATE workflow_instances
                   SET assignee_queue = $3, updated_at = now()
                 WHERE case_id = $1 AND tenant_id = $2
                   AND status <> ALL($4::text[])
                """,
                uuid.UUID(case_id),
                tenant_id,
                queue,
                list(TERMINAL_STATES),
            )
            if status != "UPDATE 1":
                # Terminal or not found — never-throw no-op for the poller.
                return {"case_id": case_id, "queue": None, "escalated": False}
        else:
            row = await conn.fetchrow(
                "SELECT status FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
                uuid.UUID(case_id),
                tenant_id,
            )
            if row is None:
                raise ValueError(f"Case {case_id} not found for tenant {tenant_id!r}")
            if row["status"] != "clinical_review":
                raise ValueError(
                    f"Can only escalate from clinical_review; current status={row['status']!r}"
                )

            status = await conn.execute(
                """
                UPDATE workflow_instances
                   SET assignee_queue = $3, updated_at = now()
                 WHERE case_id = $1 AND tenant_id = $2 AND status = 'clinical_review'
                """,
                uuid.UUID(case_id),
                tenant_id,
                queue,
            )
            if status != "UPDATE 1":
                raise ValueError(
                    f"Failed to update assignee_queue for case_id={case_id!r} "
                    f"tenant_id={tenant_id!r} (not found or status was not clinical_review)"
                )

        event = make_envelope(
            SchemaRef.CASE_ASSIGNED,
            tenant_id=tenant_id,
            actor_id=actor_id,
            actor_type=actor_type,
            correlation_id=correlation_id or str(uuid.uuid4()),
            payload={
                "case_id": case_id,
                "queue": queue,
                "reason": reason if reason is not None else "escalation",
            },
        )
        await self._pub.publish(conn, event)

        return {"case_id": case_id, "queue": queue, "escalated": True}
