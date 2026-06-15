"""Integration tests for POST /cases/{id}/escalate and POST /cases/{id}/human-signoff.

Uses httpx AsyncClient + ASGITransport backed by a real Testcontainers PostgreSQL.
Follows the same pattern as test_cases_api.py: the `ac` fixture monkeypatches
WORKFLOW_DB_URL so the app's get_pool() connects to the test container DB.
"""
import uuid

import asyncpg
import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from canonical_model import Status
from tests.conftest import make_case
from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app

pytestmark = pytest.mark.asyncio


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


@pytest_asyncio.fixture
async def _clinical_review_case(pg_pool: asyncpg.Pool):
    """Insert a clinical_review case and return it."""
    case = make_case(tenant_id="tenant-api-esc-01", status=Status.clinical_review)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)
    return case


async def test_post_escalate_returns_200_and_md_review(
    _clinical_review_case, ac: AsyncClient
):
    """POST /cases/{id}/escalate returns 200 {'case_id': ..., 'queue': 'md_review'}."""
    case = _clinical_review_case
    r = await ac.post(
        f"/cases/{case.case_id}/escalate",
        json={
            "tenant_id": case.tenant_id,
            "actor_id": "user-001",
            "actor_type": "user",
            "reason": "Needs specialist review",
        },
    )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["queue"] == "md_review"
    assert body["case_id"] == str(case.case_id)


async def test_post_escalate_returns_409_if_not_clinical_review(
    pg_pool: asyncpg.Pool, ac: AsyncClient
):
    """POST /cases/{id}/escalate returns 409 when current state != clinical_review."""
    case = make_case(tenant_id="tenant-api-esc-02", status=Status.intake)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    r = await ac.post(
        f"/cases/{case.case_id}/escalate",
        json={
            "tenant_id": case.tenant_id,
            "actor_id": "user-001",
            "actor_type": "user",
        },
    )

    assert r.status_code == 409, r.text
    assert "clinical_review" in r.json()["detail"]


async def test_post_escalate_returns_409_for_missing_case(ac: AsyncClient):
    """POST /cases/{id}/escalate returns 409 when case does not exist."""
    missing_id = str(uuid.uuid4())
    r = await ac.post(
        f"/cases/{missing_id}/escalate",
        json={
            "tenant_id": "tenant-api-esc-03",
            "actor_id": "user-001",
            "actor_type": "user",
        },
    )
    assert r.status_code == 409


async def test_post_human_signoff_returns_201_and_links_case(
    pg_pool: asyncpg.Pool, ac: AsyncClient
):
    """POST /cases/{id}/human-signoff returns 201 with signoff row and links workflow_instances."""
    case = make_case(tenant_id="tenant-api-signoff-01", status=Status.clinical_review)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    r = await ac.post(
        f"/cases/{case.case_id}/human-signoff",
        json={
            "tenant_id": case.tenant_id,
            "actor_id": "dr-jones",
            "actor_type": "clinician",
            "outcome_context": "denied",
        },
    )

    assert r.status_code == 201, r.text
    body = r.json()
    assert body["actor_id"] == "dr-jones"
    assert body["outcome_context"] == "denied"
    uuid.UUID(body["signoff_id"])  # raises if not a valid UUID string

    # Verify DB link
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT human_signoff_id FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id, case.tenant_id,
        )
    assert row["human_signoff_id"] is not None


async def test_adverse_transition_blocked_without_signoff(
    pg_pool: asyncpg.Pool, ac: AsyncClient
):
    """INVARIANT: POST /cases/{id}/transitions to 'denied' returns 409 without prior sign-off."""
    case = make_case(tenant_id="tenant-api-guard-01", status=Status.clinical_review)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    r = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "denied",
            "actor_id": "user-001",
            "actor_type": "user",
            "correlation_id": str(uuid.uuid4()),
            "payload": {},
            "human_signoff_recorded": False,
        },
    )

    assert r.status_code == 409, r.text
    assert "sign-off" in r.json()["detail"]
