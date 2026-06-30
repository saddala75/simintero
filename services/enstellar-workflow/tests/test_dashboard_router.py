"""Tests for GET /internal/dashboard."""
from __future__ import annotations
import contextlib
import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport
from enstellar_workflow.main import app

TENANT = "demo-tenant"


@pytest.mark.asyncio
async def test_dashboard_returns_expected_shape():
    """Dashboard returns all required keys with correct types."""
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(side_effect=[
        # _queue main row
        {"total_open": 5, "urgent": 2, "avg_age_hours": 12.5},
        # _queue clocks row
        {"n": 1},
        # _appeals
        {"open": 3, "overdue": 0},
        # _grievances
        {"open": 2, "unacknowledged": 1},
        # _ai
        {"n": 4},
    ])
    mock_conn.fetch = AsyncMock(side_effect=[
        [],  # _my_cases
        [],  # _recent_activity
    ])

    @contextlib.asynccontextmanager
    async def mock_tx(pool, tenant_id):
        yield mock_conn

    mock_pool = AsyncMock()

    with patch("enstellar_workflow.api.dashboard_router.get_pool", return_value=mock_pool), \
         patch("enstellar_workflow.api.dashboard_router.tenant_transaction", mock_tx):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(
                "/internal/dashboard",
                headers={"Authorization": f"Bearer {TENANT}"},
            )

    assert r.status_code == 200
    data = r.json()
    assert "queue" in data
    assert "my_cases" in data
    assert "appeals" in data
    assert "grievances" in data
    assert "ai" in data
    assert "recent_activity" in data
    assert data["queue"]["total_open"] == 5
    assert data["queue"]["sla_at_risk"] == 1
    assert data["ai"]["avg_groundedness"] is None
