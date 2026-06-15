"""Testcontainers fixtures for PostgreSQL + Redpanda."""
import os
import time

import asyncpg
import pytest
import pytest_asyncio
from fastapi import Request
from testcontainers.postgres import PostgresContainer
from testcontainers.kafka import RedpandaContainer

from enstellar_authz import require_auth
from enstellar_authz.context import TenantContext, set_tenant_context
from enstellar_authz.exceptions import AuthError
from enstellar_authz.models import TokenClaims


class _FakeJWTValidator:
    """Test-only JWT validator — treats the raw token string as the tenant_id."""

    _audience = "test"

    async def validate(self, token: str) -> TokenClaims:
        now = int(time.time())
        return TokenClaims(
            sub="test-user",
            iss="test-issuer",
            exp=now + 3600,
            iat=now,
            aud="test",
            tenant_id=token,
        )


async def _fake_require_auth(request: Request) -> TenantContext:
    """Test replacement for require_auth — reads 'Bearer <tenant_id>' from Authorization."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise AuthError("Missing Authorization header")
    tenant_id = auth_header[len("Bearer "):]
    if not tenant_id:
        raise AuthError("Empty token")
    ctx = TenantContext(tenant_id=tenant_id, subject="test-user", scopes=frozenset())
    set_tenant_context(ctx)
    return ctx


@pytest.fixture(autouse=True, scope="session")
def _install_fake_auth() -> None:
    """Register _fake_require_auth for all workflow-engine API tests."""
    from enstellar_workflow.main import app
    app.dependency_overrides[require_auth] = _fake_require_auth
    yield
    app.dependency_overrides.pop(require_auth, None)


@pytest.fixture(scope="session")
def pg_container():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg


@pytest.fixture(scope="session")
def kafka_container():
    with RedpandaContainer("docker.redpanda.com/redpandadata/redpanda:v24.1.7") as kafka:
        yield kafka


@pytest.fixture(scope="session")
def db_dsn(pg_container) -> str:
    """Return connection DSN and run Alembic migrations exactly once per session."""
    dsn = pg_container.get_connection_url().replace("postgresql+psycopg2://", "postgresql://")
    import subprocess, sys, pathlib
    env = {**os.environ, "WORKFLOW_DB_URL": dsn}
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(pathlib.Path(__file__).parent.parent),
        env=env,
        check=True,
    )
    return dsn


@pytest_asyncio.fixture
async def pg_pool(db_dsn: str) -> asyncpg.Pool:
    """Function-scoped asyncpg pool — avoids cross-loop issues with session fixtures."""
    pool = await asyncpg.create_pool(db_dsn, min_size=1, max_size=5)
    yield pool
    await pool.close()


@pytest.fixture
def kafka_bootstrap(kafka_container) -> str:
    return kafka_container.get_bootstrap_server()


# ---------------------------------------------------------------------------
# Shared case factory — used by test_repository, test_recorder, test_transitions,
# test_case_service, and test_cases_api.  Import as: from tests.conftest import make_case
# ---------------------------------------------------------------------------
import uuid as _uuid
from datetime import date as _date, datetime as _datetime, timezone as _tz

from canonical_model import (
    Case,
    Coverage,
    Member,
    Provider,
    ServiceLine,
    Status,
    Urgency,
)


def make_case(
    tenant_id: str = "tenant-t08",
    correlation_id: str | None = None,
    status: Status = Status.intake,
) -> Case:
    """Build a minimal valid Case for testing.

    correlation_id defaults to a new random UUID on each call so tests are
    isolated by default. Pass an explicit value to test idempotency.
    """
    now = _datetime.now(_tz.utc)
    member_id = _uuid.uuid4()
    return Case(
        case_id=_uuid.uuid4(),
        tenant_id=tenant_id,
        correlation_id=correlation_id or f"corr-{_uuid.uuid4()}",
        lob="commercial",
        status=status,
        urgency=Urgency.standard,
        member=Member(
            member_id=member_id,
            tenant_id=tenant_id,
            first_name="Alice",
            last_name="Smith",
            date_of_birth=_date(1985, 3, 15),
        ),
        coverage=Coverage(
            coverage_id=_uuid.uuid4(),
            tenant_id=tenant_id,
            member_id=member_id,
            plan_id="PLAN-001",
            subscriber_id="SUB-001",
            payer_name="Acme Health",
            lob="commercial",
            effective_date=_date(2024, 1, 1),
        ),
        requesting_provider=Provider(
            provider_id=_uuid.uuid4(),
            tenant_id=tenant_id,
            npi="1234567890",
            name="Dr. Bob Jones",
        ),
        service_lines=[
            ServiceLine(
                service_line_id=_uuid.uuid4(),
                tenant_id=tenant_id,
                sequence=1,
                service_type_code="3",
                procedure_code="99213",
                diagnosis_codes=["Z00.00"],
            )
        ],
        created_at=now,
        updated_at=now,
    )
