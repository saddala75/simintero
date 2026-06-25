"""Integration tests for POST /internal/rfi-response (P1 — close the RFI loop).

Verifies the provider RFI-response route:
  1. Resolves the case (workflow pool) and requires pend_rfi.
  2. Writes the supplemental bundle's clinical evidence to fabric.resource as
     SUBMITTED (source='rfi-response') under the case's stable member_ref —
     EVIDENCE FIRST.
  3. Publishes RFIResponseReceived to shared.outbox — EVENT AFTER.

A non-pend_rfi case → 409; a missing case → 404.

The test harness runs a single Postgres (Testcontainers), so the FABRIC pool and
the WORKFLOW pool point at the same database. We stand up the fabric.resource
table (mirroring the platform schema) and wire it onto app.state.fabric_pool.
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from canonical_model import Identifier, Status
from simintero_tenant_context import tenant_transaction

from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.engine.auto_determination import _FHIR_LOGICAL_ID_SYSTEM
from enstellar_workflow.main import app
from tests.conftest import make_case

_RFI_SCHEMA_REF = "sim.case.lifecycle/RFIResponseReceived/v1"

# Mirror the platform fabric.resource table (V002 + V014 ens columns) so the
# route's evidence-before-event write hits a faithful, RLS-forced table.
_FABRIC_DDL = """
CREATE SCHEMA IF NOT EXISTS fabric;
CREATE TABLE IF NOT EXISTS fabric.resource (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT NOT NULL,
  resource_type  TEXT NOT NULL,
  fhir_id        TEXT NOT NULL,
  version        INT NOT NULL DEFAULT 1,
  profile        TEXT,
  content        JSONB NOT NULL,
  provenance_ref TEXT,
  source         TEXT NOT NULL,
  last_updated   TIMESTAMPTZ NOT NULL DEFAULT now(),
  member_ref     TEXT,
  classification TEXT DEFAULT 'standard',
  UNIQUE (tenant_id, resource_type, fhir_id)
);
ALTER TABLE fabric.resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE fabric.resource FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fabric.resource;
CREATE POLICY tenant_isolation ON fabric.resource
  USING (tenant_id = current_setting('sim.tenant_id', true));
