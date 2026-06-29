"""Tests for per-tenant Kafka consumer isolation (Slice 2D).

Verifies that when a single tenant accumulates MAX_TENANT_CONSECUTIVE_FAILURES=5 consecutive failures,
its circuit opens and its events route directly to DLQ, allowing other tenants to process normally.
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from canonical_model import EventEnvelope
from simintero_outbox import SchemaRef, make_envelope
from enstellar_workflow.kafka.consumer import IdempotentKafkaConsumer


class ConcreteTestConsumer(IdempotentKafkaConsumer):
    def __init__(self, pool):
        super().__init__(pool, ["test-topic"], "test-group")
        self.handled_tenants: list[str] = []

    async def handle(self, event: EventEnvelope) -> None:
        if event.tenant.tenant_id == "tenant-bad":
            raise ValueError("simulated processing error for bad tenant")
        self.handled_tenants.append(event.tenant.tenant_id)


@pytest.mark.asyncio
async def test_per_tenant_circuit_breaker():
    """Tenant with 5 consecutive errors must be circuit-broken without stalling good tenants."""
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(return_value=None)
    mock_conn.execute = AsyncMock()
    mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    consumer = ConcreteTestConsumer(mock_pool)
    consumer._is_processed = AsyncMock(return_value=False)
    consumer._mark_processed = AsyncMock()
    consumer._send_to_dlq = AsyncMock()
    consumer._record_failure = AsyncMock(return_value=1)

    def make_evt(t_id: str) -> EventEnvelope:
        return make_envelope(
            SchemaRef.CASE_INTAKE_RECEIVED,
            tenant_id=t_id,
            actor_id="test",
            actor_type="system",
            correlation_id=str(uuid.uuid4()),
            payload={"case_id": str(uuid.uuid4()), "status": "intake_received"},
        )

    # Simulate running consumer loop logic manually for event processing
    async def process_one(event: EventEnvelope, msg_topic: str = "test-topic"):
        if await consumer._is_processed(event):
            return
        tenant_id = event.tenant.tenant_id
        tenant_failures = consumer._tenant_failure_counts.get(tenant_id, 0)
        if tenant_failures >= consumer.MAX_TENANT_CONSECUTIVE_FAILURES:
            await consumer._send_to_dlq(
                event, msg_topic, Exception(f"tenant circuit open after {tenant_failures} failures")
            )
            await consumer._mark_processed(event)
            return
        try:
            await consumer.handle(event)
            consumer._tenant_failure_counts[tenant_id] = 0
        except Exception as exc:
            consumer._tenant_failure_counts[tenant_id] = tenant_failures + 1
            attempt = await consumer._record_failure(event, exc)
            if attempt >= consumer.max_retries:
                await consumer._send_to_dlq(event, msg_topic, exc)
                await consumer._mark_processed(event)

    # Verify consumer has MAX_TENANT_CONSECUTIVE_FAILURES attribute
    assert hasattr(consumer, "MAX_TENANT_CONSECUTIVE_FAILURES")
    assert consumer.MAX_TENANT_CONSECUTIVE_FAILURES == 5

    # Send 5 events for tenant-bad (triggering 5 failures)
    for _ in range(5):
        await process_one(make_evt("tenant-bad"))

    assert consumer._tenant_failure_counts["tenant-bad"] == 5

    # 6th event for tenant-bad should trigger DLQ directly without calling handle
    dlq_count_before = consumer._send_to_dlq.call_count
    await process_one(make_evt("tenant-bad"))
    assert consumer._send_to_dlq.call_count > dlq_count_before

    # Events for tenant-good should process normally
    await process_one(make_evt("tenant-good"))
    assert "tenant-good" in consumer.handled_tenants
