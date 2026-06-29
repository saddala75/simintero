"""NotificationDeliveryConsumer — reads NOTIFICATION_SENT events and delivers them.

Routing:
  channel == "email"  → SmtpEmailSender.send(to_address, subject, body)
  channel == "letter" → MinioStore.download_notice(body_ref) → PrintVendorClient.submit
  other               → log warning, write failure record, return (event marked processed)

Updates notification_log.delivered_at on success or failure metadata on early return.
"""
from __future__ import annotations

import asyncio
import logging
import uuid

import asyncpg

from simintero_outbox import SchemaRef, Topics
from simintero_tenant_context import tenant_transaction
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

    async def _mark_delivery_failed(self, tenant_id: str, notification_id: str | None, reason: str) -> None:
        if not notification_id:
            return
        try:
            async with tenant_transaction(self._pool, tenant_id) as conn:
                await conn.execute(
                    "UPDATE notification_log SET failed_at = now(), error_reason = $2 "
                    "WHERE notification_id = $1",
                    uuid.UUID(notification_id),
                    reason,
                )
        except Exception as exc:
            logger.error("failed_to_mark_notification_failed notification_id=%s exc=%s", notification_id, exc)

    async def handle(self, event: EventEnvelope) -> None:
        if event.schema_ref != SchemaRef.NOTIFICATION_SENT:
            return

        payload = event.payload
        channel = payload.get("channel")
        notification_id = payload.get("notification_id")
        tenant_id = event.tenant.tenant_id

        if channel == "email":
            to = payload.get("to_address")
            if not to:
                logger.warning(
                    "delivery_missing_to_address notification_id=%s", notification_id
                )
                await self._mark_delivery_failed(tenant_id, notification_id, "missing_to_address")
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
                await self._mark_delivery_failed(tenant_id, notification_id, "missing_body_ref")
                return
            body = await asyncio.to_thread(self._minio.download_notice, body_ref)
            await self._print.submit(notification_id=notification_id, body=body)
        else:
            logger.warning(
                "delivery_unknown_channel channel=%r notification_id=%s",
                channel, notification_id,
            )
            await self._mark_delivery_failed(tenant_id, notification_id, f"unknown_channel_{channel}")
            return

        async with tenant_transaction(self._pool, tenant_id) as conn:
            await conn.execute(
                "UPDATE notification_log SET delivered_at = now() "
                "WHERE notification_id = $1",
                uuid.UUID(notification_id),
            )
        logger.info(
            "notice_delivered channel=%s notification_id=%s", channel, notification_id
        )