"""


@pytest_asyncio.fixture
async def fabric_pool(db_dsn: str) -> asyncpg.Pool:
    """A pool over the same Testcontainers Postgres, with fabric.resource ready."""
    pool = await asyncpg.create_pool(db_dsn, min_size=1, max_size=3)
    async with pool.acquire() as conn:
        await conn.execute(_FABRIC_DDL)
    yield pool
    await pool.close()


@pytest_asyncio.fixture
async def ac(db_dsn: str, fabric_pool: asyncpg.Pool, monkeypatch) -> AsyncClient:
    """AsyncClient targeting the FastAPI app, wired to the Testcontainers Postgres.

    Sets app.state.fabric_pool to the (same-DB) fabric pool so the route's
    evidence write has somewhere to go.
    """
    monkeypatch.setenv(
        "WORKFLOW_DB_URL",
        db_dsn.replace("postgresql://", "postgresql+asyncpg://"),
    )
    import enstellar_workflow.config as cfg_mod
    import enstellar_workflow.db.connection as conn_mod

    cfg_mod._settings = None
    conn_mod._pool = None

    app.state.fabric_pool = fabric_pool

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client

    await close_pool()
    conn_mod._pool = None


def _make_pend_rfi_case(tenant_id: str, member_ref: str, status: Status = Status.pend_rfi):
    """Build a Case in the given status with a stable FHIR-logical-id member_ref."""
    case = make_case(tenant_id=tenant_id, status=status)
    member = case.member.model_copy(
        update={"identifiers": [Identifier(system=_FHIR_LOGICAL_ID_SYSTEM, value=member_ref)]}
    )
    return case.model_copy(update={"member": member})


async def _seed_case(pg_pool: asyncpg.Pool, case) -> None:
    async with tenant_transaction(pg_pool, case.tenant_id) as conn:
        await CaseRepository().insert(conn, case)


def _bundle(member_ref: str, obs_code: str) -> dict:
    return {
        "resourceType": "Bundle",
        "entry": [
            {"resource": {"resourceType": "Patient", "id": member_ref, "gender": "male"}},
            {
                "resource": {
                    "resourceType": "Observation",
                    "id": "obs-rfi-1",
                    "status": "final",
                    "code": {"coding": [{"system": "http://loinc.org", "code": obs_code}]},
                    "subject": {"reference": f"Patient/{member_ref}"},
                }
            },
        ],
    }


@pytest.mark.asyncio
async def test_rfi_response_writes_fabric_and_publishes_event(
    ac: AsyncClient, pg_pool: asyncpg.Pool, fabric_pool: asyncpg.Pool
):
    tenant_id = "tenant-rfi"
    member_ref = "pat-rfi-1"
    obs_code = "12345-6"
    case = _make_pend_rfi_case(tenant_id, member_ref)
    await _seed_case(pg_pool, case)

    resp = await ac.post(
        "/internal/rfi-response",
        json={
            "bundle": _bundle(member_ref, obs_code),
            "tenant_id": tenant_id,
            "case_id": str(case.case_id),
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["case_id"] == str(case.case_id)
    assert body["status"] == "rfi_response_received"
    assert body["fabric_rows"] >= 2  # Patient + Observation

    # Fabric evidence written as SUBMITTED with source='rfi-response'.
    async with tenant_transaction(fabric_pool, tenant_id) as conn:
        obs = await conn.fetchrow(
            "SELECT source, member_ref, content FROM fabric.resource "
            "WHERE tenant_id = $1 AND resource_type = 'Observation' AND fhir_id = 'obs-rfi-1'",
            tenant_id,
        )
    assert obs is not None, "Observation evidence row not written"
    assert obs["source"] == "rfi-response"
    assert obs["member_ref"] == member_ref
    import json as _json
    content = obs["content"] if isinstance(obs["content"], dict) else _json.loads(obs["content"])
    assert content["code"]["coding"][0]["code"] == obs_code

    # RFIResponseReceived published to shared.outbox with the case_id + tenant.
    async with pg_pool.acquire() as conn:
        event = await conn.fetchrow(
            """
            SELECT tenant_id, envelope FROM shared.outbox
             WHERE tenant_id = $1
               AND envelope->>'schema_ref' = $2
               AND envelope->'payload'->>'case_id' = $3
             ORDER BY event_id DESC LIMIT 1
            """,
            tenant_id,
            _RFI_SCHEMA_REF,
            str(case.case_id),
        )
    assert event is not None, "RFIResponseReceived outbox event not found"
    assert event["tenant_id"] == tenant_id


@pytest.mark.asyncio
async def test_rfi_response_non_pend_rfi_is_conflict(
    ac: AsyncClient, pg_pool: asyncpg.Pool
):
    tenant_id = "tenant-rfi-409"
    case = _make_pend_rfi_case(tenant_id, "pat-409", status=Status.clinical_review)
    await _seed_case(pg_pool, case)

    resp = await ac.post(
        "/internal/rfi-response",
        json={
            "bundle": _bundle("pat-409", "99999-9"),
            "tenant_id": tenant_id,
            "case_id": str(case.case_id),
        },
    )
    assert resp.status_code == 409, resp.text
    assert "pend_rfi" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_rfi_response_missing_case_is_not_found(ac: AsyncClient):
    resp = await ac.post(
        "/internal/rfi-response",
        json={
            "bundle": _bundle("pat-404", "00000-0"),
            "tenant_id": "tenant-rfi-404",
            "case_id": str(uuid.uuid4()),
        },
    )
    assert resp.status_code == 404, resp.text
