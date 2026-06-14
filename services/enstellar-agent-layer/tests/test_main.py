"""Tests for FastAPI application entry point."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient


async def test_healthz_returns_ok() -> None:
    from enstellar_agents.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/healthz")

    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
