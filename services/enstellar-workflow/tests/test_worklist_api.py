"""Integration tests for GET /queues/{queue_id}/worklist."""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app
from tests.conftest import make_case


@pytest_asyncio.fixture
async def ac(db_dsn: str, monkeypatch) -> AsyncClient:
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


@pytest_asyncio.fixture
async def seeded(db_dsn: str) -> dict:
    """Insert two cases for tenant-wl and one for tenant-other."""
    conn = await __import__("asyncpg").connect(db_dsn)
    cases = []
    for i in range(2):
        c = make_case(tenant_id="tenant-wl")
        cases.append(c)
        await conn.execute(
            """
            INSERT INTO workflow_instances
              (case_id, tenant_id, correlation_id, lob, program, status, urgency,
               workflow_def_version, case_json, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
            """,
            c.case_id, c.tenant_id, c.correlation_id, c.lob, c.program,
            c.status.value, c.urgency.value, "v1",
            __import__("json").dumps(c.model_dump(mode="json")),
            c.created_at, c.updated_at,
        )
    # one case for a different tenant
    other = make_case(tenant_id="tenant-other")
    await conn.execute(
        """
        INSERT INTO workflow_instances
          (case_id, tenant_id, correlation_id, lob, program, status, urgency,
           workflow_def_version, case_json, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
        """,
        other.case_id, other.tenant_id, other.correlation_id, other.lob, other.program,
        other.status.value, other.urgency.value, "v1",
        __import__("json").dumps(other.model_dump(mode="json")),
        other.created_at, other.updated_at,
    )
    await conn.close()
    return {"cases": cases, "other": other}


@pytest.mark.asyncio
async def test_default_queue_returns_tenant_cases(ac, seeded):
    r = await ac.get("/queues/default/worklist", headers={"Authorization": "Bearer tenant-wl"})
    assert r.status_code == 200
    data = r.json()
    assert data["total"] >= 2
    ids = {item["case_id"] for item in data["items"]}
    for c in seeded["cases"]:
        assert str(c.case_id) in ids


@pytest.mark.asyncio
async def test_worklist_excludes_other_tenant(ac, seeded):
    r = await ac.get("/queues/default/worklist", headers={"Authorization": "Bearer tenant-wl"})
    assert r.status_code == 200
    ids = {item["case_id"] for item in r.json()["items"]}
    assert str(seeded["other"].case_id) not in ids


@pytest.mark.asyncio
async def test_item_shape(ac, seeded):
    r = await ac.get("/queues/default/worklist", headers={"Authorization": "Bearer tenant-wl"})
    item = r.json()["items"][0]
    assert "case_id" in item
    assert "status" in item
    assert "urgency" in item
    assert "lob" in item
    assert "member" in item
    assert "name" in item["member"]
    assert "service_lines" in item
    assert item["sla_deadline"] is None  # no clock seeded


@pytest.mark.asyncio
async def test_item_includes_correlation_id(ac, seeded):
    """Each worklist item exposes correlation_id (matching the seeded value)
    alongside status, so a later smoke can locate a specific submitted case."""
    r = await ac.get(
        "/queues/default/worklist", headers={"Authorization": "Bearer tenant-wl"}
    )
    assert r.status_code == 200
    items = r.json()["items"]
    by_case = {item["case_id"]: item for item in items}
    for c in seeded["cases"]:
        item = by_case[str(c.case_id)]
        assert item["correlation_id"] == c.correlation_id
        assert "status" in item


@pytest.mark.asyncio
async def test_pagination(ac, seeded):
    r = await ac.get(
        "/queues/default/worklist?page=1&page_size=1",
        headers={"Authorization": "Bearer tenant-wl"},
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data["items"]) == 1
    assert data["total"] >= 2


@pytest.mark.asyncio
async def test_named_queue_filters_by_assignee_queue(ac, db_dsn, seeded):
    conn = await __import__("asyncpg").connect(db_dsn)
    case_id = seeded["cases"][0].case_id
    await conn.execute(
        "UPDATE workflow_instances SET assignee_queue = 'md_review' WHERE case_id = $1",
        case_id,
    )
    await conn.close()

    r = await ac.get("/queues/md_review/worklist", headers={"Authorization": "Bearer tenant-wl"})
    assert r.status_code == 200
    ids = {item["case_id"] for item in r.json()["items"]}
    assert str(case_id) in ids

    r2 = await ac.get("/queues/standard/worklist", headers={"Authorization": "Bearer tenant-wl"})
    ids2 = {item["case_id"] for item in r2.json()["items"]}
    assert str(case_id) not in ids2
