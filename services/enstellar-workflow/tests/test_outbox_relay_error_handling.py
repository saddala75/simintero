"""Tests for OutboxRelay error handling — DLQ routing and timeout behavior.

Verifies that:
- Rows with retry_count >= MAX_RELAY_RETRIES are moved to DLQ (dlq_at set),
  not retried indefinitely.
- Kafka send timeouts increment retry_count without crashing the relay.
- Transient errors increment retry_count.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from enstellar_workflow.outbox.relay import MAX_RELAY_RETRIES, OutboxRelay


def _make_row(
    event_id: int = 1,
    topic: str = "sim.case.lifecycle",
    key: str = "test-key",
    envelope: str = "{}",
    retry_count: int = 0,
) -> dict:
    """Create a fake outbox row dict matching the asyncpg Record shape."""
    return {
        "event_id": event_id,
        "topic": topic,
        "key": key,
        "envelope": envelope,
        "retry_count": retry_count,
    }


@pytest.fixture
def mock_pool():
    conn = AsyncMock()
    conn.execute = AsyncMock()
    pool = AsyncMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
    return pool, conn


@pytest.fixture
def mock_producer():
    producer = AsyncMock()
    producer.send = AsyncMock()
    return producer


@pytest.mark.asyncio
async def test_relay_moves_poison_message_to_dlq_after_max_retries(mock_pool, mock_producer):
    """After MAX_RELAY_RETRIES, the row must be written to DLQ (dlq_at set), not retried."""
    pool, conn = mock_pool
    relay = OutboxRelay(pool=pool, producer=mock_producer)

    row = _make_row(retry_count=MAX_RELAY_RETRIES)  # exactly at limit → DLQ

    await relay._process_row(conn, row)  # type: ignore[arg-type]

    # DLQ update must have been called
    conn.execute.assert_called_once()
    call_sql: str = conn.execute.call_args[0][0]
    assert "dlq_at" in call_sql, f"Expected DLQ update, got: {call_sql}"
    assert "dlq_reason" in call_sql

    # Kafka send must NOT have been attempted on a DLQ row
    mock_producer.send.assert_not_called()


@pytest.mark.asyncio
async def test_relay_increments_retry_count_on_transient_error(mock_pool, mock_producer):
    """A transient Kafka error must increment retry_count, not crash the relay."""
    pool, conn = mock_pool
    mock_producer.send.side_effect = Exception("broker unavailable")
    relay = OutboxRelay(pool=pool, producer=mock_producer)

    row = _make_row(retry_count=0)

    await relay._process_row(conn, row)  # type: ignore[arg-type]

    # retry_count increment update must have been called
    conn.execute.assert_called_once()
    call_sql: str = conn.execute.call_args[0][0]
    assert "retry_count = retry_count + 1" in call_sql, f"Expected retry increment, got: {call_sql}"


@pytest.mark.asyncio
async def test_relay_increments_retry_on_timeout(mock_pool, mock_producer):
    """A Kafka send timeout must increment retry_count (not crash or DLQ immediately)."""
    pool, conn = mock_pool

    async def _timeout_send(*args, **kwargs):  # type: ignore[override]
        raise asyncio.TimeoutError()

    mock_producer.send.side_effect = _timeout_send
    relay = OutboxRelay(pool=pool, producer=mock_producer)

    row = _make_row(retry_count=2)

    await relay._process_row(conn, row)  # type: ignore[arg-type]

    conn.execute.assert_called_once()
    call_sql: str = conn.execute.call_args[0][0]
    assert "retry_count = retry_count + 1" in call_sql


@pytest.mark.asyncio
async def test_relay_publishes_and_marks_published_on_success(mock_pool, mock_producer):
    """On successful Kafka send, published_at must be set."""
    pool, conn = mock_pool
    mock_producer.send = AsyncMock(return_value=None)
    relay = OutboxRelay(pool=pool, producer=mock_producer)

    row = _make_row(retry_count=0)

    await relay._process_row(conn, row)  # type: ignore[arg-type]

    conn.execute.assert_called_once()
    call_sql: str = conn.execute.call_args[0][0]
    assert "published_at = now()" in call_sql, f"Expected published_at update, got: {call_sql}"
