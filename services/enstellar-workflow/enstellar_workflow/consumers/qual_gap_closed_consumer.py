"""QualGapClosedConsumer — marks outreach tasks resolved when Qualitron closes a quality gap.

Subscribes to ``qual.gap.closed`` and filters to ``QualGapClosed`` events. On receipt:
  1. Look up ``qual.outreach_task_ref`` for the gap_id
  2. If found, call the Task Service to mark the outreach task resolved
  3. If not found, log and ack (gap closed but no outreach task was created — valid state)
"""
from __future__ import annotations

import logging
import os

import asyncpg
import httpx

from canonical_model import EventEnvelope
from simintero_tenant_context import tenant_transaction
from ..kafka.consumer import IdempotentKafkaConsumer

logger = logging.getLogger(__name__)

TASK_SERVICE_URL = "http://task-service:5050"  # overrideable via env


class QualGapClosedConsumer(IdempotentKafkaConsumer):
    """Consumes QualGapClosed events from the qual.gap.closed Kafka topic."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        super().__init__(pool, ["qual.gap.closed"], group_id="workflow-engine-qual-gap-closed")
        self._task_service_url = os.environ.get("TASK_SERVICE_URL", TASK_SERVICE_URL)

    async def handle(self, event: EventEnvelope) -> None:
        """Process one QualGapClosed event.

        The qual.gap.closed topic carries QualGapClosed events. Filter by
        event_type in the payload to be explicit; other event types are ignored.

        Flow:
          1. Extract gap_id from payload, tenant_id from event.tenant.
          2. Query qual.outreach_task_ref for the gap_id.
          3. If found, POST to Task Service to mark task resolved.
          4. If not found, log info and return — not an error.
        """
        payload = event.payload
        if not payload or payload.get("event_type") != "QualGapClosed":
            return

        gap_id: str | None = payload.get("gap_id")
        tenant_id: str | None = event.tenant.tenant_id if event.tenant else None
        if not gap_id or not tenant_id:
            logger.warning(
                "QualGapClosedConsumer: missing gap_id or tenant_id in event %s",
                event.event_id,
            )
            return

        async with tenant_transaction(self._pool, tenant_id) as conn:
            row = await conn.fetchrow(
                """
                SELECT otr.task_id
                FROM qual.outreach_task_ref otr
                WHERE otr.gap_id = $1
                LIMIT 1
                """,
                gap_id,
            )

        if not row:
            logger.info(
                "QualGapClosedConsumer: gap %s closed but no outreach task exists — no action",
                gap_id,
            )
            return

        task_id: str = row["task_id"]
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self._task_service_url}/v1/tasks/{task_id}/resolved",
                json={"reason": "qual_gap_closed", "gap_id": gap_id},
            )
            if resp.status_code not in (200, 204):
                logger.error(
                    "QualGapClosedConsumer: Task Service returned %d for task %s",
                    resp.status_code,
                    task_id,
                )
