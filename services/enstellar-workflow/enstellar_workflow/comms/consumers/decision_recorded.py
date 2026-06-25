from __future__ import annotations

import logging
import uuid

import asyncpg

from canonical_model import EventEnvelope
from simintero_outbox import SchemaRef, Topics
from simintero_tenant_context import tenant_transaction
from enstellar_workflow.comms.service import NotificationService, TERMINAL_OUTCOMES
from enstellar_workflow.kafka.consumer import IdempotentKafkaConsumer


logger = logging.getLogger(__name__)


class DecisionRecordedConsumer(IdempotentKafkaConsumer):
    def __init__(self, pool: asyncpg.Pool, notification_service: NotificationService) -> None:
        super().__init__(pool, topics=[Topics.CASE_LIFECYCLE], group_id="comms")
        self._notify = notification_service

    async def handle(self, event: EventEnvelope) -> None:
        if event.schema_ref != SchemaRef.DECISION_RECORDED:
            return
        outcome = event.payload.get("outcome")
        case_id = event.payload.get("case_id")
        if outcome not in TERMINAL_OUTCOMES:
            logger.debug("Skipping non-terminal outcome %r for case %s", outcome, case_id)
            return
        context = {
            "case_id": str(case_id),
            "outcome": outcome,
            "decided_at": event.occurred_at.isoformat(),
        }
        # Adverse content for a compliant denial notice (reason + appeal rights);
        # only present on adverse DECISION_RECORDED payloads.
        # Always DEFINE each adverse key (None when absent) so StrictUndefined
        # templates using {% if reason %} safely skip the guarded block instead of
        # raising UndefinedError — a reason-less adverse determination still renders
        # its notice (just without the reason line).
        for key in ("determination_type", "reason", "reason_codes", "citations"):
            context[key] = event.payload.get(key)
        async with tenant_transaction(self._pool, event.tenant.tenant_id) as conn:
            # Thread the case's LOB so LOB-specific notices are preferred
            # (generic fallback when the case row is absent → lob=None).
            lob_row = await conn.fetchrow(
                "SELECT lob FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
                uuid.UUID(str(case_id)), event.tenant.tenant_id,
            )
            lob = lob_row["lob"] if lob_row is not None else None
            await self._notify.render_and_dispatch(
                conn,
                event.tenant.tenant_id,
                str(case_id),
                event_type=outcome,
                context=context,
                actor_id=event.actor.id,
                actor_type=event.actor.type.value,
                correlation_id=event.correlation_id,
                causation_id=event.event_id,
                lob=lob,
            )
