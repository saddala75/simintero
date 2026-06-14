"""EscalationService — escalates a case to the MD review queue.

Validates that the case is in 'clinical_review' state, updates
assignee_queue='md_review', and emits a CaseAssigned outbox event.

No LLM call, no coverage determination — this is a pure state-machine
side effect.

All writes must occur inside the caller's transaction.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import asyncpg

from enstellar_events import Actor, EventEnvelope, SchemaRef
from enstellar_workflow.outbox.publisher import OutboxPublisher


class EscalationService:
    def __init__(self, publisher: OutboxPublisher) -> None:
        self._pub = publisher

    async def escalate(
        self,
        conn: asyncpg.Connection,
        case_id: str,
        tenant_id: str,
        actor: Actor,
        reason: str | None = None,
        correlation_id: str | None = None,
    ) -> dict:
        """Escalate a case from clinical_review to md_review queue.

        Validates that the current status is 'clinical_review'.
        Updates workflow_instances.assignee_queue to 'md_review'.
        Writes a CaseAssigned event to the outbox (same transaction).

        Args:
            conn:       asyncpg connection; the caller must be in a transaction.
            case_id:    UUID string of the case to escalate.
            tenant_id:  Tenant owning the case.
            actor:      The Actor (id + type) performing the escalation.
            reason:         Optional human-readable escalation reason.
            correlation_id: Optional correlation ID propagated to the outbox event;
                            a new UUID is generated if not provided.

        Returns:
            dict with keys 'case_id' and 'queue'.

        Raises:
            ValueError: if the case is not found, or is not in clinical_review.
        """
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
               SET assignee_queue = 'md_review', updated_at = now()
             WHERE case_id = $1 AND tenant_id = $2 AND status = 'clinical_review'
            """,
            uuid.UUID(case_id),
            tenant_id,
        )
        if status != "UPDATE 1":
            raise ValueError(
                f"Failed to update assignee_queue for case_id={case_id!r} "
                f"tenant_id={tenant_id!r} (not found or status was not clinical_review)"
            )

        event = EventEnvelope(
            event_id=uuid.uuid4(),
            tenant_id=tenant_id,
            case_id=uuid.UUID(case_id),
            correlation_id=correlation_id or str(uuid.uuid4()),
            schema_ref=SchemaRef.CASE_ASSIGNED,
            occurred_at=datetime.now(timezone.utc),
            actor=actor,
            payload={"queue": "md_review", "reason": reason if reason is not None else "escalation"},
        )
        await self._pub.publish(conn, event)

        return {"case_id": case_id, "queue": "md_review"}
