"""Tests for GET /bff/admin/dlq/* proxy routes."""
from __future__ import annotations

import pytest
import respx
import httpx
from httpx import AsyncClient, ASGITransport

from enstellar_bff.main import app
from enstellar_bff.auth import require_saas_admin
from tests.conftest import make_principal

OUTBOX_STUB = {
    "events": [
        {
            "event_id": "evt-001",
            "topic": "prior_auth.submitted",
            "tenant_id": "demo-tenant",
            "dlq_at": "2026-06-30T10:00:00",
            "dlq_reason": "Kafka timeout",
            "retry_count": 3,
        }
    ]
}
CONSUMER_STUB = {
    "events": [
        {
            "event_id": "evt-002",
            "consumer_group": "intake-consumer",
            "topic": "prior_auth.submitted",
            "error": "DB connection refused",
            "failed_at": "2026-06-30T09:00:00",
            "replayed_at": None,
        }
    ]
}


@pytest.fixture(autouse=True)
def _override_auth():
    async def _fake_admin():
        return make_principal(roles=["saas_admin"])
    app.dependency_overrides[require_saas_admin] = _fake_admin
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
@respx.mock
async def test_list_outbox_dlq():
    respx.get("http://workflow-engine:8000/admin/dlq/outbox").mock(
        return_value=httpx.Response(200, json=OUTBOX_STUB)
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/bff/admin/dlq/outbox", headers={"Authorization": "Bearer tok"})
    assert r.status_code == 200
    assert r.json()["events"][0]["event_id"] == "evt-001"


@pytest.mark.asyncio
@respx.mock
async def test_list_consumer_dlq():
    respx.get("http://workflow-engine:8000/admin/dlq/consumers").mock(
        return_value=httpx.Response(200, json=CONSUMER_STUB)
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/bff/admin/dlq/consumers", headers={"Authorization": "Bearer tok"})
    assert r.status_code == 200
    assert r.json()["events"][0]["consumer_group"] == "intake-consumer"


@pytest.mark.asyncio
@respx.mock
async def test_reprocess_outbox_event():
    respx.post("http://workflow-engine:8000/admin/dlq/outbox/evt-001/reprocess").mock(
        return_value=httpx.Response(200, json={"requeued": True, "event_id": "evt-001"})
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/bff/admin/dlq/outbox/evt-001/reprocess",
            headers={"Authorization": "Bearer tok"},
        )
    assert r.status_code == 200
    assert r.json()["requeued"] is True


@pytest.mark.asyncio
@respx.mock
async def test_reprocess_404_propagated():
    respx.post("http://workflow-engine:8000/admin/dlq/outbox/missing/reprocess").mock(
        return_value=httpx.Response(404, json={"detail": "Event missing not found in outbox DLQ"})
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/bff/admin/dlq/outbox/missing/reprocess",
            headers={"Authorization": "Bearer tok"},
        )
    assert r.status_code == 404
