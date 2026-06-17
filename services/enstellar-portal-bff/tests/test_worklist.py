"""Tests for GET /bff/queues/{queue_id}/worklist.

Uses respx to mock the upstream workflow-engine call.
Uses monkeypatch to bypass JWT validation (returns fixed principal).
"""
from __future__ import annotations

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

from enstellar_bff.main import app
import enstellar_bff.auth as auth_module

from tests.conftest import make_principal


@pytest.fixture(autouse=True)
def bypass_auth(monkeypatch):
    """Replace require_reviewer with a no-op yielding (BffContext, bearer)."""

    async def _fake_reviewer():
        return make_principal()

    # Override the dependency on the app
    app.dependency_overrides[auth_module.require_reviewer] = _fake_reviewer
    yield
    app.dependency_overrides.clear()


def _worklist_payload(items: list[dict], total: int | None = None) -> dict:
    return {"items": items, "total": total if total is not None else len(items)}


def _item(
    case_id: str = "00000000-0000-0000-0000-000000000001",
    name: str = "Jane Doe",
    sla_deadline: str | None = None,
    status: str = "clinical_review",
    urgency: str = "standard",
    correlation_id: str = "corr-001",
) -> dict:
    return {
        "case_id": case_id,
        "correlation_id": correlation_id,
        "member": {"name": name},
        "service_lines": [{"procedure_description": "PT Eval"}],
        "lob": "commercial",
        "status": status,
        "urgency": urgency,
        "sla_deadline": sla_deadline,
    }


@pytest.mark.asyncio
@respx.mock
async def test_worklist_returns_items() -> None:
    respx.get("http://workflow-engine:8000/queues/default/worklist").mock(
        return_value=Response(
            200,
            json=_worklist_payload([_item()]),
        )
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/queues/default/worklist")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["member_name"] == "Jane Doe"
    assert body["items"][0]["correlation_id"] == "corr-001"


@pytest.mark.asyncio
@respx.mock
async def test_worklist_sorted_by_hours_remaining_ascending() -> None:
    """Items are sorted red-first (fewest hours remaining first)."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    soon = (now + timedelta(hours=4)).isoformat()   # red
    later = (now + timedelta(hours=60)).isoformat()  # green

    respx.get("http://workflow-engine:8000/queues/default/worklist").mock(
        return_value=Response(
            200,
            json=_worklist_payload([
                _item(case_id="00000000-0000-0000-0000-000000000002", sla_deadline=later),
                _item(case_id="00000000-0000-0000-0000-000000000001", sla_deadline=soon),
            ]),
        )
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/queues/default/worklist")
    assert r.status_code == 200
    items = r.json()["items"]
    assert items[0]["case_id"] == "00000000-0000-0000-0000-000000000001"  # red first
    assert items[0]["sla"]["rag"] == "red"
    assert items[1]["sla"]["rag"] == "green"


@pytest.mark.asyncio
@respx.mock
async def test_sla_rag_amber_boundary() -> None:
    """hours_remaining=20 → amber."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    deadline = (now + timedelta(hours=20)).isoformat()

    respx.get("http://workflow-engine:8000/queues/default/worklist").mock(
        return_value=Response(
            200,
            json=_worklist_payload([_item(sla_deadline=deadline)]),
        )
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/queues/default/worklist")
    assert r.status_code == 200
    assert r.json()["items"][0]["sla"]["rag"] == "amber"


@pytest.mark.asyncio
@respx.mock
async def test_no_sla_deadline_produces_null_sla() -> None:
    respx.get("http://workflow-engine:8000/queues/default/worklist").mock(
        return_value=Response(200, json=_worklist_payload([_item(sla_deadline=None)]))
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/queues/default/worklist")
    assert r.status_code == 200
    assert r.json()["items"][0]["sla"] is None


@pytest.mark.asyncio
@respx.mock
async def test_pagination_params_forwarded() -> None:
    """page and page_size query params are forwarded to workflow-engine."""
    route = respx.get("http://workflow-engine:8000/queues/default/worklist").mock(
        return_value=Response(200, json=_worklist_payload([]))
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.get("/bff/queues/default/worklist?page=2&page_size=10")
    assert route.called
    called_url = str(route.calls[0].request.url)
    assert "page=2" in called_url
    assert "page_size=10" in called_url
