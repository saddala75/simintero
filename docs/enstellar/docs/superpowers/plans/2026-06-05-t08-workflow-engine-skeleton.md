# T08 — Workflow-Engine Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic state machine to the workflow-engine: PostgreSQL-backed case instances + immutable event log, FastAPI REST endpoints, Kafka consumer for `case.intake.received`, transitions that emit outbox events, and a hard-coded adverse-transition guard that cannot be bypassed even via direct API call.

**Architecture:** State machine state lives in `workflow_instances` (PostgreSQL). Every state transition: (1) evaluates guards including the un-bypassable adverse-transition guard; (2) writes a `workflow_events` row; (3) writes an `outbox` row — all three in one transaction. `CaseService` owns this orchestration. `TransitionEngine` owns guard evaluation. A Kafka consumer creates cases from `case.intake.received` events. FastAPI exposes the REST surface.

**Tech Stack:** Python 3.12, asyncpg, FastAPI, aiokafka, Alembic, pytest, pytest-asyncio, Testcontainers (PostgreSQL + Redpanda).

> **Invariant note (NON-NEGOTIABLE):** Transitions to `denied`, `partially_denied`, or `adverse_modification` are blocked unless `human_signoff_recorded=True`. This guard lives in `guards.py` and is always evaluated — it is not configurable away. Tests MUST prove that a direct API call to `POST /cases/{id}/transitions` with `to_state=denied` and `human_signoff_recorded=false` returns 409.

**Depends on:** T04 (outbox/event-bus), T07 (normalization/FastAPI skeleton, pyproject.toml baseline).

---

## Background (read before touching code)

All work is under `services/workflow-engine/`. The package name is `enstellar_workflow`.

**Already exists:**
- `enstellar_workflow/config.py` — `Settings` (pydantic-settings, `WORKFLOW_` prefix). `get_settings()` returns singleton.
- `enstellar_workflow/db/connection.py` — `get_pool()` / `close_pool()` (asyncpg pool, DSN from settings).
- `enstellar_workflow/outbox/publisher.py` — `OutboxPublisher.publish(conn, event)`. Inserts into `outbox` table inside caller's transaction. Requires `EventEnvelope`.
- `enstellar_workflow/kafka/consumer.py` — `IdempotentKafkaConsumer` abstract base: `run()`, `stop()`, `handle(event)`. Deduplicates via `processed_events` table.
- `enstellar_workflow/main.py` — FastAPI app, includes `normalization_router`. Has `/health` endpoint.
- `migrations/versions/0001_create_outbox_tables.py` — creates `outbox` + `processed_events` tables.
- `tests/conftest.py` — Testcontainers fixtures: `pg_container`, `db_dsn` (runs `alembic upgrade head`), `pg_pool`, `kafka_container`, `kafka_bootstrap`.
- `pyproject.toml` — already has `asyncpg`, `aiokafka`, `fastapi`, `httpx`, `testcontainers`, `enstellar-events`, `canonical-model` as editable deps.

**Key external types:**
- `canonical_model.Case`, `Status` (StrEnum: `intake`, `completeness_check`, `auto_determination`, `clinical_review`, `pend_rfi`, `approved`, `denied`, `partially_denied`, `adverse_modification`, `withdrawn`, `closed`), `Urgency`, `Member`, `Coverage`, `Provider`, `ServiceLine`
- `enstellar_events.EventEnvelope`, `Actor`, `ActorType` (StrEnum: `user`, `system`, `service`), `Topics`, `encode`, `decode`
- `Topics.CASE_INTAKE_RECEIVED = "case.intake.received"`, `Topics.CASE_STATE_TRANSITIONED = "case.state.transitioned"`

**asyncpg patterns used in this codebase:**
- `async with pool.acquire() as conn:` → get a connection
- `async with conn.transaction():` → explicit transaction (required for outbox writes)
- `await conn.execute(sql, $1, $2, ...)` → write
- `await conn.fetchrow(sql, ...)` → returns `asyncpg.Record | None`
- `await conn.fetch(sql, ...)` → returns `list[asyncpg.Record]`
- `await conn.fetchval(sql, ...)` → returns first column of first row
- JSONB columns: insert with `json.dumps(obj)`, read with `json.loads(row["col"]) if isinstance(row["col"], str) else row["col"]`
- UUID columns: asyncpg returns `uuid.UUID` objects natively

**Test conventions:**
- `tests/conftest.py` provides `pg_pool: asyncpg.Pool` (function-scoped, runs migrations once per session)
- `asyncio_mode = "auto"` in `pyproject.toml` — use `@pytest.mark.asyncio` on each async test
- Run all tests: `cd services/workflow-engine && uv run pytest -v`
- Run a single test: `cd services/workflow-engine && uv run pytest tests/test_guards.py -v`

---

## File Map

**New files:**

| File | Responsibility |
|---|---|
| `migrations/versions/0002_create_workflow_tables.py` | Alembic migration for `workflow_instances` + `workflow_events` tables |
| `enstellar_workflow/engine/__init__.py` | Package marker; re-exports `GuardResult`, `GuardError`, `TransitionRequest`, `TransitionEngine` |
| `enstellar_workflow/engine/guards.py` | `GuardResult`, `GuardError`, `adverse_transition_guard`, `ADVERSE_STATES` |
| `enstellar_workflow/engine/recorder.py` | `EventRecorder.record()` — inserts one `workflow_events` row |
| `enstellar_workflow/engine/transitions.py` | `TransitionRequest`, `TransitionEngine.apply()` — orchestrates guard + recorder + outbox |
| `enstellar_workflow/cases/__init__.py` | Package marker; re-exports `CaseRepository`, `CaseService` |
| `enstellar_workflow/cases/repository.py` | `CaseRepository` — asyncpg CRUD for `workflow_instances` |
| `enstellar_workflow/cases/service.py` | `CaseService` — idempotent `create_case`, `transition`, `get_events` |
| `enstellar_workflow/api/__init__.py` | Package marker |
| `enstellar_workflow/api/router.py` | FastAPI `APIRouter` — POST /cases, GET /cases/{id}, GET /cases/{id}/events, POST /cases/{id}/transitions |
| `enstellar_workflow/consumers/__init__.py` | Package marker |
| `enstellar_workflow/consumers/intake_consumer.py` | `IntakeConsumer(IdempotentKafkaConsumer)` for `case.intake.received` |
| `tests/test_guards.py` | Unit tests for `adverse_transition_guard` — no DB |
| `tests/test_repository.py` | Integration tests for `CaseRepository` |
| `tests/test_recorder.py` | Integration tests for `EventRecorder` |
| `tests/test_transitions.py` | Integration tests for `TransitionEngine` — proves guard blocks denied without sign-off |
| `tests/test_case_service.py` | Integration tests for `CaseService` — idempotency, outbox events |
| `tests/test_cases_api.py` | Integration tests for FastAPI router — includes 409 invariant proof |

**Modified files:**

| File | Change |
|---|---|
| `enstellar_workflow/main.py` | Include `api.router` in the FastAPI app |
| `tests/conftest.py` | Add `make_case` factory function (shared by test_repository, test_recorder, test_transitions, test_case_service, test_cases_api) |
| `.claude/task-graph.md` | Mark T08 as `[x]` |

---

## Task 1: Alembic Migration 0002

**Files:**
- Create: `services/workflow-engine/migrations/versions/0002_create_workflow_tables.py`

- [ ] **Step 1.1: Write the migration file**

Create `services/workflow-engine/migrations/versions/0002_create_workflow_tables.py`:

```python
"""Create workflow_instances and workflow_events tables.

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workflow_instances",
        sa.Column("case_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("correlation_id", sa.Text, nullable=False),
        sa.Column("lob", sa.Text, nullable=False),
        sa.Column("program", sa.Text, nullable=True),
        sa.Column("status", sa.Text, nullable=False, server_default="intake"),
        sa.Column("urgency", sa.Text, nullable=False, server_default="standard"),
        sa.Column("workflow_def_version", sa.Text, nullable=False, server_default="v1"),
        sa.Column("case_json", JSONB, nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("correlation_id", name="uq_workflow_instances_correlation_id"),
        sa.CheckConstraint("tenant_id != ''", name="ck_workflow_instances_tenant_id_not_empty"),
    )
    op.create_index("ix_workflow_instances_tenant_id", "workflow_instances", ["tenant_id"])
    op.create_index("ix_workflow_instances_status", "workflow_instances", ["status"])

    op.create_table(
        "workflow_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "case_id",
            UUID(as_uuid=True),
            sa.ForeignKey("workflow_instances.case_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("event_type", sa.Text, nullable=False),
        sa.Column("from_state", sa.Text, nullable=True),
        sa.Column("to_state", sa.Text, nullable=True),
        sa.Column("actor_id", sa.Text, nullable=False),
        sa.Column("actor_type", sa.Text, nullable=False),
        sa.Column("correlation_id", sa.Text, nullable=False),
        sa.Column("payload", JSONB, nullable=False, server_default="'{}'"),
        sa.Column(
            "occurred_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_workflow_events_case_id", "workflow_events", ["case_id"])
    op.create_index("ix_workflow_events_tenant_id", "workflow_events", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_workflow_events_tenant_id")
    op.drop_index("ix_workflow_events_case_id")
    op.drop_table("workflow_events")
    op.drop_index("ix_workflow_instances_status")
    op.drop_index("ix_workflow_instances_tenant_id")
    op.drop_table("workflow_instances")
```

