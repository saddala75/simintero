"""AutoDeterminationConsumer — processes case.state.transitioned events where
to_state == 'auto_determination', then runs the approve-only auto-determination
path against the Digicore rule engine.

Idempotency: IdempotentKafkaConsumer base class deduplicates via processed_events.
If the case has already moved past auto_determination (e.g., a redelivered event),
the AutoDeterminator will still apply, which is safe: TransitionEngine.apply() will
simply write a duplicate transition event (status column was already updated by the
first delivery). In practice, Kafka exactly-once delivery keeps this rare.

INVARIANT #1: AutoDeterminator.run() can only produce approved or clinical_review.
INVARIANT #5: tenant_id flows through every call.
"""
from __future__ import annotations

import logging
import uuid

import asyncpg

from enstellar_connectors.digicore.client import DigiCoreClient
from canonical_model import EventEnvelope
from simintero_outbox import Topics

from ..cases.repository import CaseRepository
from ..engine.auto_determination import AutoDeterminator
from ..engine.transitions import TransitionEngine
from ..kafka.consumer import IdempotentKafkaConsumer

logger = logging.getLogger(__name__)

_AUTO_DETERMINATION_STATE = "auto_determination"


class AutoDeterminationConsumer(IdempotentKafkaConsumer):
    """Triggers the approve-only auto-determination path for eligible cases."""

    def __init__(self, pool: asyncpg.Pool, digicore: DigiCoreClient) -> None:
        super().__init__(
            pool,
            [Topics.CASE_LIFECYCLE],
            group_id="workflow-engine-auto-determination",
        )
        self._repo = CaseRepository()
        self._auto = AutoDeterminator(engine=TransitionEngine(), digicore=digicore)

    async def handle(self, event: EventEnvelope) -> None:
        """Process one case.state.transitioned event.

        Filters to events with to_state == 'auto_determination'. All other
        transitions are ignored — this consumer does not own them.
        """
        to_state = (event.payload or {}).get("to_state", "")
        if to_state != _AUTO_DETERMINATION_STATE:
            return

        tenant_id = event.tenant.tenant_id
        case_id_raw = (event.payload or {}).get("case_id")
        if case_id_raw is None:
            logger.error(
                "auto_determination_consumer_missing_case_id",
                extra={
                    "tenant_id": tenant_id,
                    "event_id": event.event_id,
                    "correlation_id": event.correlation_id,
                },
            )
            return
        case_id = uuid.UUID(str(case_id_raw))

        async with self._pool.acquire() as conn:
            case = await self._repo.fetch_by_id(conn, case_id, tenant_id)

        if case is None:
            logger.error(
                "auto_determination_consumer_case_not_found",
                extra={
                    "tenant_id": tenant_id,
                    "case_id": str(case_id),
                    "event_id": event.event_id,
                },
            )
            return

        logger.info(
            "auto_determination_consumer_starting",
            extra={
                "tenant_id": tenant_id,
                "case_id": str(case.case_id),
                "correlation_id": event.correlation_id,
            },
        )

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                updated = await self._auto.run(
                    conn, case, event.correlation_id, causation_id=event.event_id
                )

        logger.info(
            "auto_determination_consumer_done",
            extra={
                "tenant_id": tenant_id,
                "case_id": str(case.case_id),
                "to_status": updated.status.value,
            },
        )
