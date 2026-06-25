"""Grievance HTTP routes — full lifecycle e2e (P5).

Drives the entire grievance lifecycle over HTTP against the FastAPI app
(file → acknowledge → assign → resolve) and proves:
  * file is open (AuthedRequest) and lands status='filed';
  * ack/assign are gated on the grievance_coordinator role, stamping the
    coordinator's JWT sub (NOT a body value);
  * resolve is gated on the assigned investigator (403 otherwise) and stamps
    resolved_by from the reviewer's JWT sub (ResolveGrievanceBody has no
    resolved_by);
  * the /assigned worklist is filtered by assigned_to == sub;
  * everything is tenant-isolated.

grievances has FORCE ROW LEVEL SECURITY, so rows are read back inside a
tenant_transaction (which sets sim.tenant_id), mirroring the service tests.
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from simintero_tenant_context import tenant_transaction

from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app


async def _seed_templates(pool: asyncpg.Pool, tenant_id: str) -> None:
    async with pool.acquire() as conn:
        for event_type, subject, body in (
            ("grievance_filed", "Grievance received",
             "We received your grievance. We will respond within "
             "{{ resolution_days }} days."),
            ("grievance_acknowledged", "Grievance acknowledged",
             "Your grievance has been acknowledged."),
            ("grievance_resolved", "Grievance resolved",
             "Your grievance has been resolved."),
        ):
            await conn.execute(
                "INSERT INTO notification_templates "
                "(tenant_id, event_type, channel, lob, subject_template, body_template) "
                "VALUES ($1, $2, 'portal', NULL, $3, $4)",
                tenant_id, event_type, subject, body,
            )


async def _grievance_row(pool: asyncpg.Pool, tenant_id: str, grievance_id: str) -> dict:
    async with tenant_transaction(pool, tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM grievances WHERE grievance_id=$1 AND tenant_id=$2",
            uuid.UUID(grievance_id), tenant_id,
        )
    return dict(row) if row is not None else None


@pytest_asyncio.fixture
async def ac(db_dsn: str, monkeypatch) -> AsyncClient:
    """AsyncClient targeting the FastAPI app, wired to the Testcontainers Postgres."""
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


@pytest.mark.asyncio
async def test_full_http_lifecycle(ac: AsyncClient, pg_pool: asyncpg.Pool):
    tenant_id = f"griev-http-{uuid.uuid4()}"
    member_ref = f"member-{uuid.uuid4()}"
    await _seed_templates(pg_pool, tenant_id)
    auth = {"Authorization": f"Bearer {tenant_id}"}

    # --- file (open: AuthedRequest) → 201, status='filed' ---
    resp = await ac.post(
        "/grievances",
        headers=auth,
        json={"member_ref": member_ref, "filed_by": "member-portal",
              "lob": "ma", "urgency": "standard"},
    )
    assert resp.status_code == 201, resp.text
    gid = resp.json()["grievance_id"]
    assert (await _grievance_row(pg_pool, tenant_id, gid))["status"] == "filed"

    # --- acknowledge (grievance_coordinator) → 200, stamps coord sub ---
    resp = await ac.post(
        f"/grievances/{gid}/acknowledgement",
        headers={**auth, "X-Test-Sub": "coord-1"},
    )
    assert resp.status_code == 200, resp.text
    row = await _grievance_row(pg_pool, tenant_id, gid)
    assert row["status"] == "acknowledged"
    assert row["acknowledged_by"] == "coord-1"

    # --- assign (grievance_coordinator) → 200, stamps coord sub + investigator ---
    resp = await ac.post(
        f"/grievances/{gid}/assignment",
        headers={**auth, "X-Test-Sub": "coord-1"},
        json={"investigator_id": "inv-1"},
    )
    assert resp.status_code == 200, resp.text
    row = await _grievance_row(pg_pool, tenant_id, gid)
    assert row["status"] == "investigating"
    assert row["assigned_to"] == "inv-1"
    assert row["assigned_by"] == "coord-1"

    # --- worklist filtered by assigned_to == sub ---
    resp = await ac.get("/grievances/assigned", headers={**auth, "X-Test-Sub": "inv-1"})
    assert resp.status_code == 200, resp.text
    assert gid in {g["grievance_id"] for g in resp.json()}

    resp = await ac.get("/grievances/assigned", headers={**auth, "X-Test-Sub": "inv-2"})
    assert resp.status_code == 200, resp.text
    assert gid not in {g["grievance_id"] for g in resp.json()}

    # --- resolve: a non-assigned investigator → 403 ---
    resp = await ac.post(
        f"/grievances/{gid}/resolution",
        headers={**auth, "X-Test-Sub": "inv-2"},
        json={"resolution": "x"},
    )
    assert resp.status_code == 403, resp.text
    assert (await _grievance_row(pg_pool, tenant_id, gid))["status"] == "investigating"

    # --- resolve: the assigned investigator → 200, resolved_by = JWT sub ---
    resp = await ac.post(
        f"/grievances/{gid}/resolution",
        headers={**auth, "X-Test-Sub": "inv-1"},
        json={"resolution": "addressed"},
    )
    assert resp.status_code == 200, resp.text
    row = await _grievance_row(pg_pool, tenant_id, gid)
    assert row["status"] == "resolved"
    assert row["resolved_by"] == "inv-1"  # the JWT sub, NOT a body value


@pytest.mark.asyncio
async def test_assigned_worklist_is_tenant_isolated(ac: AsyncClient, pg_pool: asyncpg.Pool):
    tenant_a = f"griev-a-{uuid.uuid4()}"
    tenant_b = f"griev-b-{uuid.uuid4()}"
    await _seed_templates(pg_pool, tenant_a)
    await _seed_templates(pg_pool, tenant_b)

    # File + acknowledge + assign a grievance to inv-1 under tenant-B.
    auth_b = {"Authorization": f"Bearer {tenant_b}"}
    resp = await ac.post(
        "/grievances",
        headers=auth_b,
        json={"member_ref": "m-b", "filed_by": "portal", "lob": "ma",
              "urgency": "standard"},
    )
    assert resp.status_code == 201, resp.text
    gid_b = resp.json()["grievance_id"]
    await ac.post(f"/grievances/{gid_b}/acknowledgement",
                  headers={**auth_b, "X-Test-Sub": "coord-b"})
    await ac.post(f"/grievances/{gid_b}/assignment",
                  headers={**auth_b, "X-Test-Sub": "coord-b"},
                  json={"investigator_id": "inv-1"})

    # tenant-A's worklist for inv-1 must NOT see tenant-B's grievance.
    resp = await ac.get(
        "/grievances/assigned",
        headers={"Authorization": f"Bearer {tenant_a}", "X-Test-Sub": "inv-1"},
    )
    assert resp.status_code == 200, resp.text
    assert gid_b not in {g["grievance_id"] for g in resp.json()}