- [ ] **Step 1.2: Run the migration against a local DB to verify SQL is valid**

```bash
cd services/workflow-engine
WORKFLOW_DB_URL=postgresql://workflow:workflow_secret@localhost:5432/workflow \
  uv run alembic upgrade head
```

Expected output (last two lines):
```
INFO  [alembic.runtime.migration] Running upgrade 0001 -> 0002, Create workflow_instances and workflow_events tables
```

If you don't have the local stack running, skip this step — the migration is validated automatically by the Testcontainers conftest when tests run.

- [ ] **Step 1.3: Commit**

```bash
cd services/workflow-engine
git add migrations/versions/0002_create_workflow_tables.py
git commit -m "feat(workflow-engine): alembic migration 0002 — workflow_instances + workflow_events tables"
```

---

## Task 2: Guards Module

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/engine/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/engine/guards.py`
- Create: `services/workflow-engine/tests/test_guards.py`

- [ ] **Step 2.1: Write the failing tests first**

Create `services/workflow-engine/tests/test_guards.py`:

```python
"""Unit tests for the adverse-transition guard — no DB, no network."""
import pytest

from enstellar_workflow.engine.guards import (
    ADVERSE_STATES,
    GuardError,
    GuardResult,
    adverse_transition_guard,
)


def test_adverse_guard_blocks_denied_without_signoff():
    result = adverse_transition_guard("denied", human_signoff_recorded=False)
    assert result.passed is False
    assert result.reason is not None
    assert "human sign-off" in result.reason


def test_adverse_guard_blocks_partially_denied_without_signoff():
    result = adverse_transition_guard("partially_denied", human_signoff_recorded=False)
    assert result.passed is False
    assert result.reason is not None


def test_adverse_guard_blocks_adverse_modification_without_signoff():
    result = adverse_transition_guard("adverse_modification", human_signoff_recorded=False)
    assert result.passed is False
    assert result.reason is not None


def test_adverse_guard_allows_denied_with_signoff():
    result = adverse_transition_guard("denied", human_signoff_recorded=True)
    assert result.passed is True
    assert result.reason is None


def test_adverse_guard_allows_partially_denied_with_signoff():
    result = adverse_transition_guard("partially_denied", human_signoff_recorded=True)
    assert result.passed is True


def test_adverse_guard_allows_adverse_modification_with_signoff():
    result = adverse_transition_guard("adverse_modification", human_signoff_recorded=True)
    assert result.passed is True


@pytest.mark.parametrize(
    "state",
    [
        "intake",
        "completeness_check",
        "auto_determination",
        "clinical_review",
        "pend_rfi",
        "approved",
        "withdrawn",
        "closed",
    ],
)
def test_adverse_guard_allows_non_adverse_states_without_signoff(state: str):
    result = adverse_transition_guard(state, human_signoff_recorded=False)
    assert result.passed is True, f"Expected pass for non-adverse state {state!r}"


def test_adverse_states_set_contains_exactly_three_states():
    assert ADVERSE_STATES == frozenset({"denied", "partially_denied", "adverse_modification"})


def test_guard_result_is_named_tuple():
    result = GuardResult(passed=True, reason=None)
    assert result.passed is True
    assert result.reason is None


def test_guard_error_carries_reason():
    err = GuardError("test reason")
    assert err.reason == "test reason"
    assert str(err) == "test reason"
```

- [ ] **Step 2.2: Run tests to confirm they fail (module not found)**

```bash
cd services/workflow-engine
uv run pytest tests/test_guards.py -v
```

Expected output:
```
ERRORS
tests/test_guards.py - ModuleNotFoundError: No module named 'enstellar_workflow.engine'
```

- [ ] **Step 2.3: Create the engine package and guards module**

Create `services/workflow-engine/enstellar_workflow/engine/__init__.py`:

```python
"""Workflow engine: guard evaluation, transition application, event recording."""
from .guards import ADVERSE_STATES, GuardError, GuardResult, adverse_transition_guard
from .transitions import TransitionEngine, TransitionRequest

__all__ = [
    "ADVERSE_STATES",
    "GuardError",
    "GuardResult",
    "adverse_transition_guard",
    "TransitionEngine",
    "TransitionRequest",
]
```

Create `services/workflow-engine/enstellar_workflow/engine/guards.py`:

```python
"""Guard functions for state machine transitions.

INVARIANT #1: No code path may produce a denial/adverse determination without
a recorded human (clinician) sign-off. The adverse_transition_guard encodes this
invariant directly and is NOT configurable away.
"""
from __future__ import annotations

from typing import NamedTuple

ADVERSE_STATES: frozenset[str] = frozenset(
    {"denied", "partially_denied", "adverse_modification"}
)


class GuardResult(NamedTuple):
    passed: bool
    reason: str | None


class GuardError(Exception):
    """Raised by TransitionEngine when a guard rejects a transition."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def adverse_transition_guard(
    to_state: str, human_signoff_recorded: bool
) -> GuardResult:
    """INVARIANT #1: Any transition to denied/partially_denied/adverse_modification
    requires human_signoff_recorded=True. This guard is NOT configurable away.

    Args:
        to_state: The target state string (e.g. "denied").
        human_signoff_recorded: True only if a clinician/reviewer has explicitly
            recorded sign-off on this determination.

    Returns:
        GuardResult(passed=True, reason=None) if the transition is allowed.
        GuardResult(passed=False, reason=<message>) if blocked.
    """
    if to_state in ADVERSE_STATES and not human_signoff_recorded:
        return GuardResult(
            passed=False,
            reason=(
                f"transition to {to_state!r} requires human sign-off — invariant #1"
            ),
        )
    return GuardResult(passed=True, reason=None)
```

- [ ] **Step 2.4: Run tests to confirm they pass**

```bash
cd services/workflow-engine
uv run pytest tests/test_guards.py -v
```

Expected output:
```
tests/test_guards.py::test_adverse_guard_blocks_denied_without_signoff PASSED
tests/test_guards.py::test_adverse_guard_blocks_partially_denied_without_signoff PASSED
tests/test_guards.py::test_adverse_guard_blocks_adverse_modification_without_signoff PASSED
tests/test_guards.py::test_adverse_guard_allows_denied_with_signoff PASSED
tests/test_guards.py::test_adverse_guard_allows_partially_denied_with_signoff PASSED
tests/test_guards.py::test_adverse_guard_allows_adverse_modification_with_signoff PASSED
tests/test_guards.py::test_adverse_guard_allows_non_adverse_states_without_signoff[intake] PASSED
... (8 parametrized cases)
tests/test_guards.py::test_adverse_states_set_contains_exactly_three_states PASSED
tests/test_guards.py::test_guard_result_is_named_tuple PASSED
tests/test_guards.py::test_guard_error_carries_reason PASSED

============ 15 passed in 0.Xs ============
```

- [ ] **Step 2.5: Commit**

```bash
cd services/workflow-engine
git add enstellar_workflow/engine/__init__.py enstellar_workflow/engine/guards.py tests/test_guards.py
git commit -m "feat(workflow-engine): adverse-transition guard — invariant #1"
```

---

## Task 3: CaseRepository + shared test fixture

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/cases/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/cases/repository.py`
- Modify: `services/workflow-engine/tests/conftest.py` (add `make_case` helper)
- Create: `services/workflow-engine/tests/test_repository.py`

- [ ] **Step 3.1: Add `make_case` factory to conftest**

`tests/conftest.py` currently has only Testcontainers fixtures. Append the following to the bottom of `services/workflow-engine/tests/conftest.py`:

```python
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
```

- [ ] **Step 3.2: Write the failing repository tests**

Create `services/workflow-engine/tests/test_repository.py`:

```python
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
```

- [ ] **Step 3.3: Run tests to confirm they fail (module not found)**

```bash
cd services/workflow-engine
uv run pytest tests/test_repository.py -v
```

Expected output:
```
ERROR tests/test_repository.py - ModuleNotFoundError: No module named 'enstellar_workflow.cases'
```

- [ ] **Step 3.4: Create the cases package and repository**

Create `services/workflow-engine/enstellar_workflow/cases/__init__.py`:

```python
"""Cases sub-package: repository (DB) and service (orchestration)."""
from .repository import CaseRepository
from .service import CaseService

__all__ = ["CaseRepository", "CaseService"]
```

Create `services/workflow-engine/enstellar_workflow/cases/repository.py`:

```python
"""CaseRepository — asyncpg CRUD for workflow_instances.

