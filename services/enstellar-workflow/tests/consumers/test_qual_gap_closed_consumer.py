"""Tests for QualGapClosedConsumer.

Verifies that when a QualGapClosed event is received:
  1. If an outreach task exists for the gap, the Task Service is called to resolve it.
  2. If no outreach task exists, the event is acked without error (valid state).
"""
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from simintero_outbox import make_envelope

from enstellar_workflow.consumers.qual_gap_closed_consumer import QualGapClosedConsumer


def _make_gap_closed_event(gap_id: str = "gap-01", member_id: str = "member-001"):
    return make_envelope(
        "sim.qual.gap/QualGapClosed/v1",
        tenant_id="tenant-dev",
        actor_id="system",
        actor_type="service",
        correlation_id=gap_id,
        payload={
            "event_type": "QualGapClosed",
            "gap_id": gap_id,
            "member_id": member_id,
            "measure_ref": "hedis:BCS-E",
            "closed_at": "2026-01-01T00:00:00Z",
        },
    )


def _make_pool(fetchrow_return):
    """Build a minimal asyncpg pool mock that supports `async with pool.acquire() as conn`."""
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value=fetchrow_return)

    @asynccontextmanager
    async def _acquire():
        yield conn

    pool = MagicMock()
    pool.acquire = _acquire
    return pool, conn


@pytest.mark.asyncio
async def test_resolves_outreach_task_when_gap_has_one():
    """When outreach_task_ref exists for the gap, POST to Task Service to resolve it."""
    pool, conn = _make_pool(fetchrow_return={"task_id": "task-001"})

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=MagicMock(status_code=200))

        consumer = QualGapClosedConsumer(pool)
        await consumer.handle(_make_gap_closed_event())

    mock_client.post.assert_called_once()
    call_url = mock_client.post.call_args[0][0]
    assert "task-001" in call_url
    assert "resolved" in call_url


@pytest.mark.asyncio
async def test_acks_without_error_when_no_outreach_task():
    """When no outreach_task_ref exists for the gap, log and return — no Task Service call."""
    pool, conn = _make_pool(fetchrow_return=None)

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock()

        consumer = QualGapClosedConsumer(pool)
        await consumer.handle(_make_gap_closed_event())

    # Task Service should NOT be called
    mock_client.post.assert_not_called()
