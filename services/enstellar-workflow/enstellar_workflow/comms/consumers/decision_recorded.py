from __future__ import annotations

import logging

import asyncpg

from enstellar_events.envelope import EventEnvelope
from enstellar_events.topics import SchemaRef, Topics
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
        if outcome not in TERMINAL_OUTCOMES:
            logger.debug("Skipping non-terminal outcome %r for case %s", outcome, event.case_id)
            return
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await self._notify.render_and_dispatch(
                    conn,
                    event.tenant_id,
                    str(event.case_id),
                    event_type=outcome,
                    context={
                        "case_id": str(event.case_id),
                        "outcome": outcome,
                        "decided_at": event.occurred_at.isoformat(),
                    },
                    actor=event.actor,
                )
