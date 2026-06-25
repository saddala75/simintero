"""IntakeConsumer — subscribes to case.intake.received and calls CaseService.create_case.

Idempotency is handled at two levels:
1. IdempotentKafkaConsumer base class deduplicates via processed_events table.
2. CaseService.create_case uses ON CONFLICT (correlation_id) DO NOTHING.
"""
from __future__ import annotations

import logging

import asyncpg

from canonical_model import Case, EventEnvelope
from simintero_outbox import SchemaRef, Topics

from ..kafka.consumer import IdempotentKafkaConsumer
from ..cases.service import CaseService

logger = logging.getLogger(__name__)


class IntakeConsumer(IdempotentKafkaConsumer):
    """Consumes case.intake.received events and creates workflow instances."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        super().__init__(
            pool,
            [Topics.CASE_LIFECYCLE],
            group_id="workflow-engine-intake",
        )
        self._service = CaseService(pool)

    async def handle(self, event: EventEnvelope) -> None:
        """Process one case.intake.received event.

        Extracts the canonical Case from event.payload["case"] and calls
        CaseService.create_case. Idempotent: if the case already exists
        (same correlation_id), create_case returns the existing record silently.
        """
        # Filter by schema_ref FIRST — this consumer shares the broad CASE_LIFECYCLE
        # topic with every other case-lifecycle event (appeals, grievances, decisions,
        # …). Without this guard those events fall through to the missing-case ERROR
        # log below (false-positive alerts). Mirrors the other consumers.
        if event.schema_ref != SchemaRef.CASE_INTAKE_RECEIVED:
            return
        tenant_id = event.tenant.tenant_id
        raw_case = event.payload.get("case")
        if not raw_case:
            logger.error(
                "intake_consumer_missing_case_payload",
                extra={
                    "tenant_id": tenant_id,
                    "event_id": event.event_id,
                    "correlation_id": event.correlation_id,
                },
            )
            return

        try:
            case = Case.model_validate(raw_case)
        except Exception:
            logger.exception(
                "intake_consumer_case_validation_failed",
                extra={
                    "tenant_id": tenant_id,
                    "event_id": event.event_id,
                    "correlation_id": event.correlation_id,
                },
            )
            return

        created = await self._service.create_case(case)
        logger.info(
            "intake_consumer_case_created",
            extra={
                "tenant_id": tenant_id,
                "case_id": str(created.case_id),
                "correlation_id": created.correlation_id,
            },
        )
