"""Test that _emit_failed_event sets revital_bypassed = TRUE on the case row.

NCQA AI governance (P2.6): when Revital is unavailable and the case proceeds
without AI input, the workflow_instances row must record this so the bypass
is traceable for attestation purposes.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import asyncpg
import pytest

from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.consumers.clinical_review_consumer import ClinicalReviewConsumer
from tests.conftest import make_case


@pytest.mark.asyncio
async def test_revital_bypassed_set_on_failed_event(pg_pool: asyncpg.Pool) -> None:
    """_emit_failed_event atomically publishes the outbox event and flips
    revital_bypassed = TRUE on workflow_instances in the same transaction."""
    case = make_case()

    # Seed the case row so the UPDATE has a target row.
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    # Wire up consumer with a mock outbox — no real Kafka or DB publish needed.
    consumer = ClinicalReviewConsumer(pg_pool)
    mock_outbox = AsyncMock()
    consumer._outbox = mock_outbox

    # Call the method under test directly.
    await consumer._emit_failed_event(
        case=case,
        agent_id="test-agent",
        reason="Revital unavailable",
        correlation_id=case.correlation_id,
    )

    # Verify the column was set (superuser connection bypasses RLS).
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT revital_bypassed FROM workflow_instances WHERE case_id = $1",
            case.case_id,
        )

    assert row is not None, "Case row not found after _emit_failed_event"
    assert row["revital_bypassed"] is True, (
        "revital_bypassed must be TRUE after _emit_failed_event"
    )

    # Outbox publish must have been called exactly once.
    mock_outbox.publish.assert_awaited_once()
