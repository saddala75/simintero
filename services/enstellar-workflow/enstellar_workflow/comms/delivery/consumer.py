"""NotificationDeliveryConsumer — reads NOTIFICATION_SENT events and delivers them.

Routing:
  channel == "email"  → SmtpEmailSender.send(to_address, subject, body)
  channel == "letter" → MinioStore.download_notice(body_ref) → PrintVendorClient.submit
  other               → log warning, return (event still marked processed by base class)

Updates notification_log.delivered_at on success.
"""
from __future__ import annotations

import asyncio
import logging
import uuid

import asyncpg

from simintero_outbox import SchemaRef, Topics
from canonical_model import EventEnvelope
from ..delivery.email import SmtpEmailSender
from ..delivery.print_vendor import PrintVendorClient
from ...normalization.storage import MinioStore
from ...kafka.consumer import IdempotentKafkaConsumer

logger = logging.getLogger(__name__)


class NotificationDeliveryConsumer(IdempotentKafkaConsumer):
    def __init__(
        self,
        pool: asyncpg.Pool,
        email_sender: SmtpEmailSender,
        print_client: PrintVendorClient,
        minio_store: MinioStore,
    ) -> None:
        super().__init__(pool, [Topics.ARTIFACT], group_id="notification-delivery")
        self._email = email_sender
        self._print = print_client
        self._minio = minio_store

    async def handle(self, event: EventEnvelope) -> None:
        if event.schema_ref != SchemaRef.NOTIFICATION_SENT:
            return

        payload = event.payload
        channel = payload.get("channel")
        notification_id = payload.get("notification_id")

        if channel == "email":
            to = payload.get("to_address")
            if not to:
                logger.warning(
                    "delivery_missing_to_address notification_id=%s", notification_id
                )
                return
            await self._email.send(
                to=to,
                subject=payload.get("subject", ""),
                body=payload.get("body", ""),
            )
        elif channel == "letter":
            body_ref = payload.get("body_ref")
            if not body_ref:
                logger.warning(
                    "delivery_missing_body_ref notification_id=%s", notification_id
                )
                return
            body = await asyncio.to_thread(self._minio.download_notice, body_ref)
            await self._print.submit(notification_id=notification_id, body=body)
        else:
            logger.warning(
                "delivery_unknown_channel channel=%r notification_id=%s",
                channel, notification_id,
            )
            return

        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE notification_log SET delivered_at = now() "
                "WHERE notification_id = $1",
                uuid.UUID(notification_id),
            )
        logger.info(
            "notice_delivered channel=%s notification_id=%s", channel, notification_id
        )
