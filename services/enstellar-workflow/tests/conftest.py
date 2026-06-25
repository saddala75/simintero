"""Testcontainers fixtures for PostgreSQL + Redpanda."""
import os

import asyncpg
import httpx
import pytest
import pytest_asyncio
import respx
from fastapi import Request
from testcontainers.postgres import PostgresContainer
from testcontainers.kafka import RedpandaContainer

from simintero_authz import AuthError
from simintero_tenant_context import TenantContext, set_context

from enstellar_workflow.auth import (
    ReviewerContext,
    require_appeals_assigner,
    require_auth,
    require_reviewer,
)


async def _fake_require_auth(request: Request):
    """Test replacement for the simintero-authz require_auth dependency.

    Reads 'Bearer <tenant_id>' from the Authorization header, builds a platform
    TenantContext, sets it as the current context (so get_context() works inside
    handlers / the OPA gate) and returns the (ctx, token) tuple the real
    dependency yields.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise AuthError("Missing Authorization header")
    token = auth_header[len("Bearer "):]
    if not token:
        raise AuthError("Empty token")
    ctx = TenantContext(
        tenant_id=token,
        roles=["reviewer"],
        principal_type="human",
    )
    set_context(ctx)
    return ctx, token


async def _fake_require_reviewer(request: Request):
    """Test replacement for require_reviewer — authenticates as a reviewer.

    Reads 'Bearer <tenant_id>' for the tenant and 'X-Test-Sub' for the
    authenticated user id (defaults to 'test-reviewer'), builds a ReviewerContext
    with the reviewer role, sets it as the current context and returns it.
    """
    token = request.headers.get("Authorization", "")[len("Bearer "):]
    sub = request.headers.get("X-Test-Sub", "test-reviewer")
    ctx = ReviewerContext(
        tenant_id=token,
        sub=sub,
        roles=["reviewer"],
        principal_type="human",
    )
    set_context(ctx)
    return ctx


async def _fake_require_assigner(request: Request):
    """Test replacement for require_appeals_assigner — authenticates as an assigner."""
    token = request.headers.get("Authorization", "")[len("Bearer "):]
    sub = request.headers.get("X-Test-Sub", "test-assigner")
    ctx = ReviewerContext(
        tenant_id=token,
        sub=sub,
        roles=["appeals_coordinator"],
        principal_type="human",
    )
    set_context(ctx)
    return ctx


@pytest.fixture(autouse=True, scope="session")
def _install_fake_auth() -> None:
    """Register the fake auth deps for all workflow-engine API tests."""
    from enstellar_workflow.main import app
    app.dependency_overrides[require_auth] = _fake_require_auth
    app.dependency_overrides[require_reviewer] = _fake_require_reviewer
    app.dependency_overrides[require_appeals_assigner] = _fake_require_assigner
    yield
    app.dependency_overrides.pop(require_auth, None)
    app.dependency_overrides.pop(require_reviewer, None)
    app.dependency_overrides.pop(require_appeals_assigner, None)


# OPA URL the workflow engine calls by default (config opa_url default).
OPA_ALLOW_URL_RE = r".*/v1/data/sim/guards/adverse_action/allow"


@pytest.fixture(autouse=True)
def opa_mock():
    """Mock the authoritative OPA adverse-action gate (respx).

    Defaults to allow (result=true) so existing adverse-with-signoff tests pass.
    Tests can flip it to deny with:
        opa_mock.mock(return_value=httpx.Response(200, json={"result": False}))
    All non-OPA HTTP requests pass through untouched (ASGI app traffic does not
    use httpcore, so it is never intercepted).
    """
    with respx.mock(assert_all_called=False) as router:
        route = router.route(method="POST", url__regex=OPA_ALLOW_URL_RE)
        route.mock(return_value=httpx.Response(200, json={"result": True}))
        router.route().pass_through()
        yield route


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
    lob: str = "commercial",
    urgency: Urgency = Urgency.standard,
) -> Case:
    """Build a minimal valid Case for testing.

    correlation_id defaults to a new random UUID on each call so tests are
    isolated by default. Pass an explicit value to test idempotency.
    lob and urgency default to "commercial" / Urgency.standard so all existing
    callers are unaffected.
    """
    now = _datetime.now(_tz.utc)
    member_id = _uuid.uuid4()
    return Case(
        case_id=_uuid.uuid4(),
        tenant_id=tenant_id,
        correlation_id=correlation_id or f"corr-{_uuid.uuid4()}",
        lob=lob,
        status=status,
        urgency=urgency,
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
            lob=lob,
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
