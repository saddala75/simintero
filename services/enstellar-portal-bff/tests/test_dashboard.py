"""Tests for GET /bff/dashboard — live aggregation (mocked upstreams)."""
from __future__ import annotations

import pytest
import respx
import httpx
from httpx import AsyncClient, ASGITransport

from enstellar_bff.main import app
import enstellar_bff.auth as auth_module
from tests.conftest import make_principal


WORKFLOW_STUB = {
    "queue": {"total_open": 3, "urgent": 1, "sla_at_risk": 0, "avg_age_hours": 8.0},
    "my_cases": [],
    "appeals": {"open": 1, "overdue": 0},
    "grievances": {"open": 0, "unacknowledged": 0},
    "ai": {"avg_groundedness": None, "cases_reviewed_today": 5, "cases_with_gaps": None},
    "recent_activity": [],
}
VKAS_STUB = {"by_status": {"active": 42, "draft": 3}}


@pytest.fixture(autouse=True)
def _override_auth():
    async def _fake_reviewer():
        return make_principal()

    app.dependency_overrides[auth_module.require_reviewer] = _fake_reviewer
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
@respx.mock
async def test_dashboard_live():
    respx.get("http://workflow-engine:8000/internal/dashboard").mock(
        return_value=httpx.Response(200, json=WORKFLOW_STUB)
    )
    respx.get("http://vkas:3040/v1/stats").mock(
        return_value=httpx.Response(200, json=VKAS_STUB)
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/dashboard", headers={"Authorization": "Bearer tok"})

    assert r.status_code == 200
    data = r.json()
    assert data["queue"]["total_open"] == 3
    assert data["policies"]["active"] == 42
    assert data["policies"]["drafts_pending"] == 3
    assert data["quality"]["active_measures"] is None
    assert data["ai"]["avg_groundedness"] is None
    assert data["ai"]["cases_reviewed_today"] == 5


@pytest.mark.asyncio
@respx.mock
async def test_dashboard_vkas_failure_returns_null_policies():
    """VKAS failure should not crash the dashboard — policies fields become None."""
    respx.get("http://workflow-engine:8000/internal/dashboard").mock(
        return_value=httpx.Response(200, json=WORKFLOW_STUB)
    )
    respx.get("http://vkas:3040/v1/stats").mock(
        side_effect=httpx.ConnectError("vkas down")
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/dashboard", headers={"Authorization": "Bearer tok"})

    assert r.status_code == 200
    data = r.json()
    assert data["policies"]["active"] is None