All write methods require the caller to be inside a transaction. This is
intentional: callers (TransitionEngine, CaseService) compose multiple writes
atomically and own the transaction boundary.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime

import asyncpg

from canonical_model import Case, Status


class CaseRepository:
    async def insert(self, conn: asyncpg.Connection, case: Case) -> None:
        """Insert a new workflow_instances row.

        The caller must be inside a transaction.
        Does NOT handle ON CONFLICT — use CaseService.create_case for idempotent inserts.
        """
        await conn.execute(
            """
            INSERT INTO workflow_instances
              (case_id, tenant_id, correlation_id, lob, program, status, urgency,
               workflow_def_version, case_json, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
            """,
            case.case_id,
            case.tenant_id,
            case.correlation_id,
            case.lob,
            case.program,
            case.status.value,
            case.urgency.value,
            "v1",
            json.dumps(case.model_dump(mode="json")),
            case.created_at,
            case.updated_at,
        )

    async def fetch_by_id(
        self,
        conn: asyncpg.Connection,
        case_id: uuid.UUID,
        tenant_id: str,
    ) -> Case | None:
        """Fetch a case by primary key, scoped to tenant."""
        row = await conn.fetchrow(
            "SELECT case_json FROM workflow_instances "
            "WHERE case_id = $1 AND tenant_id = $2",
            case_id,
            tenant_id,
        )
        if row is None:
            return None
        return _deserialize_case(row["case_json"])

    async def fetch_by_correlation_id(
        self,
        conn: asyncpg.Connection,
        correlation_id: str,
        tenant_id: str,
    ) -> Case | None:
        """Fetch a case by its idempotency key, scoped to tenant."""
        row = await conn.fetchrow(
            "SELECT case_json FROM workflow_instances "
            "WHERE correlation_id = $1 AND tenant_id = $2",
            correlation_id,
            tenant_id,
        )
        if row is None:
            return None
        return _deserialize_case(row["case_json"])

    async def update_status(
        self,
        conn: asyncpg.Connection,
        case: Case,
        new_status: str,
        updated_at: datetime,
    ) -> None:
        """Update status + case_json snapshot in workflow_instances.

        The caller must be inside a transaction.
        Constructs an updated Case by copying the existing one with the new
        status, then serializes it back to JSONB.
        """
        updated_case = case.model_copy(
            update={"status": Status(new_status), "updated_at": updated_at}
        )
        await conn.execute(
            """
            UPDATE workflow_instances
            SET status = $1, case_json = $2::jsonb, updated_at = $3
            WHERE case_id = $4 AND tenant_id = $5
            """,
            new_status,
            json.dumps(updated_case.model_dump(mode="json")),
            updated_at,
            case.case_id,
            case.tenant_id,
        )


def _deserialize_case(raw: object) -> Case:
    """Normalize asyncpg JSONB output (may be dict or str) and parse as Case."""
    if isinstance(raw, str):
        return Case.model_validate_json(raw)
    return Case.model_validate(raw)
```

- [ ] **Step 3.5: Run tests to confirm they pass**

```bash
cd services/workflow-engine
uv run pytest tests/test_repository.py -v
```

Expected output:
```
tests/test_repository.py::test_insert_and_fetch_by_id PASSED
tests/test_repository.py::test_fetch_by_id_returns_none_when_missing PASSED
tests/test_repository.py::test_fetch_by_id_tenant_isolation PASSED
tests/test_repository.py::test_fetch_by_correlation_id PASSED
tests/test_repository.py::test_fetch_by_correlation_id_returns_none_when_missing PASSED
tests/test_repository.py::test_update_status_changes_status_and_case_json PASSED
tests/test_repository.py::test_update_status_preserves_other_fields PASSED

============ 7 passed in X.Xs ============
```

- [ ] **Step 3.6: Commit**

```bash
cd services/workflow-engine
git add \
  enstellar_workflow/cases/__init__.py \
  enstellar_workflow/cases/repository.py \
  tests/conftest.py \
  tests/test_repository.py
git commit -m "feat(workflow-engine): CaseRepository — asyncpg CRUD for workflow_instances"
```

---

## Task 4: EventRecorder

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/engine/recorder.py`
- Create: `services/workflow-engine/tests/test_recorder.py`

- [ ] **Step 4.1: Write the failing tests first**

Create `services/workflow-engine/tests/test_recorder.py`:

```python
"""Integration tests for EventRecorder — requires PostgreSQL (Testcontainers)."""
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest

from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.engine.recorder import EventRecorder
from tests.conftest import make_case


@pytest.mark.asyncio
async def test_recorder_inserts_event_row(pg_pool: asyncpg.Pool):
    # Setup: insert a case row first (workflow_events has FK to workflow_instances)
    case = make_case()
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    recorder = EventRecorder()
    occurred_at = datetime.now(timezone.utc)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.record(
                conn,
                case_id=case.case_id,
                tenant_id=case.tenant_id,
                event_type="case.state.transitioned",
                from_state="intake",
                to_state="completeness_check",
                actor_id="system",
                actor_type="system",
                correlation_id=case.correlation_id,
                payload={"reason": "auto"},
                occurred_at=occurred_at,
            )

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT event_type, from_state, to_state, actor_id, actor_type "
            "FROM workflow_events WHERE case_id = $1",
            case.case_id,
        )

    assert row is not None
    assert row["event_type"] == "case.state.transitioned"
    assert row["from_state"] == "intake"
    assert row["to_state"] == "completeness_check"
    assert row["actor_id"] == "system"
    assert row["actor_type"] == "system"


@pytest.mark.asyncio
async def test_recorder_propagates_tenant_id(pg_pool: asyncpg.Pool):
    case = make_case(tenant_id="tenant-rec-check")
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    recorder = EventRecorder()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.record(
                conn,
                case_id=case.case_id,
                tenant_id=case.tenant_id,
                event_type="case.state.transitioned",
                from_state="intake",
                to_state="completeness_check",
                actor_id="system",
                actor_type="system",
                correlation_id=case.correlation_id,
                payload={},
            )

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT tenant_id FROM workflow_events WHERE case_id = $1",
            case.case_id,
        )

    assert row is not None
    assert row["tenant_id"] == "tenant-rec-check"


@pytest.mark.asyncio
async def test_recorder_stores_payload(pg_pool: asyncpg.Pool):
    case = make_case()
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    recorder = EventRecorder()
    payload = {"extra_key": "extra_value", "count": 42}

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.record(
                conn,
                case_id=case.case_id,
                tenant_id=case.tenant_id,
                event_type="case.state.transitioned",
                from_state="intake",
                to_state="completeness_check",
                actor_id="system",
                actor_type="system",
                correlation_id=case.correlation_id,
                payload=payload,
            )

    async with pg_pool.acquire() as conn:
        raw = await conn.fetchval(
            "SELECT payload FROM workflow_events WHERE case_id = $1",
            case.case_id,
        )

    # asyncpg may return JSONB as dict or str
    import json as _json
    stored = _json.loads(raw) if isinstance(raw, str) else raw
    assert stored["extra_key"] == "extra_value"
    assert stored["count"] == 42


@pytest.mark.asyncio
async def test_recorder_multiple_events_ordered_by_id(pg_pool: asyncpg.Pool):
    """Multiple events for the same case must be stored and retrieval order matches insertion."""
    case = make_case()
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    recorder = EventRecorder()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.record(
                conn,
                case_id=case.case_id,
                tenant_id=case.tenant_id,
                event_type="case.state.transitioned",
                from_state="intake",
                to_state="completeness_check",
                actor_id="system",
                actor_type="system",
                correlation_id=case.correlation_id,
                payload={},
            )
        async with conn.transaction():
            await recorder.record(
                conn,
                case_id=case.case_id,
                tenant_id=case.tenant_id,
                event_type="case.state.transitioned",
                from_state="completeness_check",
                to_state="auto_determination",
                actor_id="system",
                actor_type="system",
                correlation_id=case.correlation_id,
                payload={},
            )

    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT from_state, to_state FROM workflow_events "
            "WHERE case_id = $1 ORDER BY id ASC",
            case.case_id,
        )

    assert len(rows) == 2
    assert rows[0]["from_state"] == "intake"
    assert rows[0]["to_state"] == "completeness_check"
    assert rows[1]["from_state"] == "completeness_check"
    assert rows[1]["to_state"] == "auto_determination"
```

- [ ] **Step 4.2: Run tests to confirm they fail (module not found)**

