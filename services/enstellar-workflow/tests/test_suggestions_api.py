"""Integration tests for GET /cases/{id}/suggestions and POST /cases/{id}/suggestions/{sid}/action."""
import json
import uuid

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app
from tests.conftest import make_case


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


async def _create_case(ac: AsyncClient):
    """Helper: POST a new case and return it."""
    case = make_case()
    resp = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 201
    return case


async def _insert_suggestion(
    pg_pool: asyncpg.Pool,
    case,
    suggestion_id: uuid.UUID | None = None,
    status: str = "pending",
) -> uuid.UUID:
    """Helper: insert a suggestion row directly into the DB."""
    sid = suggestion_id or uuid.uuid4()
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO case_suggestions
                (id, case_id, tenant_id, agent_id, title, body, confidence, citations, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
            """,
            sid,
            case.case_id,
            case.tenant_id,
            "triage-agent",
            "Consider ordering MRI",
            "Based on clinical criteria, an MRI is warranted.",
            0.87,
            json.dumps(["ref-001"]),
            status,
        )
    return sid


@pytest.mark.asyncio
async def test_get_suggestions_empty_for_new_case(ac: AsyncClient):
    """GET /cases/{id}/suggestions on a freshly created case returns 200 with []."""
    case = await _create_case(ac)
    resp = await ac.get(
        f"/cases/{case.case_id}/suggestions",
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_get_suggestions_returns_seeded_rows(ac: AsyncClient, pg_pool: asyncpg.Pool):
    """A suggestion inserted directly into case_suggestions is returned by the endpoint."""
    case = await _create_case(ac)
    sid = await _insert_suggestion(pg_pool, case)

    resp = await ac.get(
        f"/cases/{case.case_id}/suggestions",
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    row = data[0]
    assert row["id"] == str(sid)
    assert row["agent_id"] == "triage-agent"
    assert row["title"] == "Consider ordering MRI"
    assert row["body"] == "Based on clinical criteria, an MRI is warranted."
    assert abs(row["confidence"] - 0.87) < 1e-6
    assert row["citations"] == ["ref-001"]
    assert row["status"] == "pending"
    assert row["reviewer_id"] is None
    assert row["reviewed_at"] is None


@pytest.mark.asyncio
async def test_accept_suggestion_records_provenance(ac: AsyncClient, pg_pool: asyncpg.Pool):
    """POST action=accepted updates status, reviewer_id, and reviewed_at in the DB."""
    case = await _create_case(ac)
    sid = await _insert_suggestion(pg_pool, case)

    resp = await ac.post(
        f"/cases/{case.case_id}/suggestions/{sid}/action",
        json={"action": "accepted", "reviewer_id": "reviewer-42"},
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["suggestion_id"] == str(sid)
    assert body["status"] == "accepted"

    # Verify DB state directly
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, reviewer_id, reviewed_at FROM case_suggestions WHERE id = $1",
            sid,
        )
    assert row["status"] == "accepted"
    assert row["reviewer_id"] == "reviewer-42"
    assert row["reviewed_at"] is not None


@pytest.mark.asyncio
async def test_reject_suggestion_updates_status(ac: AsyncClient, pg_pool: asyncpg.Pool):
    """POST action=rejected sets status to 'rejected' in the DB."""
    case = await _create_case(ac)
    sid = await _insert_suggestion(pg_pool, case)

    resp = await ac.post(
        f"/cases/{case.case_id}/suggestions/{sid}/action",
        json={"action": "rejected", "reviewer_id": "reviewer-99"},
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status FROM case_suggestions WHERE id = $1",
            sid,
        )
    assert row["status"] == "rejected"


@pytest.mark.asyncio
async def test_suggestion_action_404_for_unknown_id(ac: AsyncClient):
    """POST action on a non-existent suggestion_id returns 404."""
    case = await _create_case(ac)
    random_sid = uuid.uuid4()

    resp = await ac.post(
        f"/cases/{case.case_id}/suggestions/{random_sid}/action",
        json={"action": "accepted", "reviewer_id": "reviewer-42"},
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_action_rejects_suggestion_from_different_case(ac: AsyncClient, pg_pool: asyncpg.Pool) -> None:
    """POST action on suggestion belonging to a different case returns 404."""
    # Create two cases (same tenant, different case_ids)
    case_a = make_case()
    case_b = make_case()
    for case in [case_a, case_b]:
        await ac.post("/cases", content=case.model_dump_json(), headers={"Content-Type": "application/json"})

    # Seed a suggestion belonging to case_b
    sid = uuid.uuid4()
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO case_suggestions
                (id, case_id, tenant_id, agent_id, title, body, confidence, citations)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            sid, case_b.case_id, case_b.tenant_id,
            "triage-v1", "Suggested queue: expedited", "Route to expedited.", 0.88, json.dumps([]),
        )

    # POST action on case_a with suggestion from case_b → should 404
    r = await ac.post(
        f"/cases/{case_a.case_id}/suggestions/{sid}/action",
        json={"action": "accepted", "reviewer_id": "r-1"},
        headers={"Authorization": f"Bearer {case_a.tenant_id}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_suggestions_tenant_isolation(ac: AsyncClient, pg_pool: asyncpg.Pool) -> None:
    """Suggestions from a different tenant are not returned."""
    case = make_case(tenant_id="tenant-X")
    await ac.post("/cases", content=case.model_dump_json(), headers={"Content-Type": "application/json"})

    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO case_suggestions
                (id, case_id, tenant_id, agent_id, title, body, confidence, citations)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            uuid.uuid4(), case.case_id, "tenant-X",
            "triage-v1", "Suggested queue: standard", "Route to standard.", 0.75, json.dumps([]),
        )

    # Request with a different tenant_id → should return empty list
    r = await ac.get(
        f"/cases/{case.case_id}/suggestions",
        headers={"Authorization": "Bearer tenant-Y"},
    )
    assert r.status_code == 200
    assert r.json() == []
