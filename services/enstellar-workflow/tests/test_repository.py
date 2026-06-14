"""Integration tests for CaseRepository — requires PostgreSQL (Testcontainers)."""
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest

from canonical_model import Status
from enstellar_workflow.cases.repository import CaseRepository
from tests.conftest import make_case


@pytest.mark.asyncio
async def test_insert_and_fetch_by_id(pg_pool: asyncpg.Pool):
    repo = CaseRepository()
    case = make_case()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)

    assert fetched is not None
    assert fetched.case_id == case.case_id
    assert fetched.tenant_id == case.tenant_id
    assert fetched.status == Status.intake
    assert fetched.correlation_id == case.correlation_id


@pytest.mark.asyncio
async def test_fetch_by_id_returns_none_when_missing(pg_pool: asyncpg.Pool):
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        result = await repo.fetch_by_id(conn, uuid.uuid4(), "tenant-t08")
    assert result is None


@pytest.mark.asyncio
async def test_fetch_by_id_tenant_isolation(pg_pool: asyncpg.Pool):
    """A case must not be returned for a different tenant_id."""
    repo = CaseRepository()
    case = make_case(tenant_id="tenant-alpha")

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    async with pg_pool.acquire() as conn:
        result = await repo.fetch_by_id(conn, case.case_id, "tenant-beta")

    assert result is None


@pytest.mark.asyncio
async def test_fetch_by_correlation_id(pg_pool: asyncpg.Pool):
    repo = CaseRepository()
    case = make_case(correlation_id=f"corr-repo-fetch-{uuid.uuid4()}")

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_correlation_id(conn, case.correlation_id, case.tenant_id)

    assert fetched is not None
    assert fetched.case_id == case.case_id


@pytest.mark.asyncio
async def test_fetch_by_correlation_id_returns_none_when_missing(pg_pool: asyncpg.Pool):
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        result = await repo.fetch_by_correlation_id(conn, "does-not-exist", "tenant-t08")
    assert result is None


@pytest.mark.asyncio
async def test_update_status_changes_status_and_case_json(pg_pool: asyncpg.Pool):
    repo = CaseRepository()
    case = make_case()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    updated_at = datetime.now(timezone.utc)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.update_status(conn, case, "completeness_check", updated_at)

    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)

    assert fetched is not None
    assert fetched.status == Status.completeness_check


@pytest.mark.asyncio
async def test_update_status_preserves_other_fields(pg_pool: asyncpg.Pool):
    repo = CaseRepository()
    case = make_case()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    updated_at = datetime.now(timezone.utc)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.update_status(conn, case, "auto_determination", updated_at)

    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)

    assert fetched.tenant_id == case.tenant_id
    assert fetched.lob == case.lob
    assert fetched.case_id == case.case_id
