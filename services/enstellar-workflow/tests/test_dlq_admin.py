"""Integration tests for the DLQ admin endpoints (P2.8).

Covers:
  1. GET /admin/dlq/outbox — returns DLQ'd outbox events
  2. GET /admin/dlq/outbox — 403 when saas_admin dep denies access
  3. GET /admin/dlq/consumers — returns consumer DLQ entries
  4. POST /admin/dlq/outbox/{id}/reprocess — resets all DLQ columns
  5. POST /admin/dlq/outbox/{id}/reprocess with unknown UUID — 404

Seeding uses pg_pool directly (the testcontainers user is a superuser which
bypasses FORCE ROW LEVEL SECURITY — no role switch needed for inserts).
"""
from __future__ import annotations

import json
import uuid

import asyncpg
import pytest
import pytest_asyncio
from fastapi import Request as FRequest
from httpx import ASGITransport, AsyncClient
from simintero_authz import ForbiddenError

from enstellar_workflow.auth import require_saas_admin
from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app


# ---------------------------------------------------------------------------
# Shared client fixture — wires the app to the Testcontainers Postgres.
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


# ---------------------------------------------------------------------------
# Helpers for seeding test data
# (The testcontainers user is a superuser → bypasses FORCE RLS directly.)
# ---------------------------------------------------------------------------

async def _seed_outbox_dlq_row(
    pool: asyncpg.Pool,
    event_id: str,
    tenant_id: str,
    topic: str = "test.event",
) -> None:
    """Insert a dead-lettered row into shared.outbox."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO shared.outbox
                (event_id, topic, key, envelope, tenant_id,
                 dlq_at, dlq_reason, retry_count)
            VALUES ($1, $2, NULL, $3::jsonb, $4, now(), 'test-relay-error', 5)
            """,
            event_id,
            topic,
            json.dumps({}),
            tenant_id,
        )


async def _seed_consumer_dlq_row(
    pool: asyncpg.Pool,
    event_id: str,
    consumer_group: str = "test-consumer",
    topic: str = "test.event",
) -> None:
    """Insert a row into shared.consumer_dlq (no RLS — direct insert)."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO shared.consumer_dlq
                (event_id, consumer_group, topic, payload, error, failed_at)
            VALUES ($1, $2, $3, $4::jsonb, 'test error', now())
            """,
            event_id,
            consumer_group,
            topic,
            json.dumps({}),
        )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_outbox_dlq_returns_events(
    ac: AsyncClient,
    pg_pool: asyncpg.Pool,
) -> None:
    """GET /admin/dlq/outbox returns DLQ'd outbox rows including the seeded one."""
    tenant_id = f"dlq-test-{uuid.uuid4().hex[:8]}"
    event_id = str(uuid.uuid4())

    await _seed_outbox_dlq_row(pg_pool, event_id, tenant_id)

    resp = await ac.get(
        "/admin/dlq/outbox",
        headers={"Authorization": f"Bearer {tenant_id}"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    event_ids = {e["event_id"] for e in data["events"]}
    assert event_id in event_ids, f"Expected {event_id} in {event_ids}"


@pytest.mark.asyncio
async def test_list_outbox_dlq_requires_admin(ac: AsyncClient) -> None:
    """Without a valid saas_admin JWT the endpoint returns 403."""

    async def _deny(request: FRequest):
        raise ForbiddenError("saas_admin role required")

    # Save the current override installed by _install_fake_auth (session fixture)
    prev = app.dependency_overrides.get(require_saas_admin)
    app.dependency_overrides[require_saas_admin] = _deny
    try:
        resp = await ac.get(
            "/admin/dlq/outbox",
            headers={"Authorization": "Bearer no-role-tenant"},
        )
        assert resp.status_code == 403, resp.text
    finally:
        # Restore the session-scope fake so subsequent tests are unaffected
        if prev is not None:
            app.dependency_overrides[require_saas_admin] = prev
        else:
            app.dependency_overrides.pop(require_saas_admin, None)


@pytest.mark.asyncio
async def test_list_consumer_dlq_returns_events(
    ac: AsyncClient,
    pg_pool: asyncpg.Pool,
) -> None:
    """GET /admin/dlq/consumers returns consumer DLQ rows including the seeded one."""
    event_id = str(uuid.uuid4())
    consumer_group = f"grp-{uuid.uuid4().hex[:6]}"

    await _seed_consumer_dlq_row(pg_pool, event_id, consumer_group=consumer_group)

    resp = await ac.get(
        "/admin/dlq/consumers",
        headers={"Authorization": "Bearer dlq-admin-tenant"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    event_ids = {e["event_id"] for e in data["events"]}
    assert event_id in event_ids, f"Expected {event_id} in {event_ids}"


@pytest.mark.asyncio
async def test_reprocess_resets_dlq_columns(
    ac: AsyncClient,
    pg_pool: asyncpg.Pool,
) -> None:
    """POST /admin/dlq/outbox/{id}/reprocess resets dlq_at, dlq_reason, retry_count, published_at."""
    tenant_id = f"reprocess-test-{uuid.uuid4().hex[:8]}"
    event_id = str(uuid.uuid4())

    await _seed_outbox_dlq_row(pg_pool, event_id, tenant_id)

    resp = await ac.post(
        f"/admin/dlq/outbox/{event_id}/reprocess",
        headers={"Authorization": f"Bearer {tenant_id}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["requeued"] is True
    assert body["event_id"] == event_id

    # Verify the columns were reset in the DB (superuser bypasses RLS)
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT dlq_at, dlq_reason, published_at, retry_count "
            "FROM shared.outbox WHERE event_id = $1",
            event_id,
        )
    assert row is not None, "Row must still exist after reprocess"
    assert row["dlq_at"] is None, "dlq_at must be NULL after reprocess"
    assert row["dlq_reason"] is None, "dlq_reason must be NULL after reprocess"
    assert row["published_at"] is None, "published_at must be NULL after reprocess"
    assert row["retry_count"] == 0, "retry_count must be 0 after reprocess"


@pytest.mark.asyncio
async def test_reprocess_nonexistent_returns_404(ac: AsyncClient) -> None:
    """POST /admin/dlq/outbox/{unknown_id}/reprocess returns 404."""
    unknown_id = str(uuid.uuid4())

    resp = await ac.post(
        f"/admin/dlq/outbox/{unknown_id}/reprocess",
        headers={"Authorization": "Bearer dlq-admin-tenant"},
    )
    assert resp.status_code == 404, resp.text