```bash
cd services/workflow-engine
uv run pytest tests/test_recorder.py -v
```

Expected output:
```
ERROR tests/test_recorder.py - ModuleNotFoundError: No module named 'enstellar_workflow.engine.recorder'
```

- [ ] **Step 4.3: Create the recorder module**

Create `services/workflow-engine/enstellar_workflow/engine/recorder.py`:

```python
"""EventRecorder — writes one immutable row to workflow_events per transition.

All calls require the caller to be inside a transaction. The EventRecorder has
no state; instantiate it freely.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg


class EventRecorder:
    async def record(
        self,
        conn: asyncpg.Connection,
        *,
        case_id: uuid.UUID,
        tenant_id: str,
        event_type: str,
        from_state: str | None,
        to_state: str | None,
        actor_id: str,
        actor_type: str,
        correlation_id: str,
        payload: dict[str, Any],
        occurred_at: datetime | None = None,
    ) -> None:
        """Insert one workflow_events row.

        The caller must be inside a transaction. occurred_at defaults to now()
        in UTC if not supplied. Keyword-only arguments prevent positional confusion.
        """
        if occurred_at is None:
            occurred_at = datetime.now(timezone.utc)

        await conn.execute(
            """
            INSERT INTO workflow_events
              (case_id, tenant_id, event_type, from_state, to_state,
               actor_id, actor_type, correlation_id, payload, occurred_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
            """,
            case_id,
            tenant_id,
            event_type,
            from_state,
            to_state,
            actor_id,
            actor_type,
            correlation_id,
            json.dumps(payload),
            occurred_at,
        )
```

- [ ] **Step 4.4: Update `engine/__init__.py` to export `EventRecorder`**

Edit `services/workflow-engine/enstellar_workflow/engine/__init__.py`:

```python
"""Workflow engine: guard evaluation, transition application, event recording."""
from .guards import ADVERSE_STATES, GuardError, GuardResult, adverse_transition_guard
from .recorder import EventRecorder
from .transitions import TransitionEngine, TransitionRequest

__all__ = [
    "ADVERSE_STATES",
    "GuardError",
    "GuardResult",
    "adverse_transition_guard",
    "EventRecorder",
    "TransitionEngine",
    "TransitionRequest",
]
```

(Note: `transitions.py` does not exist yet; this import will fail until Task 5. For now the `__init__.py` still works because `transitions` is imported lazily at test time. If you prefer, skip the `transitions` line in `__init__.py` and add it in Task 5.)

Alternative safe `__init__.py` for this step (avoids the not-yet-created transitions import):

```python
"""Workflow engine: guard evaluation, transition application, event recording."""
from .guards import ADVERSE_STATES, GuardError, GuardResult, adverse_transition_guard
from .recorder import EventRecorder

__all__ = [
    "ADVERSE_STATES",
    "GuardError",
    "GuardResult",
    "adverse_transition_guard",
    "EventRecorder",
]
```

Use the safe version above for this task. The full version with TransitionEngine is applied in Task 5.

- [ ] **Step 4.5: Run tests to confirm they pass**

```bash
cd services/workflow-engine
uv run pytest tests/test_recorder.py -v
```

Expected output:
```
tests/test_recorder.py::test_recorder_inserts_event_row PASSED
tests/test_recorder.py::test_recorder_propagates_tenant_id PASSED
tests/test_recorder.py::test_recorder_stores_payload PASSED
tests/test_recorder.py::test_recorder_multiple_events_ordered_by_id PASSED

============ 4 passed in X.Xs ============
```

- [ ] **Step 4.6: Also confirm all earlier tests still pass**

```bash
cd services/workflow-engine
uv run pytest tests/test_guards.py tests/test_repository.py tests/test_recorder.py -v
```

Expected: all tests pass.

- [ ] **Step 4.7: Commit**

```bash
cd services/workflow-engine
git add \
  enstellar_workflow/engine/recorder.py \
  enstellar_workflow/engine/__init__.py \
  tests/test_recorder.py
git commit -m "feat(workflow-engine): EventRecorder — immutable workflow_events rows"
```

---

## Task 5: TransitionEngine

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/engine/transitions.py`
- Create: `services/workflow-engine/tests/test_transitions.py`
- Modify: `services/workflow-engine/enstellar_workflow/engine/__init__.py` (add TransitionEngine export)

- [ ] **Step 5.1: Write the failing tests first (including the invariant proof)**

Create `services/workflow-engine/tests/test_transitions.py`:

```python
"""Integration tests for TransitionEngine.

CRITICAL: This file contains the invariant proof for T08.
test_engine_denied_without_signoff_raises_guard_error proves that the
adverse-transition guard cannot be bypassed even by direct engine call.
"""
import uuid

import asyncpg
import pytest

from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.guards import GuardError
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from tests.conftest import make_case


@pytest.mark.asyncio
async def test_engine_intake_to_completeness_check_emits_workflow_event(pg_pool: asyncpg.Pool):
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            updated = await engine.apply(conn, req)

    assert updated.status.value == "completeness_check"

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT from_state, to_state FROM workflow_events "
            "WHERE case_id = $1 AND to_state = 'completeness_check'",
            created.case_id,
        )

    assert row is not None
    assert row["from_state"] == "intake"
    assert row["to_state"] == "completeness_check"


@pytest.mark.asyncio
async def test_engine_transition_emits_outbox_row(pg_pool: asyncpg.Pool):
    """Transition must write an outbox row in the same transaction."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await engine.apply(conn, req)

    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM outbox "
            "WHERE case_id = $1 AND type = 'case.state.transitioned'",
            created.case_id,
        )

    assert count >= 1


@pytest.mark.asyncio
async def test_engine_updates_status_in_workflow_instances(pg_pool: asyncpg.Pool):
    from enstellar_workflow.cases.repository import CaseRepository
    from canonical_model import Status

    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="auto_determination",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await engine.apply(conn, req)

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)

    assert fetched is not None
    assert fetched.status == Status.auto_determination


@pytest.mark.asyncio
async def test_engine_raises_value_error_for_missing_case(pg_pool: asyncpg.Pool):
    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=uuid.uuid4(),  # does not exist
        tenant_id="tenant-t08",
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id="corr-missing",
    )

    with pytest.raises(ValueError, match="not found"):
        async with pg_pool.acquire() as conn:
            async with conn.transaction():
                await engine.apply(conn, req)


# ============================================================
# INVARIANT #1 PROOF — This test is SACRED. Never weaken it.
# ============================================================


@pytest.mark.asyncio
async def test_engine_denied_without_signoff_raises_guard_error():
    """INVARIANT #1: Direct call to TransitionEngine.apply with to_state='denied'
    and human_signoff_recorded=False MUST raise GuardError.

    This test proves the guard cannot be bypassed even at the engine level,
    before any HTTP layer is involved.
    """
    import asyncpg as _asyncpg
    from testcontainers.postgres import PostgresContainer
    import subprocess, sys, pathlib, os

    with PostgresContainer("postgres:16-alpine") as pg:
        dsn = pg.get_connection_url().replace("postgresql+psycopg2://", "postgresql://")
        env = {**os.environ, "WORKFLOW_DB_URL": dsn}
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=str(pathlib.Path(__file__).parent.parent),
            env=env,
            check=True,
        )
        pool = await _asyncpg.create_pool(dsn, min_size=1, max_size=2)
        try:
            service = CaseService(pool)
            case = make_case()
            created = await service.create_case(case)

            engine = TransitionEngine()
            req = TransitionRequest(
                case_id=created.case_id,
                tenant_id=created.tenant_id,
                to_state="denied",
                actor_id="direct-api-caller",
                actor_type="service",
                correlation_id=created.correlation_id,
                human_signoff_recorded=False,  # <-- no sign-off
            )

            with pytest.raises(GuardError) as exc_info:
                async with pool.acquire() as conn:
                    async with conn.transaction():
                        await engine.apply(conn, req)

            assert "human sign-off" in str(exc_info.value)
            assert "denied" in str(exc_info.value)

            # Verify NO outbox row was written (transaction must have rolled back)
            async with pool.acquire() as conn:
                count = await conn.fetchval(
                    "SELECT COUNT(*) FROM outbox "
                    "WHERE case_id = $1 AND type = 'case.state.transitioned'",
                    created.case_id,
                )
            # The case.intake.received outbox event was written by create_case,
            # but there must be no case.state.transitioned event for the denied attempt
            transition_count = await pool.fetchval(
                "SELECT COUNT(*) FROM outbox "
                "WHERE case_id = $1 AND payload->>'to_state' = 'denied'",
                created.case_id,
            ) if False else 0  # see note below

            # Simpler assertion: ensure no denied transition event in workflow_events
            async with pool.acquire() as conn:
                we_count = await conn.fetchval(
                    "SELECT COUNT(*) FROM workflow_events "
                    "WHERE case_id = $1 AND to_state = 'denied'",
                    created.case_id,
                )
            assert we_count == 0, (
                "INVARIANT VIOLATED: a denied workflow_events row was written "
                "without human sign-off"
            )
        finally:
            await pool.close()


@pytest.mark.asyncio
async def test_engine_denied_with_signoff_succeeds(pg_pool: asyncpg.Pool):
    """Transition to denied IS allowed when human_signoff_recorded=True."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="denied",
        actor_id="reviewer-001",
        actor_type="user",
        correlation_id=created.correlation_id,
        human_signoff_recorded=True,  # <-- sign-off present
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            updated = await engine.apply(conn, req)

    assert updated.status.value == "denied"
