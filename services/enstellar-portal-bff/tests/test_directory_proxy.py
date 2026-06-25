"""Tests for the thin directory proxy route (B2).

Gated by ``require_auth`` (authenticate only — no role gate); the BFF forwards
the raw bearer to the workflow-engine ``GET /directory`` and passes through the
optional ``role`` filter as a query param.
"""
from __future__ import annotations

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

import enstellar_bff.auth as auth_module
from enstellar_bff.main import app

from tests.conftest import TEST_BEARER, make_principal

ENGINE = "http://workflow-engine:8000"
DIRECTORY = [{"sub": "user-001", "display_name": "Ada Reviewer", "role": "reviewer"}]


@pytest.fixture(autouse=True)
def bypass_auth():
    app.dependency_overrides[auth_module.require_auth] = lambda: make_principal(
        roles=["reviewer"]
    )
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
@respx.mock
async def test_directory_forwards_bearer_and_returns_list() -> None:
    route = respx.get(f"{ENGINE}/directory").mock(
        return_value=Response(200, json=DIRECTORY)
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/directory")

    assert r.status_code == 200
    assert r.json() == DIRECTORY
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"


@pytest.mark.asyncio
@respx.mock
async def test_directory_forwards_role_query_param() -> None:
    route = respx.get(f"{ENGINE}/directory").mock(
        return_value=Response(200, json=DIRECTORY)
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/directory?role=reviewer")

    assert r.status_code == 200
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"
    assert sent.url.params["role"] == "reviewer"
