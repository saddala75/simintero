"""Integration tests for GET /cases/{case_id}/replay-evaluation (P2.7).

Tests the happy path (stored artifact pins → Digicore replay) and two error
cases (no pins → 422, unknown case → 404).

The DigiCoreClient is mocked via patch so tests never make real HTTP calls.
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_connectors.digicore.models import EvaluationResponse
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app
from simintero_tenant_context import tenant_transaction
from tests.conftest import make_case


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def ac(db_dsn: str, monkeypatch) -> AsyncClient:
    """AsyncClient targeting the FastAPI app, wired to the Testcontainers PostgreSQL."""
    monkeypatch.setenv(
        "WORKFLOW_DB_URL",
        db_dsn.replace("postgresql://", "postgresql+asyncpg://"),
    )
    import enstellar_workflow.config as cfg_mod
    import enstellar_workflow.db.connection as conn_mod

    cfg_mod._settings = None
    conn_mod._pool = None

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client

    await close_pool()
    conn_mod._pool = None


async def _seed_case_with_pins(pool, case, artifact_pins: list[str]) -> None:
    """Insert a case and set its artifact_pins directly in the DB."""
    await CaseService(pool).create_case(case)
    async with tenant_transaction(pool, case.tenant_id) as conn:
        await conn.execute(
            "UPDATE workflow_instances SET artifact_pins = $1"
            " WHERE case_id = $2 AND tenant_id = $3",
            artifact_pins,
            case.case_id,
            case.tenant_id,
        )


# Canned EvaluationResponse returned by the mocked DigiCoreClient.
_MOCK_EVAL_RESPONSE = EvaluationResponse(
    outcome="meets_all",
    requirementGaps=[],
    logicPath=[],
    autoDetermination={},
    pins=["urn:sim:policy:test:1.0.0"],
    traceRef="trace-replay-001",
)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_replay_returns_digicore_result(ac: AsyncClient, pg_pool):
    """GET /cases/{id}/replay-evaluation calls Digicore with stored artifact pins
    and returns the raw EvaluationResponse."""
    case = make_case(tenant_id="tenant-replay-happy")
    await _seed_case_with_pins(pg_pool, case, ["urn:sim:policy:test:1.0.0"])

    with patch("enstellar_workflow.api.replay._digicore") as mock_digicore:
        mock_digicore.evaluate_raw = AsyncMock(return_value=_MOCK_EVAL_RESPONSE)

        resp = await ac.get(
            f"/cases/{case.case_id}/replay-evaluation",
            headers={"Authorization": f"Bearer {case.tenant_id}"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["outcome"] == "meets_all"
    assert data["pins"] == ["urn:sim:policy:test:1.0.0"]

    # Confirm evaluate_raw was called once and received the stored URN pins.
    mock_digicore.evaluate_raw.assert_awaited_once()
    eval_req = mock_digicore.evaluate_raw.call_args[0][0]
    assert eval_req.pins == ["urn:sim:policy:test:1.0.0"]
    assert eval_req.caseId == str(case.case_id)
    assert eval_req.tenant_id == case.tenant_id


@pytest.mark.asyncio
async def test_replay_422_when_no_pins(ac: AsyncClient, pg_pool):
    """Returns 422 when artifact_pins is empty (case predates this feature)."""
    case = make_case(tenant_id="tenant-replay-422")
    # Insert with default empty artifact_pins.
    await CaseService(pg_pool).create_case(case)

    resp = await ac.get(
        f"/cases/{case.case_id}/replay-evaluation",
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )

    assert resp.status_code == 422, resp.text
    assert "artifact pins" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_replay_404_when_case_not_found(ac: AsyncClient):
    """Returns 404 for an unknown case_id."""
    resp = await ac.get(
        f"/cases/{uuid.uuid4()}/replay-evaluation",
        headers={"Authorization": "Bearer tenant-t08"},
    )

    assert resp.status_code == 404, resp.text