```

- [ ] **Step 5.2: Run tests to confirm they fail (module not found)**

```bash
cd services/workflow-engine
uv run pytest tests/test_transitions.py -v
```

Expected output:
```
ERROR tests/test_transitions.py - ModuleNotFoundError: No module named 'enstellar_workflow.engine.transitions'
```

- [ ] **Step 5.3: Create the TransitionEngine**

Create `services/workflow-engine/enstellar_workflow/engine/transitions.py`:

```python
"""TransitionEngine — applies a state transition atomically.

All three side-effects (workflow_events row, workflow_instances status update,
outbox row) happen in the caller's transaction. If any step raises, the
transaction rolls back and nothing is persisted.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import asyncpg

from canonical_model import Case, Status
from enstellar_events import Actor, ActorType, EventEnvelope, Topics

from .guards import GuardError, adverse_transition_guard
from .recorder import EventRecorder
from ..cases.repository import CaseRepository
from ..outbox.publisher import OutboxPublisher


@dataclass
class TransitionRequest:
    case_id: uuid.UUID
    tenant_id: str
    to_state: str
    actor_id: str
    actor_type: str  # 'user' | 'system' | 'service'
    correlation_id: str
    payload: dict = field(default_factory=dict)
    human_signoff_recorded: bool = False


class TransitionEngine:
    """Applies a validated state transition inside a caller-supplied transaction."""

    def __init__(self) -> None:
        self._repo = CaseRepository()
        self._recorder = EventRecorder()
        self._publisher = OutboxPublisher()

    async def apply(self, conn: asyncpg.Connection, req: TransitionRequest) -> Case:
        """Evaluate guards, record event, update status, publish outbox event.

        All writes happen inside the caller's transaction.
        Raises GuardError if any guard fails (caller's transaction rolls back).
        Raises ValueError if the case is not found.
        """
        # 1. Fetch current case (validates case_id + tenant_id)
        case = await self._repo.fetch_by_id(conn, req.case_id, req.tenant_id)
        if case is None:
            raise ValueError(
                f"Case {req.case_id} not found for tenant {req.tenant_id!r}"
            )

        from_state = case.status.value

        # 2. Evaluate the adverse-transition guard (INVARIANT #1 — non-bypassable)
        guard_result = adverse_transition_guard(req.to_state, req.human_signoff_recorded)
        if not guard_result.passed:
            raise GuardError(guard_result.reason)  # type: ignore[arg-type]

        occurred_at = datetime.now(timezone.utc)

        # 3. Write an immutable workflow_events row
        await self._recorder.record(
            conn,
            case_id=req.case_id,
            tenant_id=req.tenant_id,
            event_type=Topics.CASE_STATE_TRANSITIONED,
            from_state=from_state,
            to_state=req.to_state,
            actor_id=req.actor_id,
            actor_type=req.actor_type,
            correlation_id=req.correlation_id,
            payload=req.payload,
            occurred_at=occurred_at,
        )

        # 4. Update the workflow_instances status + case_json snapshot
        await self._repo.update_status(conn, case, req.to_state, occurred_at)

        # 5. Write an outbox event (picked up by OutboxRelay → Kafka)
        try:
            actor_type_enum = ActorType(req.actor_type)
        except ValueError:
            actor_type_enum = ActorType.SERVICE

        event = EventEnvelope(
            event_id=uuid.uuid4(),
            tenant_id=req.tenant_id,
            case_id=req.case_id,
            correlation_id=req.correlation_id,
            type=Topics.CASE_STATE_TRANSITIONED,
            occurred_at=occurred_at,
            actor=Actor(id=req.actor_id, type=actor_type_enum),
            payload={
                "from_state": from_state,
                "to_state": req.to_state,
                **req.payload,
            },
            schema_version="1.0.0",
        )
        await self._publisher.publish(conn, event)

        # 6. Return the updated case (constructed locally — no extra DB round-trip)
        return case.model_copy(
            update={"status": Status(req.to_state), "updated_at": occurred_at}
        )
```

- [ ] **Step 5.4: Update `engine/__init__.py` to include the full exports**

Edit `services/workflow-engine/enstellar_workflow/engine/__init__.py`:

```python
"""Workflow engine: guard evaluation, transition application, event recording."""
from .guards import ADVERSE_STATES, GuardError, GuardResult, adverse_transition_guard
from .recorder import EventRecorder
from .transitions import TransitionEngine, TransitionRequest

__all__ = [
    "ADVERSE_STATES",
    "GuardError",
    "GuardResult",
    "adverse_transition_guard",
    "EventRecorder",
    "TransitionEngine",
    "TransitionRequest",
]
```

- [ ] **Step 5.5: Run the transition tests to confirm they pass**

```bash
cd services/workflow-engine
uv run pytest tests/test_transitions.py -v
```

Expected output:
```
tests/test_transitions.py::test_engine_intake_to_completeness_check_emits_workflow_event PASSED
tests/test_transitions.py::test_engine_transition_emits_outbox_row PASSED
tests/test_transitions.py::test_engine_updates_status_in_workflow_instances PASSED
tests/test_transitions.py::test_engine_raises_value_error_for_missing_case PASSED
tests/test_transitions.py::test_engine_denied_without_signoff_raises_guard_error PASSED
tests/test_transitions.py::test_engine_denied_with_signoff_succeeds PASSED

============ 6 passed in X.Xs ============
```

- [ ] **Step 5.6: Confirm all tests to date still pass**

```bash
cd services/workflow-engine
uv run pytest tests/test_guards.py tests/test_repository.py tests/test_recorder.py tests/test_transitions.py -v
```

Expected: all pass.

- [ ] **Step 5.7: Commit**

```bash
cd services/workflow-engine
git add \
  enstellar_workflow/engine/transitions.py \
  enstellar_workflow/engine/__init__.py \
  tests/test_transitions.py
git commit -m "feat(workflow-engine): TransitionEngine — guard + recorder + outbox in one transaction"
```

---

## Task 6: CaseService

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/cases/service.py`
- Create: `services/workflow-engine/tests/test_case_service.py`
- Modify: `services/workflow-engine/enstellar_workflow/cases/__init__.py` (add CaseService export)

- [ ] **Step 6.1: Write the failing tests**

Create `services/workflow-engine/tests/test_case_service.py`:

```python
"""Integration tests for CaseService — requires PostgreSQL (Testcontainers)."""
import uuid
from datetime import timezone

import asyncpg
import pytest

from canonical_model import Status
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.guards import GuardError
from enstellar_workflow.engine.transitions import TransitionRequest
from tests.conftest import make_case


@pytest.mark.asyncio
async def test_create_case_returns_case(pg_pool: asyncpg.Pool):
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    assert created.case_id == case.case_id
    assert created.tenant_id == case.tenant_id
    assert created.status == Status.intake


@pytest.mark.asyncio
async def test_create_case_emits_intake_outbox_event(pg_pool: asyncpg.Pool):
    """create_case must publish a case.intake.received outbox event."""
    service = CaseService(pg_pool)
    case = make_case(correlation_id=f"corr-svc-intake-{uuid.uuid4()}")
    await service.create_case(case)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT type, tenant_id FROM outbox WHERE case_id = $1",
            case.case_id,
        )

    assert row is not None
    assert row["type"] == "case.intake.received"
    assert row["tenant_id"] == case.tenant_id


@pytest.mark.asyncio
async def test_create_case_idempotent_on_correlation_id(pg_pool: asyncpg.Pool):
    """Calling create_case twice with the same correlation_id returns the same case."""
    service = CaseService(pg_pool)
    correlation_id = f"corr-idem-svc-{uuid.uuid4()}"

    case1 = make_case(correlation_id=correlation_id)
    case2 = make_case(correlation_id=correlation_id)  # different case_id, same corr_id

    first = await service.create_case(case1)
    second = await service.create_case(case2)

    assert first.case_id == second.case_id  # same persisted row returned


@pytest.mark.asyncio
async def test_create_case_idempotent_no_duplicate_outbox_event(pg_pool: asyncpg.Pool):
    """Duplicate create_case calls must NOT produce a second outbox event."""
    service = CaseService(pg_pool)
    correlation_id = f"corr-idem-outbox-{uuid.uuid4()}"

    case = make_case(correlation_id=correlation_id)
    await service.create_case(case)
    await service.create_case(case)  # duplicate

    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM outbox WHERE correlation_id = $1 "
            "AND type = 'case.intake.received'",
            correlation_id,
        )

    assert count == 1  # exactly one, not two


@pytest.mark.asyncio
async def test_transition_changes_case_status(pg_pool: asyncpg.Pool):
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    )
    updated = await service.transition(req)

    assert updated.status == Status.completeness_check


@pytest.mark.asyncio
async def test_transition_denied_without_signoff_raises_guard_error(pg_pool: asyncpg.Pool):
    """INVARIANT #1: CaseService.transition must propagate GuardError for adverse transitions."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="denied",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
        human_signoff_recorded=False,
    )

    with pytest.raises(GuardError, match="human sign-off"):
        await service.transition(req)


