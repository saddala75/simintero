"""Integration tests for POST /cases/{case_id}/pend-rfi.

Verifies atomically:
1. Case status transitions to 'pend_rfi'.
2. clocks.paused_at is set (same transaction).
3. An rfi.dispatched event appears in the outbox.

Review class: sensitive (clocks) — senior engineer review required before merge.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
import asyncpg

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


@pytest.mark.asyncio
async def test_pend_rfi_transitions_and_pauses_clock(
    ac: AsyncClient, pg_pool: asyncpg.Pool
):
    """POST /cases/{id}/pend-rfi must:
    1. Transition workflow_instances.status to 'pend_rfi'.
    2. Set clocks.paused_at (clock pause in same transaction).
    3. Write an rfi.dispatched outbox event.
    """
    case = make_case()
    create = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert create.status_code == 201

    resp = await ac.post(
        f"/cases/{case.case_id}/pend-rfi",
        json={
            "provider_npi": "1234567890",
            "document_types": ["lab"],
            "free_text": "Please send recent CBC.",
        },
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )
    assert resp.status_code == 200, resp.text

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status FROM workflow_instances WHERE case_id = $1 AND tenant_id = $2",
            case.case_id,
            case.tenant_id,
        )
        assert row is not None, "workflow_instances row not found"
        assert row["status"] == "pend_rfi", f"expected pend_rfi, got {row['status']!r}"

        clock = await conn.fetchrow(
            "SELECT paused_at FROM clocks WHERE case_id = $1 AND tenant_id = $2",
            case.case_id,
            case.tenant_id,
        )
        assert clock is not None, "clocks row not found"
        assert clock["paused_at"] is not None, "paused_at must be set after pend-rfi"

        event = await conn.fetchrow(
            """
            SELECT payload FROM outbox
             WHERE tenant_id = $1 AND case_id = $2
               AND schema_ref = 'sim.case.lifecycle/RFIDispatched/v1'
             ORDER BY created_at DESC LIMIT 1
            """,
            case.tenant_id,
            case.case_id,
        )
        assert event is not None, "RFIDispatched outbox event not found"


@pytest.mark.asyncio
async def test_pend_rfi_clock_pause_is_atomic(
    ac: AsyncClient, pg_pool: asyncpg.Pool
):
    """Second pend-rfi call must not create a second paused clock row.

    The UNIQUE constraint on (case_id, clock_type) ensures only one clock row
    exists. Calling pause() when the clock is already paused is idempotent —
    paused_at is preserved and not reset. Assert exactly one paused clock row.
    """
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )

    # First pend-rfi — transitions to pend_rfi and pauses clock.
    r1 = await ac.post(
        f"/cases/{case.case_id}/pend-rfi",
        json={"provider_npi": "1234567890", "document_types": [], "free_text": None},
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )
    assert r1.status_code == 200

    # Second pend-rfi — clock already paused; must remain exactly one paused row.
    await ac.post(
        f"/cases/{case.case_id}/pend-rfi",
        json={"provider_npi": "1234567890", "document_types": [], "free_text": None},
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )

    async with pg_pool.acquire() as conn:
        clocks = await conn.fetch(
            """
            SELECT clock_id FROM clocks
             WHERE case_id = $1 AND tenant_id = $2 AND paused_at IS NOT NULL
            """,
            case.case_id,
            case.tenant_id,
        )
    assert len(clocks) == 1, (
        f"Expected exactly 1 paused clock row, got {len(clocks)}"
    )
