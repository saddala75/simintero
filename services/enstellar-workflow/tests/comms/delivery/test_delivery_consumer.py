"""Integration tests for NotificationDeliveryConsumer.

Uses real asyncpg pool (pg_pool fixture) and mocked senders.
"""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock

from simintero_outbox import SchemaRef, make_envelope


def _seed_notification_log(conn_coro, notification_id, tenant_id, case_id, channel="email"):
    """Helper coroutine factory — call as: await _seed_notification_log(pg_pool.acquire(), ...)"""
    import asyncpg
    return conn_coro


async def _insert_notif(pool, notification_id, tenant_id, case_id, channel="email"):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_log "
            "(notification_id, tenant_id, case_id, event_type, channel, rendered_subject) "
            "VALUES ($1, $2, $3, 'approved', $4, 'Approved')",
            notification_id, tenant_id, case_id, channel,
        )


@pytest.mark.asyncio
async def test_email_channel_calls_sender_and_stamps_delivered_at(pg_pool):
    from enstellar_workflow.comms.delivery.consumer import NotificationDeliveryConsumer
    from enstellar_workflow.comms.delivery.email import SmtpEmailSender
    from enstellar_workflow.comms.delivery.print_vendor import PrintVendorClient
    from enstellar_workflow.normalization.storage import MinioStore

    notification_id = uuid.uuid4()
    tenant_id = f"tenant-del-{uuid.uuid4()}"
    case_id = uuid.uuid4()
    await _insert_notif(pg_pool, notification_id, tenant_id, case_id, channel="email")

    email_sender = AsyncMock(spec=SmtpEmailSender)
    print_client = AsyncMock(spec=PrintVendorClient)
    minio_store = MagicMock(spec=MinioStore)

    consumer = NotificationDeliveryConsumer(pg_pool, email_sender, print_client, minio_store)

    event = make_envelope(
        SchemaRef.NOTIFICATION_SENT,
        tenant_id=tenant_id,
        actor_id="system",
        actor_type="service",
        correlation_id=str(uuid.uuid4()),
        payload={
            "channel": "email",
            "notification_id": str(notification_id),
            "event_type": "approved",
            "to_address": "member@example.com",
            "subject": "Approved",
            "body": "Your case was approved.",
        },
    )

    await consumer.handle(event)

    email_sender.send.assert_awaited_once_with(
        to="member@example.com",
        subject="Approved",
        body="Your case was approved.",
    )
    print_client.submit.assert_not_awaited()

    async with pg_pool.acquire() as conn:
        delivered_at = await conn.fetchval(
            "SELECT delivered_at FROM notification_log WHERE notification_id=$1",
            notification_id,
        )
    assert delivered_at is not None


@pytest.mark.asyncio
async def test_letter_channel_fetches_minio_and_calls_print(pg_pool):
    from enstellar_workflow.comms.delivery.consumer import NotificationDeliveryConsumer
    from enstellar_workflow.comms.delivery.email import SmtpEmailSender
    from enstellar_workflow.comms.delivery.print_vendor import PrintVendorClient
    from enstellar_workflow.normalization.storage import MinioStore

    notification_id = uuid.uuid4()
    tenant_id = f"tenant-phi-{uuid.uuid4()}"
    case_id = uuid.uuid4()
    await _insert_notif(pg_pool, notification_id, tenant_id, case_id, channel="letter")

    email_sender = AsyncMock(spec=SmtpEmailSender)
    print_client = AsyncMock(spec=PrintVendorClient)
    print_client.submit.return_value = f"stub-{notification_id}"

    minio_store = MagicMock(spec=MinioStore)
    minio_store.download_notice.return_value = "Dear member, your case was approved."

    consumer = NotificationDeliveryConsumer(pg_pool, email_sender, print_client, minio_store)

    event = make_envelope(
        SchemaRef.NOTIFICATION_SENT,
        tenant_id=tenant_id,
        actor_id="system",
        actor_type="service",
        correlation_id=str(uuid.uuid4()),
        payload={
            "channel": "letter",
            "notification_id": str(notification_id),
            "event_type": "approved",
            "body_ref": "test-bucket/tenant-x/notices/2026-06-28/notif-abc.txt",
            "member_phi": True,
        },
    )

    await consumer.handle(event)

    email_sender.send.assert_not_awaited()
    minio_store.download_notice.assert_called_once_with(
        "test-bucket/tenant-x/notices/2026-06-28/notif-abc.txt"
    )
    print_client.submit.assert_awaited_once_with(
        notification_id=str(notification_id),
        body="Dear member, your case was approved.",
    )

    async with pg_pool.acquire() as conn:
        delivered_at = await conn.fetchval(
            "SELECT delivered_at FROM notification_log WHERE notification_id=$1",
            notification_id,
        )
    assert delivered_at is not None


@pytest.mark.asyncio
async def test_unknown_channel_skips_silently(pg_pool):
    from enstellar_workflow.comms.delivery.consumer import NotificationDeliveryConsumer
    from enstellar_workflow.comms.delivery.email import SmtpEmailSender
    from enstellar_workflow.comms.delivery.print_vendor import PrintVendorClient
    from enstellar_workflow.normalization.storage import MinioStore

    email_sender = AsyncMock(spec=SmtpEmailSender)
    print_client = AsyncMock(spec=PrintVendorClient)
    minio_store = MagicMock(spec=MinioStore)
    consumer = NotificationDeliveryConsumer(pg_pool, email_sender, print_client, minio_store)

    event = make_envelope(
        SchemaRef.NOTIFICATION_SENT,
        tenant_id="tenant-unknown",
        actor_id="system",
        actor_type="service",
        correlation_id=str(uuid.uuid4()),
        payload={
            "channel": "sms",
            "notification_id": str(uuid.uuid4()),
            "event_type": "approved",
        },
    )

    # Should return without raising
    await consumer.handle(event)
    email_sender.send.assert_not_awaited()
    print_client.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_non_notification_event_skipped(pg_pool):
    from enstellar_workflow.comms.delivery.consumer import NotificationDeliveryConsumer
    from enstellar_workflow.comms.delivery.email import SmtpEmailSender
    from enstellar_workflow.comms.delivery.print_vendor import PrintVendorClient
    from enstellar_workflow.normalization.storage import MinioStore

    email_sender = AsyncMock(spec=SmtpEmailSender)
    print_client = AsyncMock(spec=PrintVendorClient)
    minio_store = MagicMock(spec=MinioStore)
    consumer = NotificationDeliveryConsumer(pg_pool, email_sender, print_client, minio_store)

    # Wrong schema_ref — should be silently ignored
    event = make_envelope(
        SchemaRef.CASE_STATE_CHANGED,
        tenant_id="tenant-other",
        actor_id="system",
        actor_type="service",
        correlation_id=str(uuid.uuid4()),
        payload={"state": "clinical_review"},
    )

    await consumer.handle(event)
    email_sender.send.assert_not_awaited()
    print_client.submit.assert_not_awaited()