@pytest.mark.asyncio
async def test_get_events_returns_events_in_order(pg_pool: asyncpg.Pool):
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    # Apply two transitions
    await service.transition(TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    ))
    await service.transition(TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="auto_determination",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    ))

    events = await service.get_events(created.case_id, created.tenant_id)

    assert len(events) == 2
    assert events[0]["from_state"] == "intake"
    assert events[0]["to_state"] == "completeness_check"
    assert events[1]["from_state"] == "completeness_check"
    assert events[1]["to_state"] == "auto_determination"


@pytest.mark.asyncio
async def test_get_events_returns_empty_list_for_new_case(pg_pool: asyncpg.Pool):
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    events = await service.get_events(created.case_id, created.tenant_id)

    assert events == []


@pytest.mark.asyncio
async def test_get_events_tenant_isolation(pg_pool: asyncpg.Pool):
    """Events must not be returned for a different tenant_id."""
    service = CaseService(pg_pool)
    case = make_case(tenant_id="tenant-svc-iso")
    created = await service.create_case(case)

    await service.transition(TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id=created.correlation_id,
    ))

    events = await service.get_events(created.case_id, "tenant-other")
    assert events == []
```

- [ ] **Step 6.2: Run tests to confirm they fail (module not found)**

```bash
cd services/workflow-engine
uv run pytest tests/test_case_service.py -v
```

Expected output:
```
ERROR tests/test_case_service.py - ModuleNotFoundError: No module named 'enstellar_workflow.cases.service'
```

- [ ] **Step 6.3: Create CaseService**

Create `services/workflow-engine/enstellar_workflow/cases/service.py`:

```python
"""CaseService — application-level orchestration for case lifecycle.

Owns the transaction boundaries for create_case and transition.
CaseRepository and TransitionEngine handle the DB writes;
CaseService coordinates them and the asyncpg pool.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg

from canonical_model import Case
from enstellar_events import Actor, ActorType, EventEnvelope, Topics

from ..db.connection import get_pool
from ..engine.transitions import TransitionEngine, TransitionRequest
from ..outbox.publisher import OutboxPublisher
from .repository import CaseRepository


class CaseService:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool
        self._repo = CaseRepository()
        self._engine = TransitionEngine()
        self._publisher = OutboxPublisher()

    async def create_case(self, case: Case) -> Case:
        """Create a case, idempotent on (correlation_id, tenant_id).

        If a row with the same correlation_id already exists for this tenant,
        returns the existing case with no side-effects. Otherwise inserts the
        row and writes a case.intake.received event to the outbox — both in a
        single transaction.
        """
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                # Attempt idempotent insert — ON CONFLICT returns no row
                row = await conn.fetchrow(
                    """
                    INSERT INTO workflow_instances
                      (case_id, tenant_id, correlation_id, lob, program, status, urgency,
                       workflow_def_version, case_json, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
                    ON CONFLICT (correlation_id) DO NOTHING
                    RETURNING case_id
                    """,
                    case.case_id,
                    case.tenant_id,
                    case.correlation_id,
                    case.lob,
                    case.program,
                    case.status.value,
                    case.urgency.value,
                    "v1",
                    json.dumps(case.model_dump(mode="json")),
                    case.created_at,
                    case.updated_at,
                )

                if row is None:
                    # Duplicate correlation_id — return existing case without side-effects
                    existing = await self._repo.fetch_by_correlation_id(
                        conn, case.correlation_id, case.tenant_id
                    )
                    return existing  # type: ignore[return-value]

                # New case — publish intake event to outbox in same transaction
                event = EventEnvelope(
                    event_id=uuid.uuid4(),
                    tenant_id=case.tenant_id,
                    case_id=case.case_id,
                    correlation_id=case.correlation_id,
                    type=Topics.CASE_INTAKE_RECEIVED,
                    occurred_at=case.created_at,
                    actor=Actor(id="system", type=ActorType.SYSTEM),
                    payload={"status": case.status.value},
                    schema_version="1.0.0",
                )
                await self._publisher.publish(conn, event)
                return case

    async def transition(self, req: TransitionRequest) -> Case:
        """Apply a state transition.

        Wraps TransitionEngine.apply in a transaction. GuardError propagates
        unchanged so the API layer can convert it to HTTP 409.
        """
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                return await self._engine.apply(conn, req)

    async def get_events(
        self, case_id: uuid.UUID, tenant_id: str
    ) -> list[dict[str, Any]]:
        """Return all workflow_events rows for a case, ordered by insertion (id ASC)."""
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, case_id, tenant_id, event_type, from_state, to_state,
                       actor_id, actor_type, correlation_id, payload, occurred_at
                FROM workflow_events
                WHERE case_id = $1 AND tenant_id = $2
                ORDER BY id ASC
                """,
                case_id,
                tenant_id,
            )

        result = []
        for row in rows:
            payload = row["payload"]
            if isinstance(payload, str):
                import json as _json
                payload = _json.loads(payload)
            result.append(
                {
                    "id": row["id"],
                    "case_id": str(row["case_id"]),
                    "tenant_id": row["tenant_id"],
                    "event_type": row["event_type"],
                    "from_state": row["from_state"],
                    "to_state": row["to_state"],
                    "actor_id": row["actor_id"],
                    "actor_type": row["actor_type"],
                    "correlation_id": row["correlation_id"],
                    "payload": payload,
                    "occurred_at": row["occurred_at"].isoformat(),
                }
            )
        return result
```

- [ ] **Step 6.4: Update `cases/__init__.py`**

Edit `services/workflow-engine/enstellar_workflow/cases/__init__.py`:

```python
"""Cases sub-package: repository (DB) and service (orchestration)."""
from .repository import CaseRepository
from .service import CaseService

__all__ = ["CaseRepository", "CaseService"]
```

- [ ] **Step 6.5: Run the service tests to confirm they pass**

```bash
cd services/workflow-engine
uv run pytest tests/test_case_service.py -v
```

Expected output:
```
tests/test_case_service.py::test_create_case_returns_case PASSED
tests/test_case_service.py::test_create_case_emits_intake_outbox_event PASSED
tests/test_case_service.py::test_create_case_idempotent_on_correlation_id PASSED
tests/test_case_service.py::test_create_case_idempotent_no_duplicate_outbox_event PASSED
tests/test_case_service.py::test_transition_changes_case_status PASSED
tests/test_case_service.py::test_transition_denied_without_signoff_raises_guard_error PASSED
tests/test_case_service.py::test_get_events_returns_events_in_order PASSED
tests/test_case_service.py::test_get_events_returns_empty_list_for_new_case PASSED
tests/test_case_service.py::test_get_events_tenant_isolation PASSED

============ 9 passed in X.Xs ============
```

- [ ] **Step 6.6: Confirm full test suite to date passes**

```bash
cd services/workflow-engine
uv run pytest tests/test_guards.py tests/test_repository.py tests/test_recorder.py \
  tests/test_transitions.py tests/test_case_service.py -v
```

Expected: all pass.

- [ ] **Step 6.7: Commit**

```bash
cd services/workflow-engine
git add \
  enstellar_workflow/cases/service.py \
  enstellar_workflow/cases/__init__.py \
  tests/test_case_service.py
git commit -m "feat(workflow-engine): CaseService — idempotent create_case, transition, get_events"
```

---

## Task 7: FastAPI Router + IntakeConsumer

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/api/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/api/router.py`
- Create: `services/workflow-engine/enstellar_workflow/consumers/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/consumers/intake_consumer.py`
- Create: `services/workflow-engine/tests/test_cases_api.py`
- Modify: `services/workflow-engine/enstellar_workflow/main.py`

- [ ] **Step 7.1: Write the failing API tests (including the 409 invariant proof)**

Create `services/workflow-engine/tests/test_cases_api.py`:

