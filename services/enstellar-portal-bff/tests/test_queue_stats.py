"""Tests for GET /bff/queues/{queue_id}/stats.

Uses respx to mock the upstream workflow-engine call.
Uses dependency_overrides to bypass JWT validation.
"""
from __future__ import annotations

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

from enstellar_bff.main import app
import enstellar_bff.auth as auth_module

FIXED_PRINCIPAL = {"tenant_id": "tenant-abc", "roles": ["reviewer"], "sub": "user-001"}
STATS_PAYLOAD = {
    "ai_determinations": 12,
    "adverse_human_signed_pct": 100.0,
    "sla_compliance_expedited_pct": 94.5,
    "period_start": "2026-05-07",
    "period_end": "2026-06-07",
}


@pytest.mark.asyncio
@respx.mock
async def test_get_queue_stats_returns_data_with_cache_header() -> None:
    async def _fake_reviewer():
        return FIXED_PRINCIPAL

    app.dependency_overrides[auth_module.require_reviewer] = _fake_reviewer
    respx.get("http://workflow-engine:8000/queues/standard/stats").mock(
        return_value=Response(200, json=STATS_PAYLOAD)
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get("/bff/queues/standard/stats")
    app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert body["ai_determinations"] == 12
    assert body["adverse_human_signed_pct"] == 100.0
    assert body["sla_compliance_expedited_pct"] == 94.5
    assert "Cache-Control" in resp.headers
    assert "max-age=60" in resp.headers["Cache-Control"]


@pytest.mark.asyncio
async def test_get_queue_stats_tenant_enforced() -> None:
    """No auth header → 401 (or 403 if token present without role)."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get("/bff/queues/standard/stats")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
@respx.mock
async def test_get_queue_stats_all_fields_present() -> None:
    async def _fake_reviewer():
        return FIXED_PRINCIPAL

    app.dependency_overrides[auth_module.require_reviewer] = _fake_reviewer
    respx.get("http://workflow-engine:8000/queues/standard/stats").mock(
        return_value=Response(200, json=STATS_PAYLOAD)
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get("/bff/queues/standard/stats")
    app.dependency_overrides.clear()

    body = resp.json()
    for field in (
        "ai_determinations",
        "adverse_human_signed_pct",
        "sla_compliance_expedited_pct",
        "period_start",
        "period_end",
    ):
        assert field in body, f"Missing field: {field}"
