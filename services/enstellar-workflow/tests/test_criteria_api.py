"""Integration tests for GET /cases/{id}/criteria."""
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
    # Point the workflow pool at the test DB
    monkeypatch.setenv(
        "WORKFLOW_DB_URL",
        db_dsn.replace("postgresql://", "postgresql+asyncpg://"),
    )
    # Reset singletons so the new DSN is picked up
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


@pytest.mark.asyncio
async def test_get_criteria_empty_for_new_case(ac: AsyncClient):
    """GET /cases/{id}/criteria on a freshly created case returns 200 with []."""
    case = make_case()
    resp = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 201

    resp = await ac.get(
        f"/cases/{case.case_id}/criteria",
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_get_criteria_returns_seeded_rows(ac: AsyncClient, pg_pool: asyncpg.Pool):
    """A row inserted directly into case_criteria is returned by the endpoint."""
    case = make_case()
    resp = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 201

    # Insert a criteria row directly via the pool (bypassing the repo)
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO case_criteria
                (id, case_id, tenant_id, criterion_id, text, status, evidence, citations)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
            """,
            uuid.uuid4(),
            case.case_id,
            case.tenant_id,
            "criterion-001",
            "Patient has prior authorization for the requested service.",
            "met",
            None,
            json.dumps(["citation-A"]),
        )

    resp = await ac.get(
        f"/cases/{case.case_id}/criteria",
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    row = data[0]
    assert row["criterion_id"] == "criterion-001"
    assert row["text"] == "Patient has prior authorization for the requested service."
    assert row["status"] == "met"
    assert row["citations"] == ["citation-A"]


@pytest.mark.asyncio
async def test_get_criteria_tenant_isolation(ac: AsyncClient, pg_pool: asyncpg.Pool):
    """Criteria for tenant-A are NOT visible when querying as tenant-B.

    Returns 200 with [] — not 404 — because the case_id is valid but the tenant
    filter correctly excludes rows belonging to a different tenant.
    """
    case = make_case(tenant_id="tenant-A")
    resp = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 201

    # Insert a criteria row scoped to tenant-A
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO case_criteria
                (id, case_id, tenant_id, criterion_id, text, status, evidence, citations)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
            """,
            uuid.uuid4(),
            case.case_id,
            "tenant-A",
            "criterion-100",
            "Some criterion for tenant-A.",
            "gap",
            None,
            json.dumps([]),
        )

    # Request with a different tenant must not see the tenant-A row
    resp = await ac.get(
        f"/cases/{case.case_id}/criteria",
        headers={"Authorization": "Bearer tenant-B"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_get_criteria_missing_auth_returns_401(ac: AsyncClient):
    """Omitting Authorization header returns 401 Unauthorized."""
    resp = await ac.get(f"/cases/{uuid.uuid4()}/criteria")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_patch_criterion_status(ac: AsyncClient, pg_pool: asyncpg.Pool):
    """PATCH /cases/{id}/criteria/{criterion_id} updates criterion status in database."""
    case = make_case()
    resp = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 201

    crit_uuid = uuid.uuid4()
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO case_criteria
                (id, case_id, tenant_id, criterion_id, text, status, evidence, citations)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
            """,
            crit_uuid,
            case.case_id,
            case.tenant_id,
            "criterion-500",
            "Test criterion status update.",
            "unknown",
            None,
            json.dumps([]),
        )

    patch_resp = await ac.patch(
        f"/cases/{case.case_id}/criteria/{crit_uuid}",
        json={"status": "met"},
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json() == {"status": "met"}

