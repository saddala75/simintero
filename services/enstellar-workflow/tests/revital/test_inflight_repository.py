"""Tests for InflightRepository.

The codebase's repo tests use a live Testcontainers PostgreSQL fixture (pg_pool),
so the primary tests here are real DB integration tests in that style. A set of
pure-logic FakeConn tests is also included so the SQL/method shape stays covered
regardless of DB availability.
"""
import uuid

import asyncpg
import pytest

from simintero_tenant_context import tenant_transaction

from enstellar_workflow.revital import InflightRepository


# ---------------------------------------------------------------------------
# Pure-logic tests (no DB) — guarantee coverage of SQL/method shape.
# ---------------------------------------------------------------------------
class FakeConn:
    def __init__(self, fetchrow_result=None, fetch_result=None):
        self.calls = []
        self._fetchrow = fetchrow_result
        self._fetch = fetch_result or []

    async def execute(self, sql, *args):
        self.calls.append(("execute", sql, args))

    async def fetchrow(self, sql, *args):
        self.calls.append(("fetchrow", sql, args))
        return self._fetchrow

    async def fetch(self, sql, *args):
        self.calls.append(("fetch", sql, args))
        return self._fetch


@pytest.mark.asyncio
async def test_insert_issues_upsert_with_args_in_order():
    repo = InflightRepository()
    conn = FakeConn()
    case_id = uuid.uuid4()

    await repo.insert(
        conn,
        analysis_id="an-1",
        case_id=case_id,
        tenant_id="tenant-a",
        correlation_id="corr-1",
    )

    assert len(conn.calls) == 1
    kind, sql, args = conn.calls[0]
    assert kind == "execute"
    assert "INSERT INTO revital_inflight" in sql
    assert "ON CONFLICT (analysis_id) DO NOTHING" in sql
    assert args == ("an-1", case_id, "tenant-a", "corr-1")


@pytest.mark.asyncio
async def test_exists_processing_for_case_true_when_row_returned():
    repo = InflightRepository()
    conn = FakeConn(fetchrow_result={"?column?": 1})
    assert await repo.exists_processing_for_case(conn, uuid.uuid4(), "tenant-a") is True
    kind, sql, _ = conn.calls[0]
    assert kind == "fetchrow"
    assert "status = 'processing'" in sql


@pytest.mark.asyncio
async def test_exists_processing_for_case_false_when_none():
    repo = InflightRepository()
    conn = FakeConn(fetchrow_result=None)
    assert await repo.exists_processing_for_case(conn, uuid.uuid4(), "tenant-a") is False


@pytest.mark.asyncio
async def test_list_processing_sql_shape():
    repo = InflightRepository()
    conn = FakeConn(fetch_result=[])
    await repo.list_processing(conn, limit=7)
    kind, sql, args = conn.calls[0]
    assert kind == "fetch"
    assert "FOR UPDATE SKIP LOCKED" in sql
    assert "status = 'processing'" in sql
    assert args == (7,)


class FakeClaimConn:
    """execute() returns a command tag so claim's "UPDATE 1" check is exercised."""

    def __init__(self, command_tags):
        self.calls = []
        self._tags = list(command_tags)

    async def execute(self, sql, *args):
        self.calls.append(("execute", sql, args))
        return self._tags.pop(0)


@pytest.mark.asyncio
async def test_claim_returns_true_when_row_was_processing():
    repo = InflightRepository()
    conn = FakeClaimConn(["UPDATE 1"])
    won = await repo.claim(conn, "an-claim")
    assert won is True
    kind, sql, args = conn.calls[0]
    assert kind == "execute"
    assert "UPDATE revital_inflight" in sql
    assert "status = 'done'" in sql
    assert "status = 'processing'" in sql  # gated on still-processing
    # provenance binds default to None when the caller passes nothing.
    assert args == ("an-claim", None, None, None, None)


@pytest.mark.asyncio
async def test_claim_returns_false_when_already_finalized():
    repo = InflightRepository()
    conn = FakeClaimConn(["UPDATE 0"])
    assert await repo.claim(conn, "an-claim") is False


@pytest.mark.asyncio
async def test_mark_done_issues_update():
    repo = InflightRepository()
    conn = FakeConn()
    await repo.mark_done(conn, "an-9")
    kind, sql, args = conn.calls[0]
    assert kind == "execute"
    assert "UPDATE revital_inflight" in sql
    assert "status = 'done'" in sql
    assert args == ("an-9",)


