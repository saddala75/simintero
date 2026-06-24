"""Integration tests for GET /queues/{queue_id}/worklist."""
import json
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
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


# ---------------------------------------------------------------------------
# SLA flags: at_risk / breached
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def seeded_sla(db_dsn: str) -> dict:
    """Seed three cases for tenant-sla with different clock states.

    Returns a dict with keys 'at_risk', 'breached', 'normal' mapping to the
    seeded Case objects so each test can look up its case_id.
    """
    now = datetime.now(timezone.utc)
    future_deadline = now + timedelta(days=3)
    past_deadline = now - timedelta(hours=1)

    conn = await asyncpg.connect(db_dsn)

    async def _insert_wi(case):
        await conn.execute(
            """
            INSERT INTO workflow_instances
              (case_id, tenant_id, correlation_id, lob, program, status, urgency,
               workflow_def_version, case_json, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
            """,
            case.case_id, case.tenant_id, case.correlation_id, case.lob,
            case.program, case.status.value, case.urgency.value, "v1",
            json.dumps(case.model_dump(mode="json")),
            case.created_at, case.updated_at,
        )

    # Case 1: running clock with warned_at set → at_risk=True, breached=False
    case_atrisk = make_case(tenant_id="tenant-sla")
    await _insert_wi(case_atrisk)
    await conn.execute(
        """
        INSERT INTO clocks (tenant_id, case_id, clock_type, urgency,
                           duration_calendar_days, deadline, state, warned_at)
        VALUES ($1, $2, 'decision', 'standard', 7, $3, 'running', $4)
        """,
        "tenant-sla", case_atrisk.case_id, future_deadline, now - timedelta(hours=1),
    )

    # Case 2: breached clock → breached=True, at_risk=False
    case_breached = make_case(tenant_id="tenant-sla")
    await _insert_wi(case_breached)
    await conn.execute(
        """
        INSERT INTO clocks (tenant_id, case_id, clock_type, urgency,
                           duration_calendar_days, deadline, state, breached_at)
        VALUES ($1, $2, 'decision', 'standard', 7, $3, 'breached', $4)
        """,
        "tenant-sla", case_breached.case_id, past_deadline, now - timedelta(minutes=30),
    )

    # Case 3: running clock with no warned_at → at_risk=False, breached=False
    case_normal = make_case(tenant_id="tenant-sla")
    await _insert_wi(case_normal)
    await conn.execute(
        """
        INSERT INTO clocks (tenant_id, case_id, clock_type, urgency,
                           duration_calendar_days, deadline, state)
        VALUES ($1, $2, 'decision', 'standard', 7, $3, 'running')
        """,
        "tenant-sla", case_normal.case_id, future_deadline,
    )

    await conn.close()
    return {"at_risk": case_atrisk, "breached": case_breached, "normal": case_normal}


@pytest.mark.asyncio
async def test_at_risk_flag_true_when_clock_warned(ac, seeded_sla):
    """Running clock with warned_at set → worklist item has at_risk=True, breached=False."""
    r = await ac.get(
        "/queues/default/worklist", headers={"Authorization": "Bearer tenant-sla"}
    )
    assert r.status_code == 200
    items = {item["case_id"]: item for item in r.json()["items"]}
    case_id = str(seeded_sla["at_risk"].case_id)
    assert case_id in items, f"at_risk case {case_id} not returned in worklist"
    item = items[case_id]
    assert item["at_risk"] is True, "Expected at_risk=True for warned running clock"
    assert item["breached"] is False, "Expected breached=False for warned running clock"


@pytest.mark.asyncio
async def test_breached_flag_true_when_clock_breached(ac, seeded_sla):
    """Breached clock → worklist item has breached=True, at_risk=False."""
    r = await ac.get(
        "/queues/default/worklist", headers={"Authorization": "Bearer tenant-sla"}
    )
    assert r.status_code == 200
    items = {item["case_id"]: item for item in r.json()["items"]}
    case_id = str(seeded_sla["breached"].case_id)
    assert case_id in items, f"breached case {case_id} not returned in worklist"
    item = items[case_id]
    assert item["breached"] is True, "Expected breached=True for breached clock"
    assert item["at_risk"] is False, "Expected at_risk=False for breached clock"


@pytest.mark.asyncio
async def test_neither_flag_for_normal_running_clock(ac, seeded_sla):
    """Running clock with no warned_at → worklist item has at_risk=False, breached=False."""
    r = await ac.get(
        "/queues/default/worklist", headers={"Authorization": "Bearer tenant-sla"}
    )
    assert r.status_code == 200
    items = {item["case_id"]: item for item in r.json()["items"]}
    case_id = str(seeded_sla["normal"].case_id)
    assert case_id in items, f"normal case {case_id} not returned in worklist"
    item = items[case_id]
    assert item["at_risk"] is False, "Expected at_risk=False for normal running clock"
    assert item["breached"] is False, "Expected breached=False for normal running clock"