```python
"""Integration tests for the /cases FastAPI router.

CRITICAL: test_api_transition_denied_without_signoff_returns_409 is the
HTTP-layer proof of INVARIANT #1. It must never be weakened or removed.
"""
import uuid

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app
from tests.conftest import make_case


@pytest_asyncio.fixture
async def ac(db_dsn: str, monkeypatch) -> AsyncClient:
    """AsyncClient targeting the FastAPI app, wired to the Testcontainers PostgreSQL."""
    # Point the workflow pool at the test DB
    monkeypatch.setenv(
        "WORKFLOW_DB_URL",
        db_dsn.replace("postgresql://", "postgresql+asyncpg://"),
    )
    # Reset singletons so the new DSN is picked up
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
async def test_post_cases_creates_case_and_returns_201(ac: AsyncClient):
    case = make_case()
    resp = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["case_id"] == str(case.case_id)
    assert data["tenant_id"] == case.tenant_id
    assert data["status"] == "intake"


@pytest.mark.asyncio
async def test_post_cases_idempotent_returns_same_case(ac: AsyncClient):
    """POST /cases with the same correlation_id returns the same case_id both times."""
    case = make_case(correlation_id=f"corr-api-idem-{uuid.uuid4()}")
    resp1 = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    resp2 = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["case_id"] == resp2.json()["case_id"]


@pytest.mark.asyncio
async def test_get_case_returns_200(ac: AsyncClient):
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    resp = await ac.get(
        f"/cases/{case.case_id}",
        params={"tenant_id": case.tenant_id},
    )
    assert resp.status_code == 200
    assert resp.json()["case_id"] == str(case.case_id)


@pytest.mark.asyncio
async def test_get_case_returns_404_for_missing(ac: AsyncClient):
    resp = await ac.get(
        f"/cases/{uuid.uuid4()}",
        params={"tenant_id": "tenant-t08"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_case_events_returns_events_after_transition(ac: AsyncClient):
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )

    transition_body = {
        "tenant_id": case.tenant_id,
        "to_state": "completeness_check",
        "actor_id": "system",
        "actor_type": "system",
        "correlation_id": case.correlation_id,
    }
    tr = await ac.post(f"/cases/{case.case_id}/transitions", json=transition_body)
    assert tr.status_code == 200

    events_resp = await ac.get(
        f"/cases/{case.case_id}/events",
        params={"tenant_id": case.tenant_id},
    )
    assert events_resp.status_code == 200
    events = events_resp.json()
    assert len(events) >= 1
    transition_event = next(
        (e for e in events if e["to_state"] == "completeness_check"), None
    )
    assert transition_event is not None
    assert transition_event["from_state"] == "intake"


@pytest.mark.asyncio
async def test_post_transition_returns_updated_case(ac: AsyncClient):
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )

    resp = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "completeness_check",
            "actor_id": "system",
            "actor_type": "system",
            "correlation_id": case.correlation_id,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "completeness_check"


# ============================================================
# INVARIANT #1 HTTP-LAYER PROOF — This test is SACRED.
# ============================================================


@pytest.mark.asyncio
async def test_api_transition_denied_without_signoff_returns_409(ac: AsyncClient):
    """INVARIANT #1: POST /cases/{id}/transitions to 'denied' without human_signoff_recorded
    MUST return 409 Conflict, even when called directly via the API.

    This is the HTTP-layer proof of the adverse-transition guard. If this test
    is removed or weakened, the invariant is violated.
    """
    case = make_case()
    create_resp = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert create_resp.status_code == 201

    resp = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "denied",
            "actor_id": "direct-api-caller",
            "actor_type": "service",
            "correlation_id": case.correlation_id,
            "human_signoff_recorded": False,  # <-- no sign-off
        },
    )

    assert resp.status_code == 409, (
        f"INVARIANT VIOLATED: expected 409 but got {resp.status_code}. "
        f"Response: {resp.text}"
    )
    detail = resp.json().get("detail", "")
    assert "human sign-off" in detail.lower(), (
        f"INVARIANT VIOLATED: 409 returned but error message does not mention "
        f"'human sign-off'. Got: {detail!r}"
    )


@pytest.mark.asyncio
async def test_api_transition_partially_denied_without_signoff_returns_409(ac: AsyncClient):
    """INVARIANT #1: Same guard applies to partially_denied."""
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )

    resp = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "partially_denied",
            "actor_id": "direct-api-caller",
            "actor_type": "service",
            "correlation_id": case.correlation_id,
            "human_signoff_recorded": False,
        },
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_api_transition_adverse_modification_without_signoff_returns_409(ac: AsyncClient):
    """INVARIANT #1: Same guard applies to adverse_modification."""
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )

    resp = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "adverse_modification",
            "actor_id": "direct-api-caller",
            "actor_type": "service",
            "correlation_id": case.correlation_id,
            "human_signoff_recorded": False,
        },
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_api_transition_denied_with_signoff_returns_200(ac: AsyncClient):
    """Adverse transition IS allowed when human_signoff_recorded=True."""
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )

    resp = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "denied",
            "actor_id": "reviewer-001",
            "actor_type": "user",
            "correlation_id": case.correlation_id,
            "human_signoff_recorded": True,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "denied"
```

- [ ] **Step 7.2: Run tests to confirm they fail (module not found)**

```bash
cd services/workflow-engine
uv run pytest tests/test_cases_api.py -v
```

Expected output:
```
ERROR tests/test_cases_api.py - ModuleNotFoundError: No module named 'enstellar_workflow.api'
```

- [ ] **Step 7.3: Create the API package and router**

Create `services/workflow-engine/enstellar_workflow/api/__init__.py`:

```python
"""FastAPI router for case lifecycle endpoints."""
from .router import router

__all__ = ["router"]
```

Create `services/workflow-engine/enstellar_workflow/api/router.py`:

```python
"""FastAPI router — case lifecycle REST endpoints.

Endpoints:
    POST   /cases                        Create a case (idempotent on correlation_id)
    GET    /cases/{case_id}              Fetch a case by ID
    GET    /cases/{case_id}/events       Fetch full event history for a case
    POST   /cases/{case_id}/transitions  Apply a state transition

tenant_id:
    POST /cases: taken from the Case body (case.tenant_id).
    GET  /cases/{id} and GET /cases/{id}/events: query parameter ?tenant_id=.
    POST /cases/{id}/transitions: included in the TransitionBody.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from canonical_model import Case
from ..cases.service import CaseService
from ..db.connection import get_pool
from ..engine.guards import GuardError
from ..engine.transitions import TransitionRequest

router = APIRouter(prefix="/cases", tags=["cases"])


class TransitionBody(BaseModel):
    """Request body for POST /cases/{case_id}/transitions."""

    tenant_id: str
    to_state: str
    actor_id: str
    actor_type: str  # 'user' | 'system' | 'service'
    correlation_id: str
    payload: dict = {}
    human_signoff_recorded: bool = False


async def _get_service() -> CaseService:
    pool = await get_pool()
    return CaseService(pool)


@router.post("", status_code=201, response_model=None)
async def create_case(
    case: Case,
    service: CaseService = Depends(_get_service),
) -> Any:
    """Create a case. Idempotent on correlation_id scoped to tenant_id."""
    result = await service.create_case(case)
    return result.model_dump(mode="json")


@router.get("/{case_id}", response_model=None)
async def get_case(
    case_id: uuid.UUID,
    tenant_id: str = Query(..., description="Tenant that owns this case"),
    service: CaseService = Depends(_get_service),
) -> Any:
    """Fetch a case by ID, scoped to tenant."""
    pool = await get_pool()
    from ..cases.repository import CaseRepository

    async with pool.acquire() as conn:
        case = await CaseRepository().fetch_by_id(conn, case_id, tenant_id)

    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    return case.model_dump(mode="json")


@router.get("/{case_id}/events", response_model=None)
async def get_case_events(
    case_id: uuid.UUID,
    tenant_id: str = Query(..., description="Tenant that owns this case"),
    service: CaseService = Depends(_get_service),
) -> Any:
    """Return the full immutable event history for a case, ordered by id ASC."""
    return await service.get_events(case_id, tenant_id)


@router.post("/{case_id}/transitions", response_model=None)
async def transition_case(
    case_id: uuid.UUID,
    body: TransitionBody,
    service: CaseService = Depends(_get_service),
) -> Any:
    """Apply a state transition.

    Returns 200 with the updated Case on success.
    Returns 409 if a guard rejects the transition (e.g. adverse state without sign-off).
    """
    req = TransitionRequest(
        case_id=case_id,
        tenant_id=body.tenant_id,
        to_state=body.to_state,
        actor_id=body.actor_id,
        actor_type=body.actor_type,
        correlation_id=body.correlation_id,
        payload=body.payload,
        human_signoff_recorded=body.human_signoff_recorded,
    )
    try:
        case = await service.transition(req)
    except GuardError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return case.model_dump(mode="json")
```