# ---------------------------------------------------------------------------
# Integration tests — live Testcontainers PostgreSQL (matches test_repository.py).
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_insert_then_exists_processing_for_case(pg_pool: asyncpg.Pool):
    repo = InflightRepository()
    tenant_id = "tenant-inflight-a"
    case_id = uuid.uuid4()
    analysis_id = f"an-{uuid.uuid4()}"

    async with tenant_transaction(pg_pool, tenant_id) as conn:
        await repo.insert(
            conn,
            analysis_id=analysis_id,
            case_id=case_id,
            tenant_id=tenant_id,
            correlation_id="corr-inflight-1",
        )

    async with tenant_transaction(pg_pool, tenant_id) as conn:
        assert await repo.exists_processing_for_case(conn, case_id, tenant_id) is True
        # Different case → False.
        assert await repo.exists_processing_for_case(conn, uuid.uuid4(), tenant_id) is False


@pytest.mark.asyncio
async def test_insert_is_idempotent_on_analysis_id(pg_pool: asyncpg.Pool):
    repo = InflightRepository()
    tenant_id = "tenant-inflight-dedup"
    case_id = uuid.uuid4()
    analysis_id = f"an-{uuid.uuid4()}"

    async with tenant_transaction(pg_pool, tenant_id) as conn:
        await repo.insert(
            conn, analysis_id=analysis_id, case_id=case_id,
            tenant_id=tenant_id, correlation_id="corr-1",
        )
        # Second insert with same analysis_id must be a no-op (ON CONFLICT DO NOTHING).
        await repo.insert(
            conn, analysis_id=analysis_id, case_id=case_id,
            tenant_id=tenant_id, correlation_id="corr-2",
        )
        count = await conn.fetchval(
            "SELECT count(*) FROM revital_inflight WHERE analysis_id = $1", analysis_id
        )
    assert count == 1


@pytest.mark.asyncio
async def test_mark_done_flips_status_and_sets_completed_at(pg_pool: asyncpg.Pool):
    repo = InflightRepository()
    tenant_id = "tenant-inflight-done"
    case_id = uuid.uuid4()
    analysis_id = f"an-{uuid.uuid4()}"

    async with tenant_transaction(pg_pool, tenant_id) as conn:
        await repo.insert(
            conn, analysis_id=analysis_id, case_id=case_id,
            tenant_id=tenant_id, correlation_id="corr-done",
        )

    async with tenant_transaction(pg_pool, tenant_id) as conn:
        await repo.mark_done(conn, analysis_id)

    async with tenant_transaction(pg_pool, tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT status, completed_at FROM revital_inflight WHERE analysis_id = $1",
            analysis_id,
        )
    assert row["status"] == "done"
    assert row["completed_at"] is not None
    # No longer counts as processing.
    async with tenant_transaction(pg_pool, tenant_id) as conn:
        assert await repo.exists_processing_for_case(conn, case_id, tenant_id) is False


@pytest.mark.asyncio
async def test_claim_wins_once_then_loses(pg_pool: asyncpg.Pool):
    repo = InflightRepository()
    tenant_id = "tenant-inflight-claim"
    case_id = uuid.uuid4()
    analysis_id = f"an-{uuid.uuid4()}"

    async with tenant_transaction(pg_pool, tenant_id) as conn:
        await repo.insert(
            conn, analysis_id=analysis_id, case_id=case_id,
            tenant_id=tenant_id, correlation_id="corr-claim",
        )

    # First claim wins (row was processing) and flips status→done.
    async with tenant_transaction(pg_pool, tenant_id) as conn:
        assert await repo.claim(conn, analysis_id) is True

    async with tenant_transaction(pg_pool, tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT status, completed_at FROM revital_inflight WHERE analysis_id = $1",
            analysis_id,
        )
    assert row["status"] == "done"
    assert row["completed_at"] is not None

    # Second claim loses (already finalized).
    async with tenant_transaction(pg_pool, tenant_id) as conn:
        assert await repo.claim(conn, analysis_id) is False


@pytest.mark.asyncio
async def test_list_processing_returns_processing_rows(pg_pool: asyncpg.Pool):
    """Cross-tenant scan. The Testcontainers test connection is a superuser and
    bypasses RLS, so a plain pg_pool connection sees every tenant's rows — the
    same way OutboxRelay's BYPASSRLS sim_relay role does in production."""
    repo = InflightRepository()
    tenant_id = "tenant-inflight-list"
    case_id = uuid.uuid4()
    analysis_id = f"an-{uuid.uuid4()}"

    async with tenant_transaction(pg_pool, tenant_id) as conn:
        await repo.insert(
            conn, analysis_id=analysis_id, case_id=case_id,
            tenant_id=tenant_id, correlation_id="corr-list",
        )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            rows = await repo.list_processing(conn, limit=100)

    found = [r for r in rows if r["analysis_id"] == analysis_id]
    assert len(found) == 1
    assert found[0]["case_id"] == case_id
    assert found[0]["tenant_id"] == tenant_id
    assert found[0]["correlation_id"] == "corr-list"
    assert found[0]["submitted_at"] is not None
