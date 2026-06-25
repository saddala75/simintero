"""Upstream-status passthrough: engine 4xx → BFF returns same status + detail.

The BFF is a thin pass-through. When a WorkflowClient method raises
``httpx.HTTPStatusError`` (because the workflow-engine returned a non-2xx that
the route let bubble up), the app-level exception handler in main.py must
translate that into a JSONResponse carrying the engine's status code and
detail — instead of leaking a 500.

We prove this by mounting a throwaway route on the FastAPI app that calls a
WorkflowClient method against a respx-mocked engine error, and asserting the
HTTP response mirrors the engine status (403→403, 409→409) with its detail.
"""
from __future__ import annotations

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

from enstellar_bff.clients.workflow import workflow_client
from enstellar_bff.main import app

from tests.conftest import TEST_BEARER

CASE_ID = "00000000-0000-0000-0000-000000000099"
_PROBE_PATH = "/bff/_upstream_probe"


@pytest.fixture(autouse=True)
def probe_route():
    """Mount a throwaway route that exercises a WorkflowClient method so a
    bubbled-up HTTPStatusError reaches the app-level handler."""

    async def _probe() -> dict:
        # close_case raises HTTPStatusError on a non-2xx engine response.
        return await workflow_client.close_case(CASE_ID, TEST_BEARER, reason="x")

    app.add_api_route(_PROBE_PATH, _probe, methods=["GET"])
    yield
    app.router.routes = [
        r for r in app.router.routes if getattr(r, "path", None) != _PROBE_PATH
    ]


@pytest.mark.asyncio
@respx.mock
async def test_engine_409_propagates_as_409() -> None:
    respx.post(f"http://workflow-engine:8000/cases/{CASE_ID}/close").mock(
        return_value=Response(409, json={"detail": "case already closed"})
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get(_PROBE_PATH)
    assert r.status_code == 409
    assert r.json()["detail"] == "case already closed"


@pytest.mark.asyncio
@respx.mock
async def test_engine_403_propagates_as_403() -> None:
    respx.post(f"http://workflow-engine:8000/cases/{CASE_ID}/close").mock(
        return_value=Response(403, json={"detail": "tenant mismatch"})
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get(_PROBE_PATH)
    assert r.status_code == 403
    assert r.json()["detail"] == "tenant mismatch"


@pytest.mark.asyncio
@respx.mock
async def test_engine_5xx_is_remapped_to_502() -> None:
    """An engine 500 must NOT surface as a BFF 500 (indistinguishable from a
    BFF crash) — it's remapped to 502 Bad Gateway."""
    respx.post(f"http://workflow-engine:8000/cases/{CASE_ID}/close").mock(
        return_value=Response(500, json={"detail": "engine boom"})
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get(_PROBE_PATH)
    assert r.status_code == 502
    assert r.json()["detail"] == "Upstream error"


@pytest.mark.asyncio
@respx.mock
async def test_close_case_forwards_bearer_and_raises_on_error() -> None:
    """Unit-level: close_case forwards the bearer via _auth and raises on 409."""
    import httpx

    route = respx.post(f"http://workflow-engine:8000/cases/{CASE_ID}/close").mock(
        return_value=Response(409, json={"detail": "nope"})
    )
    with pytest.raises(httpx.HTTPStatusError):
        await workflow_client.close_case(CASE_ID, TEST_BEARER, reason="x")
    assert route.called
    assert route.calls[0].request.headers["Authorization"] == f"Bearer {TEST_BEARER}"