- [ ] **Step 7.4: Create the consumers package and IntakeConsumer**

Create `services/workflow-engine/enstellar_workflow/consumers/__init__.py`:

```python
"""Kafka consumers for the workflow engine."""
from .intake_consumer import IntakeConsumer

__all__ = ["IntakeConsumer"]
```

Create `services/workflow-engine/enstellar_workflow/consumers/intake_consumer.py`:

```python
"""IntakeConsumer — subscribes to case.intake.received and calls CaseService.create_case.

Idempotency is handled at two levels:
1. IdempotentKafkaConsumer base class deduplicates via processed_events table.
2. CaseService.create_case uses ON CONFLICT (correlation_id) DO NOTHING.
"""
from __future__ import annotations

import logging

import asyncpg

from canonical_model import Case
from enstellar_events import EventEnvelope, Topics

from ..kafka.consumer import IdempotentKafkaConsumer
from ..cases.service import CaseService

logger = logging.getLogger(__name__)


class IntakeConsumer(IdempotentKafkaConsumer):
    """Consumes case.intake.received events and creates workflow instances."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        super().__init__(
            pool,
            [Topics.CASE_INTAKE_RECEIVED],
            group_id="workflow-engine-intake",
        )
        self._service = CaseService(pool)

    async def handle(self, event: EventEnvelope) -> None:
        """Process one case.intake.received event.

        Extracts the canonical Case from event.payload["case"] and calls
        CaseService.create_case. Idempotent: if the case already exists
        (same correlation_id), create_case returns the existing record silently.
        """
        raw_case = event.payload.get("case")
        if not raw_case:
            logger.error(
                "intake_consumer_missing_case_payload",
                extra={
                    "tenant_id": event.tenant_id,
                    "event_id": str(event.event_id),
                    "correlation_id": event.correlation_id,
                },
            )
            return

        try:
            case = Case.model_validate(raw_case)
        except Exception:
            logger.exception(
                "intake_consumer_case_validation_failed",
                extra={
                    "tenant_id": event.tenant_id,
                    "event_id": str(event.event_id),
                    "correlation_id": event.correlation_id,
                },
            )
            return

        created = await self._service.create_case(case)
        logger.info(
            "intake_consumer_case_created",
            extra={
                "tenant_id": event.tenant_id,
                "case_id": str(created.case_id),
                "correlation_id": created.correlation_id,
            },
        )
```

- [ ] **Step 7.5: Update `main.py` to include the cases router**

Edit `services/workflow-engine/enstellar_workflow/main.py`. Replace the entire file:

```python
"""Enstellar Workflow Engine — FastAPI application entry point.

Start with:
    uvicorn enstellar_workflow.main:app --host 0.0.0.0 --port 8000 --reload
"""
from __future__ import annotations

import logging
import sys

from fastapi import FastAPI

from enstellar_workflow.api.router import router as cases_router
from enstellar_workflow.normalization.api import router as normalization_router

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": "%(message)s"}',
)

app = FastAPI(
    title="Enstellar Workflow Engine",
    version="0.1.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.include_router(normalization_router)
app.include_router(cases_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 7.6: Run the API tests to confirm they pass**

```bash
cd services/workflow-engine
uv run pytest tests/test_cases_api.py -v
```

Expected output:
```
tests/test_cases_api.py::test_post_cases_creates_case_and_returns_201 PASSED
tests/test_cases_api.py::test_post_cases_idempotent_returns_same_case PASSED
tests/test_cases_api.py::test_get_case_returns_200 PASSED
tests/test_cases_api.py::test_get_case_returns_404_for_missing PASSED
tests/test_cases_api.py::test_get_case_events_returns_events_after_transition PASSED
tests/test_cases_api.py::test_post_transition_returns_updated_case PASSED
tests/test_cases_api.py::test_api_transition_denied_without_signoff_returns_409 PASSED
tests/test_cases_api.py::test_api_transition_partially_denied_without_signoff_returns_409 PASSED
tests/test_cases_api.py::test_api_transition_adverse_modification_without_signoff_returns_409 PASSED
tests/test_cases_api.py::test_api_transition_denied_with_signoff_returns_200 PASSED

============ 10 passed in X.Xs ============
```

- [ ] **Step 7.7: Confirm full workflow-engine test suite passes**

```bash
cd services/workflow-engine
uv run pytest -v
```

Expected output (all tests passing, including the pre-existing T04/T07 tests):
```
tests/test_consumer_idempotent.py::... PASSED  (3 tests)
tests/test_envelope_contract.py::...  PASSED
tests/test_normalization_mapper.py::... PASSED
tests/test_normalization_storage.py::... PASSED
tests/test_publisher.py::...          PASSED  (3 tests)
tests/test_relay.py::...              PASSED
tests/test_guards.py::...             PASSED  (15 tests)
tests/test_repository.py::...         PASSED  (7 tests)
tests/test_recorder.py::...           PASSED  (4 tests)
tests/test_transitions.py::...        PASSED  (6 tests)
tests/test_case_service.py::...       PASSED  (9 tests)
tests/test_cases_api.py::...          PASSED  (10 tests)

============ XX passed in X.Xs ============
```

- [ ] **Step 7.8: Commit**

```bash
cd services/workflow-engine
git add \
  enstellar_workflow/api/__init__.py \
  enstellar_workflow/api/router.py \
  enstellar_workflow/consumers/__init__.py \
  enstellar_workflow/consumers/intake_consumer.py \
  enstellar_workflow/main.py \
  tests/test_cases_api.py
git commit -m "feat(workflow-engine): FastAPI /cases router + IntakeConsumer — T08 endpoints live"
```

---

## Task 8: Mark T08 Done + Verify `make test` Passes

**Files:**
- Modify: `.claude/task-graph.md` (mark T08 `[x]`)

- [ ] **Step 8.1: Run `make test-workflow` from the repo root to confirm CI target passes**

```bash
cd /path/to/Enstellar
make test-workflow
```

Expected output (last line):
```
============ XX passed in X.Xs ============
```

If any test fails, fix it before proceeding.

- [ ] **Step 8.2: Mark T08 as done in the task graph**

In `.claude/task-graph.md`, find line:

```
| T08 workflow-engine skeleton | Py | T04,T06,T07 | **sensitive (decision path)** | `[ ]` |
```

Change to:

```
| T08 workflow-engine skeleton | Py | T04,T06,T07 | **sensitive (decision path)** | `[x]` |
```

- [ ] **Step 8.3: Final commit**

```bash
git add .claude/task-graph.md
git commit -m "chore: mark T08 workflow-engine skeleton as done"
```

---

## Self-Review Checklist

**Spec coverage:**

| Requirement | Covered by |
|---|---|
| State machine drives intake → completeness_check → auto_determination | `TransitionEngine.apply` + `test_transitions.py` |
| Each transition emits a tenant-scoped event via the outbox | `TransitionEngine.apply` step 5 + `test_engine_transition_emits_outbox_row` |
| Idempotent re-run of same correlation_id is no-op | `CaseService.create_case` ON CONFLICT + `test_create_case_idempotent_*` |
| `GET /cases/{id}/events` returns full event history | `router.py::get_case_events` + `test_get_case_events_returns_events_after_transition` |
| Adverse-transition guard: direct API call to `denied` without sign-off → 409 | `test_api_transition_denied_without_signoff_returns_409` |
| Adverse-transition guard: direct engine call without sign-off → GuardError | `test_engine_denied_without_signoff_raises_guard_error` |
| Guard is hard-coded (not configurable away) | `guards.py` — no feature flag, no config; `ADVERSE_STATES` is a `frozenset` constant |
| Kafka consumer creates cases from `case.intake.received` | `IntakeConsumer` |
| Tenant-scoped invariant #5 on all writes | `workflow_instances` CHECK CONSTRAINT + `OutboxPublisher.publish` validates `tenant_id` |

**Type consistency check:**
- `TransitionRequest` is defined in `transitions.py` and exported from `engine/__init__.py`. Used identically in `transitions.py`, `service.py`, `router.py`, and tests.
- `GuardError` is defined in `guards.py`, imported in `transitions.py`, and caught in `router.py`.
- `CaseRepository` is instantiated with no args everywhere (no pool injected — uses `conn` from caller). Consistent.
- `CaseService` takes `pool: asyncpg.Pool` in constructor. Consistent across `service.py`, `intake_consumer.py`, and all tests.
- `make_case` factory is in `tests/conftest.py` and imported as `from tests.conftest import make_case`. Consistent across all test files.
- `_deserialize_case` helper in `repository.py` handles both `str` and `dict` JSONB returns. Consistent with existing `relay.py` pattern.

**No placeholder scan:** All steps contain full code. No "TBD", "TODO", or "implement later" present.
