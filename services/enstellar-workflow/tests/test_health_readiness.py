"""Tests for /ready readiness endpoint with dependency checks.

Tests the /ready route logic directly by calling the endpoint function,
bypassing the lifespan and avoiding real DB connections.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.mark.asyncio
async def test_readiness_returns_503_when_pool_is_none():
    """GET /ready returns 503 when app.state.pool is None."""
    from enstellar_workflow.main import readiness

    # Build a minimal mock request with app.state.pool = None
    mock_app = MagicMock()
    mock_app.state.pool = None
    mock_request = MagicMock()
    mock_request.app = mock_app

    response = await readiness(mock_request)

    assert response.status_code == 503
    import json
    data = json.loads(response.body)
    assert data["postgres"] == "unreachable"
    assert data["status"] == "degraded"


@pytest.mark.asyncio
async def test_readiness_returns_200_when_postgres_healthy():
    """GET /ready returns 200 when the mock pool responds to SELECT 1."""
    from enstellar_workflow.main import readiness

    # Build a mock pool that answers fetchval(SELECT 1) = 1
    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(return_value=1)
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=False)

    mock_pool = MagicMock()
    mock_pool.acquire.return_value = mock_conn

    mock_app = MagicMock()
    mock_app.state.pool = mock_pool
    mock_request = MagicMock()
    mock_request.app = mock_app

    response = await readiness(mock_request)

    assert response.status_code == 200
    import json
    data = json.loads(response.body)
    assert data["postgres"] == "ok"
    assert data["status"] == "ready"


def test_ready_endpoint_is_registered():
    """The /ready route must be registered on the FastAPI app."""
    from enstellar_workflow.main import app

    routes = {r.path for r in app.routes if hasattr(r, "path")}  # type: ignore[union-attr]
    assert "/ready" in routes, (
        "/ready endpoint is not registered — docker-compose healthcheck will fail. "
        "Add @app.get('/ready') to main.py."
    )


def test_health_endpoint_is_registered():
    """The /health liveness probe must remain registered."""
    from enstellar_workflow.main import app

    routes = {r.path for r in app.routes if hasattr(r, "path")}  # type: ignore[union-attr]
    assert "/health" in routes, "/health liveness probe is missing from main.py."
