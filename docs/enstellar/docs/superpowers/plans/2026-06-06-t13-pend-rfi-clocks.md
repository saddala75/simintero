# T13 — Pend/RFI + Clock/SLA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clock/SLA management and the Pend/RFI lifecycle to the workflow-engine so that entering `pend_rfi` pauses the decision clock and dispatches an RFI, receiving documentation resumes the clock and moves to `clinical_review`, and SLA breaches raise a `clock.breached` event.

**Architecture:** Clock state lives in a `clocks` DB table (UNIQUE per case+clock_type). `ClockService` start/pause/resume/check_breach/stop all write events through the outbox in the caller's transaction — same pattern as `TransitionEngine`. The decision clock starts at case creation. `CaseService.pend_rfi()` is a new orchestration method that transitions the case, pauses the clock, and dispatches the RFI in one transaction. `CaseService.transition()` is updated to stop the clock on terminal states. `RfiResponseConsumer` uses `ClockService` and `TransitionEngine` directly (not CaseService) to keep the consumer transaction boundary clean.

**Tech Stack:** Python 3.12, asyncpg, Alembic, FastAPI, Testcontainers (PostgreSQL), pytest-asyncio.

> **Sensitive task (clocks):** Changes to clock logic require senior engineer review per CLAUDE.md mandatory review classes. Do not modify `CLOCK_RULES` without reviewing UM regulation requirements (expedited=72h, standard=7 days are regulatory minimums for certain LOBs).

**Depends on:** T08 (TransitionEngine, CaseService, api/router.py, consumers/__init__.py, outbox, workflow_instances table), T04 (event bus + OutboxPublisher).

---

## Background (read before touching code)

All work is under `services/workflow-engine/` unless noted. The package is `enstellar_workflow`.

**Already exists (T08 must be complete before starting T13):**

- `enstellar_workflow/engine/transitions.py` — `TransitionRequest` (dataclass: `case_id`, `tenant_id`, `to_state`, `actor_id`, `actor_type`, `correlation_id`, `payload`, `human_signoff_recorded`), `TransitionEngine.apply(conn, req) -> Case`
- `enstellar_workflow/engine/guards.py` — `ADVERSE_STATES`, `GuardError`, `adverse_transition_guard()`
- `enstellar_workflow/cases/service.py` — `CaseService(pool)`: `create_case(case)`, `transition(req)`, `get_events(case_id, tenant_id)`
- `enstellar_workflow/api/router.py` — `_get_service()` async dependency, routes including `POST /cases/{case_id}/transitions`
- `enstellar_workflow/consumers/__init__.py` — exports `IntakeConsumer`
- `enstellar_workflow/outbox/publisher.py` — `OutboxPublisher.publish(conn, event)`
- `migrations/versions/0001_create_outbox_tables.py` — `outbox` + `processed_events` tables
- `migrations/versions/0002_create_workflow_tables.py` — `workflow_instances` + `workflow_events` tables
- `packages/event-contracts/enstellar_events/topics.py` — `Topics` class with `CLOCK_STARTED`, `CLOCK_PAUSED`, `CLOCK_RESUMED`, `CLOCK_BREACHED`, `RFI_RESPONSE_RECEIVED`
- `tests/conftest.py` — `pg_pool`, `db_dsn`, `kafka_bootstrap`, `make_case()`

**Key type import shortcuts:**

```python
from enstellar_events import Actor, ActorType, EventEnvelope, Topics
# ActorType.USER = "user", ActorType.SYSTEM = "system", ActorType.SERVICE = "service"
# Topics.CLOCK_STARTED = "clock.started"  (and CLOCK_PAUSED, CLOCK_RESUMED, CLOCK_BREACHED)
# Topics.RFI_DISPATCHED = "rfi.dispatched"  ← added in Task 2 of this plan
# Topics.RFI_RESPONSE_RECEIVED = "rfi.response.received"

from canonical_model import Case, Status, Urgency
# Status.pend_rfi, Status.clinical_review, Status.approved, etc.

from enstellar_workflow.outbox.publisher import OutboxPublisher
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from enstellar_workflow.kafka.consumer import IdempotentKafkaConsumer
```

**asyncpg patterns used in this codebase:**
- `async with pool.acquire() as conn:` → get a connection
- `async with conn.transaction():` → explicit transaction (required for outbox writes)
- `await conn.fetchrow(sql, ...)` → returns `asyncpg.Record | None`
- `await conn.fetchval(sql, ...)` → returns first column of first row
- UUID columns: asyncpg returns `uuid.UUID` natively; pass `uuid.UUID(str_val)` when inserting from a string
- JSONB columns: insert with `json.dumps(obj)`, read: asyncpg may return `dict` or `str` — always normalise with `json.loads(v) if isinstance(v, str) else v`

**Test conventions:**
- `asyncio_mode = "auto"` in `pyproject.toml` — use `@pytest.mark.asyncio` on each async test
- Run all tests: `cd services/workflow-engine && uv run pytest -v`
- Run a single file: `cd services/workflow-engine && uv run pytest tests/test_clocks.py -v`

---

## File Map

**New files:**

| File | Responsibility |
|---|---|
| `migrations/versions/0003_clocks.py` | Alembic migration: `clocks` table, deadline index, UNIQUE constraint |
| `enstellar_workflow/clocks/__init__.py` | Package marker; re-exports `ClockDefinition`, `ClockState`, `ClockService` |
| `enstellar_workflow/clocks/model.py` | `CLOCK_RULES`, `ClockDefinition`, `ClockState` (dataclasses) |
| `enstellar_workflow/clocks/service.py` | `ClockService`: start, pause, resume, check_breach, stop |
| `enstellar_workflow/rfi/__init__.py` | Package marker; re-exports `RfiRequest`, `RfiService` |
| `enstellar_workflow/rfi/service.py` | `RfiRequest` (dataclass), `RfiService.dispatch_rfi()` |
| `enstellar_workflow/consumers/rfi_response.py` | `RfiResponseConsumer(IdempotentKafkaConsumer)` |
| `tests/test_clocks.py` | Unit tests (model) + integration tests (ClockService) |
| `tests/test_rfi.py` | Integration tests for RfiService, pend_rfi, consumer, accumulated pause |

**Modified files:**

| File | Change |
|---|---|
| `packages/event-contracts/enstellar_events/topics.py` | Add `RFI_DISPATCHED = "rfi.dispatched"` to `Topics` class |
| `enstellar_workflow/cases/service.py` | Inject `ClockService`/`RfiService`; start clock in `create_case`; add `pend_rfi()`; stop clock in `transition()` on terminal states |
| `enstellar_workflow/api/router.py` | Update `_get_service()` to wire `ClockService`/`RfiService`; add `POST /cases/{case_id}/pend-rfi` endpoint |
| `enstellar_workflow/consumers/__init__.py` | Add `RfiResponseConsumer` to exports |
| `.claude/task-graph.md` | Mark T13 `[x]` |

---

## Task 1: Migration 0003 — clocks Table

**Files:**
- Create: `services/workflow-engine/migrations/versions/0003_clocks.py`
- Test: `services/workflow-engine/tests/test_clocks.py` (migration-level assertions)

- [ ] **Step 1.1: Write the failing migration test**

Create `services/workflow-engine/tests/test_clocks.py` (first test block only):

```python
"""Tests for clock/SLA logic — migration assertions, model unit tests, ClockService integration tests."""
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest

from tests.conftest import make_case


# ---------------------------------------------------------------------------
# Migration assertions (Task 1)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_clocks_table_exists(pg_pool: asyncpg.Pool):
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'clocks'"
        )
    assert row is not None, "clocks table was not created by migration 0003"


@pytest.mark.asyncio
async def test_clocks_deadline_index_exists(pg_pool: asyncpg.Pool):
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT indexname FROM pg_indexes "
            "WHERE tablename = 'clocks' AND indexname = 'ix_clocks_deadline'"
        )
    assert row is not None, "ix_clocks_deadline partial index not found"


@pytest.mark.asyncio
async def test_clocks_unique_constraint_on_case_clock_type(pg_pool: asyncpg.Pool):
    """Inserting the same (case_id, clock_type) twice must raise UniqueViolationError."""
    case_id = uuid.uuid4()
    tenant_id = "tenant-t13-mig"
    deadline = datetime.now(timezone.utc) + timedelta(days=7)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO clocks (tenant_id, case_id, clock_type, urgency, "
                "duration_calendar_days, deadline) VALUES ($1, $2, $3, $4, $5, $6)",
                tenant_id, case_id, "decision", "standard", 7, deadline,
            )
        with pytest.raises(asyncpg.UniqueViolationError):
            async with conn.transaction():
                await conn.execute(
                    "INSERT INTO clocks (tenant_id, case_id, clock_type, urgency, "
                    "duration_calendar_days, deadline) VALUES ($1, $2, $3, $4, $5, $6)",
                    tenant_id, case_id, "decision", "standard", 7, deadline,
                )
```

- [ ] **Step 1.2: Run test to confirm it fails (table not found)**

```bash
cd services/workflow-engine
uv run pytest tests/test_clocks.py::test_clocks_table_exists -v
```

Expected:
```
FAILED tests/test_clocks.py::test_clocks_table_exists - AssertionError: clocks table was not created by migration 0003
```

- [ ] **Step 1.3: Create the migration file**

Create `services/workflow-engine/migrations/versions/0003_clocks.py`:

```python
"""Create clocks table for SLA / clock management.

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clocks",
        sa.Column(
            "clock_id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("case_id", UUID(as_uuid=True), nullable=False),
        sa.Column("clock_type", sa.Text, nullable=False),
        sa.Column("state", sa.Text, nullable=False, server_default="running"),
        sa.Column("urgency", sa.Text, nullable=False),
        sa.Column("duration_calendar_days", sa.Integer, nullable=False),
        sa.Column(
            "started_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deadline", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("paused_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "total_paused_seconds",
            sa.Float,
            nullable=False,
            server_default="0",
        ),
        sa.Column("breached_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint("tenant_id != ''", name="ck_clocks_tenant_id_not_empty"),
        sa.UniqueConstraint("case_id", "clock_type", name="uq_clocks_case_clock_type"),
    )
    op.create_index(
        "ix_clocks_deadline",
        "clocks",
        ["deadline"],
        postgresql_where=sa.text("state = 'running'"),
    )


def downgrade() -> None:
    op.drop_index("ix_clocks_deadline")
    op.drop_table("clocks")
```

- [ ] **Step 1.4: Run all three migration tests**

```bash
cd services/workflow-engine
uv run pytest tests/test_clocks.py::test_clocks_table_exists \
              tests/test_clocks.py::test_clocks_deadline_index_exists \
              tests/test_clocks.py::test_clocks_unique_constraint_on_case_clock_type -v
```

Expected:
```
tests/test_clocks.py::test_clocks_table_exists PASSED
tests/test_clocks.py::test_clocks_deadline_index_exists PASSED
tests/test_clocks.py::test_clocks_unique_constraint_on_case_clock_type PASSED

============ 3 passed in X.Xs ============
```

- [ ] **Step 1.5: Commit**

```bash
cd services/workflow-engine
git add migrations/versions/0003_clocks.py tests/test_clocks.py
git commit -m "feat(workflow-engine): alembic migration 0003 — clocks table with UNIQUE(case_id, clock_type)"
```

---

## Task 2: Add `RFI_DISPATCHED` to Topics

**Files:**
- Modify: `packages/event-contracts/enstellar_events/topics.py`
- Test: `packages/event-contracts/tests/test_envelope.py` (append to existing file)

The `Topics` class already has `CLOCK_STARTED`, `CLOCK_PAUSED`, `CLOCK_RESUMED`, `CLOCK_BREACHED`, and `RFI_RESPONSE_RECEIVED`. The only missing constant for T13 is `RFI_DISPATCHED = "rfi.dispatched"`.

- [ ] **Step 2.1: Write the failing test**

Read the existing test file first:

```bash
cat packages/event-contracts/tests/test_envelope.py
```

Then append the following test to `packages/event-contracts/tests/test_envelope.py`:

```python
def test_topics_rfi_dispatched_constant():
    from enstellar_events import Topics
    assert Topics.RFI_DISPATCHED == "rfi.dispatched"


def test_topics_all_clock_constants_present():
    from enstellar_events import Topics
    assert Topics.CLOCK_STARTED == "clock.started"
    assert Topics.CLOCK_PAUSED == "clock.paused"
    assert Topics.CLOCK_RESUMED == "clock.resumed"
    assert Topics.CLOCK_BREACHED == "clock.breached"
```

- [ ] **Step 2.2: Run to confirm the `rfi_dispatched` test fails**

```bash
cd packages/event-contracts
uv run pytest tests/test_envelope.py::test_topics_rfi_dispatched_constant -v
```

Expected:
```
FAILED tests/test_envelope.py::test_topics_rfi_dispatched_constant - AttributeError: type object 'Topics' has no attribute 'RFI_DISPATCHED'
```

- [ ] **Step 2.3: Add `RFI_DISPATCHED` to the Topics class**

Edit `packages/event-contracts/enstellar_events/topics.py`. Add one line after `RFI_RESPONSE_RECEIVED`:

```python
"""Kafka topic name constants. Topics are partitioned by tenant_id."""


class Topics:
    CASE_INTAKE_RECEIVED = "case.intake.received"
    CASE_STATE_TRANSITIONED = "case.state.transitioned"
    CASE_PENDED = "case.pended"
    CASE_ASSIGNED = "case.assigned"
    CASE_CLOSED = "case.closed"

    CLOCK_STARTED = "clock.started"
    CLOCK_PAUSED = "clock.paused"
    CLOCK_RESUMED = "clock.resumed"
    CLOCK_BREACHED = "clock.breached"

    RFI_REQUESTED = "rfi.requested"
    RFI_DISPATCHED = "rfi.dispatched"
    RFI_RESPONSE_RECEIVED = "rfi.response.received"
    NOTIFICATION_SENT = "notification.sent"

    DECISION_RECORDED = "decision.recorded"

    CASE_NORMALIZED = "case.normalized"

    AGENT_ASSIST_PRODUCED = "agent.assist.produced"
```

- [ ] **Step 2.4: Run both new tests**

```bash
cd packages/event-contracts
uv run pytest tests/test_envelope.py::test_topics_rfi_dispatched_constant \
              tests/test_envelope.py::test_topics_all_clock_constants_present -v
```

Expected:
```
tests/test_envelope.py::test_topics_rfi_dispatched_constant PASSED
tests/test_envelope.py::test_topics_all_clock_constants_present PASSED

============ 2 passed in X.Xs ============
```

- [ ] **Step 2.5: Commit**

```bash
cd packages/event-contracts
git add enstellar_events/topics.py tests/test_envelope.py
git commit -m "feat(event-contracts): add Topics.RFI_DISPATCHED = 'rfi.dispatched'"
```

---

## Task 3: ClockDefinition + ClockState Models

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/clocks/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/clocks/model.py`
- Test: append to `services/workflow-engine/tests/test_clocks.py`

- [ ] **Step 3.1: Write the failing model tests**

Append the following to `services/workflow-engine/tests/test_clocks.py` (after the migration tests):

```python
# ---------------------------------------------------------------------------
# ClockDefinition + ClockState model tests (Task 3) — no DB, pure unit tests
# ---------------------------------------------------------------------------


def test_for_case_expedited_decision_returns_3_days():
    from enstellar_workflow.clocks.model import ClockDefinition
    defn = ClockDefinition.for_case("expedited", "decision")
    assert defn.duration_calendar_days == 3
    assert defn.clock_type == "decision"
    assert defn.urgency == "expedited"


def test_for_case_standard_decision_returns_7_days():
    from enstellar_workflow.clocks.model import ClockDefinition
    defn = ClockDefinition.for_case("standard", "decision")
    assert defn.duration_calendar_days == 7


def test_for_case_concurrent_decision_returns_1_day():
    from enstellar_workflow.clocks.model import ClockDefinition
    defn = ClockDefinition.for_case("concurrent", "decision")
    assert defn.duration_calendar_days == 1


def test_for_case_unknown_urgency_raises_value_error():
    from enstellar_workflow.clocks.model import ClockDefinition
    with pytest.raises(ValueError, match="No clock rule"):
        ClockDefinition.for_case("unknown_urgency", "decision")


def test_for_case_unknown_clock_type_raises_value_error():
    from enstellar_workflow.clocks.model import ClockDefinition
    with pytest.raises(ValueError, match="No clock rule"):
        ClockDefinition.for_case("standard", "nonexistent_clock")


def test_adjusted_deadline_no_pause():
    """Running clock with zero accumulated pause: adjusted_deadline == deadline."""
    from enstellar_workflow.clocks.model import ClockState
    now = datetime.now(timezone.utc)
    deadline = now + timedelta(days=7)
    state = ClockState(
        clock_id=str(uuid.uuid4()),
        tenant_id="t1",
        case_id=str(uuid.uuid4()),
        clock_type="decision",
        state="running",
        deadline=deadline,
        paused_at=None,
        total_paused_seconds=0.0,
        breached_at=None,
    )
    assert state.adjusted_deadline == deadline


def test_adjusted_deadline_with_accumulated_paused_seconds():
    """3600 accumulated seconds extends deadline by exactly 1 hour."""
    from enstellar_workflow.clocks.model import ClockState
    now = datetime.now(timezone.utc)
    deadline = now + timedelta(days=7)
    state = ClockState(
        clock_id=str(uuid.uuid4()),
        tenant_id="t1",
        case_id=str(uuid.uuid4()),
        clock_type="decision",
        state="running",
        deadline=deadline,
        paused_at=None,
        total_paused_seconds=3600.0,
        breached_at=None,
    )
    expected = deadline + timedelta(seconds=3600)
    assert state.adjusted_deadline == expected


def test_adjusted_deadline_currently_paused_adds_current_pause_time():
    """A currently-paused clock includes the in-progress pause in adjusted_deadline."""
    from enstellar_workflow.clocks.model import ClockState
    now = datetime.now(timezone.utc)
    deadline = now + timedelta(days=7)
    paused_2min_ago = now - timedelta(minutes=2)
    state = ClockState(
        clock_id=str(uuid.uuid4()),
        tenant_id="t1",
        case_id=str(uuid.uuid4()),
        clock_type="decision",
        state="paused",
        deadline=deadline,
        paused_at=paused_2min_ago,
        total_paused_seconds=0.0,
        breached_at=None,
    )
    delta = state.adjusted_deadline - deadline
    # Pause started 2 minutes ago, so delta should be ~2 minutes (with 10s tolerance)
    assert timedelta(minutes=1, seconds=50) < delta < timedelta(minutes=2, seconds=10)


def test_adjusted_deadline_combined_accumulated_and_current_pause():
    """Both accumulated (3600s) and current pause contribute to adjusted_deadline."""
    from enstellar_workflow.clocks.model import ClockState
    now = datetime.now(timezone.utc)
    deadline = now + timedelta(days=7)
    paused_1min_ago = now - timedelta(minutes=1)
    state = ClockState(
        clock_id=str(uuid.uuid4()),
        tenant_id="t1",
        case_id=str(uuid.uuid4()),
        clock_type="decision",
        state="paused",
        deadline=deadline,
        paused_at=paused_1min_ago,
        total_paused_seconds=3600.0,  # 1 hour already accumulated
        breached_at=None,
    )
    delta = state.adjusted_deadline - deadline
    # At least 3600s (accumulated) + ~60s (current pause)
    assert delta >= timedelta(seconds=3600 + 50)
```

- [ ] **Step 3.2: Run to confirm failure**

```bash
cd services/workflow-engine
uv run pytest tests/test_clocks.py -k "for_case or adjusted_deadline" -v
```

Expected:
```
ERROR — ModuleNotFoundError: No module named 'enstellar_workflow.clocks'
```

- [ ] **Step 3.3: Create the clocks package and model**

Create `services/workflow-engine/enstellar_workflow/clocks/__init__.py`:

```python
"""Clock/SLA sub-package."""
from .model import CLOCK_RULES, ClockDefinition, ClockState
from .service import ClockService

__all__ = ["CLOCK_RULES", "ClockDefinition", "ClockState", "ClockService"]
```

Create `services/workflow-engine/enstellar_workflow/clocks/model.py`:

```python
"""Clock dataclasses and CLOCK_RULES.

CLOCK_RULES encodes UM regulatory minimums:
  - expedited = 72 h = 3 calendar days  (URAC, NCQA, many state regs)
  - standard   = 7 calendar days
  - concurrent = 1 calendar day (concurrent / retrospective review)

DO NOT modify CLOCK_RULES without consulting regulatory requirements for each
line-of-business. These are minimums; specific LOBs or states may be stricter.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

# (urgency, clock_type) -> calendar_days
CLOCK_RULES: dict[tuple[str, str], int] = {
    ("expedited", "decision"): 3,
    ("standard", "decision"): 7,
    ("concurrent", "decision"): 1,
}


@dataclass
class ClockDefinition:
    clock_type: str
    urgency: str
    duration_calendar_days: int

    @classmethod
    def for_case(cls, urgency: str, clock_type: str = "decision") -> "ClockDefinition":
        """Lookup the regulatory duration for (urgency, clock_type).

        Raises ValueError if the combination is not in CLOCK_RULES.
        """
        days = CLOCK_RULES.get((urgency, clock_type))
        if days is None:
            raise ValueError(
                f"No clock rule for urgency={urgency!r}, clock_type={clock_type!r}. "
                f"Available: {list(CLOCK_RULES.keys())}"
            )
        return cls(clock_type=clock_type, urgency=urgency, duration_calendar_days=days)


@dataclass
class ClockState:
    clock_id: str
    tenant_id: str
    case_id: str
    clock_type: str
    state: Literal["running", "paused", "breached", "stopped"]
    deadline: datetime
    paused_at: datetime | None
    total_paused_seconds: float
    breached_at: datetime | None

    @property
    def adjusted_deadline(self) -> datetime:
        """Deadline extended by all pause time (accumulated + any current pause).

        If the clock is currently paused, the in-progress pause duration is
        included so callers can compute the correct effective deadline.
        """
        offset = timedelta(seconds=self.total_paused_seconds)
        if self.paused_at is not None:
            offset += datetime.now(timezone.utc) - self.paused_at
        return self.deadline + offset
```

- [ ] **Step 3.4: Run model tests**

```bash
cd services/workflow-engine
uv run pytest tests/test_clocks.py -k "for_case or adjusted_deadline" -v
```

Expected:
```
tests/test_clocks.py::test_for_case_expedited_decision_returns_3_days PASSED
tests/test_clocks.py::test_for_case_standard_decision_returns_7_days PASSED
tests/test_clocks.py::test_for_case_concurrent_decision_returns_1_day PASSED
tests/test_clocks.py::test_for_case_unknown_urgency_raises_value_error PASSED
tests/test_clocks.py::test_for_case_unknown_clock_type_raises_value_error PASSED
tests/test_clocks.py::test_adjusted_deadline_no_pause PASSED
tests/test_clocks.py::test_adjusted_deadline_with_accumulated_paused_seconds PASSED
tests/test_clocks.py::test_adjusted_deadline_currently_paused_adds_current_pause_time PASSED
tests/test_clocks.py::test_adjusted_deadline_combined_accumulated_and_current_pause PASSED

============ 9 passed in X.Xs ============
```

- [ ] **Step 3.5: Commit**

```bash
cd services/workflow-engine
git add \
  enstellar_workflow/clocks/__init__.py \
  enstellar_workflow/clocks/model.py \
  tests/test_clocks.py
git commit -m "feat(workflow-engine): ClockDefinition + ClockState models with CLOCK_RULES"
```

---

## Task 4: ClockService — start + pause + resume

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/clocks/service.py`
- Test: append to `services/workflow-engine/tests/test_clocks.py`

- [ ] **Step 4.1: Write the failing integration tests**

Append the following to `services/workflow-engine/tests/test_clocks.py`:

```python
# ---------------------------------------------------------------------------
# ClockService integration tests (Tasks 4 and 5) — require PostgreSQL
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_clock_start_creates_running_row(pg_pool: asyncpg.Pool):
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-clk-t13"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("standard", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            state = await service.start(conn, tenant_id, case_id, defn, actor)

    assert state.state == "running"
    assert state.tenant_id == tenant_id
    assert state.case_id == case_id
    assert state.clock_type == "decision"
    assert state.paused_at is None
    assert state.total_paused_seconds == 0.0
    # deadline ≈ now + 7 days (within 10-second window)
    expected = datetime.now(timezone.utc) + timedelta(days=7)
    assert abs((state.deadline - expected).total_seconds()) < 10


@pytest.mark.asyncio
async def test_clock_start_publishes_clock_started_event(pg_pool: asyncpg.Pool):
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-clk-evt-start"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("expedited", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.start(conn, tenant_id, case_id, defn, actor)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT type FROM outbox WHERE case_id = $1 AND type = 'clock.started'",
            uuid.UUID(case_id),
        )
    assert row is not None


@pytest.mark.asyncio
async def test_clock_start_idempotent_on_conflict(pg_pool: asyncpg.Pool):
    """Starting a clock that already exists returns the existing ClockState unchanged."""
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-clk-idem"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("standard", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            state1 = await service.start(conn, tenant_id, case_id, defn, actor)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            state2 = await service.start(conn, tenant_id, case_id, defn, actor)

    assert state1.clock_id == state2.clock_id


@pytest.mark.asyncio
async def test_clock_pause_changes_state_to_paused(pg_pool: asyncpg.Pool):
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-clk-pause"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("standard", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.start(conn, tenant_id, case_id, defn, actor)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            paused = await service.pause(conn, tenant_id, case_id, "decision", actor)

    assert paused.state == "paused"
    assert paused.paused_at is not None


@pytest.mark.asyncio
async def test_clock_pause_publishes_clock_paused_event(pg_pool: asyncpg.Pool):
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-clk-pause-evt"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("standard", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.start(conn, tenant_id, case_id, defn, actor)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.pause(conn, tenant_id, case_id, "decision", actor)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT type FROM outbox WHERE case_id = $1 AND type = 'clock.paused'",
            uuid.UUID(case_id),
        )
    assert row is not None


@pytest.mark.asyncio
async def test_clock_pause_nonexistent_clock_raises_value_error(pg_pool: asyncpg.Pool):
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    actor = Actor(id="system", type=ActorType.SYSTEM)

    with pytest.raises(ValueError, match="No running clock"):
        async with pg_pool.acquire() as conn:
            async with conn.transaction():
                await service.pause(conn, "tenant-t13", str(uuid.uuid4()), "decision", actor)


@pytest.mark.asyncio
async def test_clock_resume_clears_paused_at_and_returns_running(pg_pool: asyncpg.Pool):
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-clk-resume"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("standard", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.start(conn, tenant_id, case_id, defn, actor)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.pause(conn, tenant_id, case_id, "decision", actor)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            resumed = await service.resume(conn, tenant_id, case_id, "decision", actor)

    assert resumed.state == "running"
    assert resumed.paused_at is None
    assert resumed.total_paused_seconds >= 0.0


@pytest.mark.asyncio
async def test_clock_resume_publishes_clock_resumed_event(pg_pool: asyncpg.Pool):
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-clk-resume-evt"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("standard", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.start(conn, tenant_id, case_id, defn, actor)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.pause(conn, tenant_id, case_id, "decision", actor)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.resume(conn, tenant_id, case_id, "decision", actor)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT type FROM outbox WHERE case_id = $1 AND type = 'clock.resumed'",
            uuid.UUID(case_id),
        )
    assert row is not None


@pytest.mark.asyncio
async def test_clock_resume_nonexistent_paused_clock_raises(pg_pool: asyncpg.Pool):
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    actor = Actor(id="system", type=ActorType.SYSTEM)

    with pytest.raises(ValueError, match="No paused clock"):
        async with pg_pool.acquire() as conn:
            async with conn.transaction():
                await service.resume(conn, "tenant-t13", str(uuid.uuid4()), "decision", actor)
```

- [ ] **Step 4.2: Run to confirm failure**

```bash
cd services/workflow-engine
uv run pytest tests/test_clocks.py -k "clock_start or clock_pause or clock_resume" -v
```

Expected:
```
ERROR — ModuleNotFoundError: No module named 'enstellar_workflow.clocks.service'
```

- [ ] **Step 4.3: Create ClockService with start + pause + resume**

Create `services/workflow-engine/enstellar_workflow/clocks/service.py`:

```python
"""ClockService — start, pause, resume, check_breach, stop the decision clock.

All methods operate inside the caller's transaction. Every state change
publishes an event to the outbox in the same transaction — same pattern as
TransitionEngine. The caller owns the transaction boundary.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg

from enstellar_events import Actor, ActorType, EventEnvelope, Topics
from enstellar_workflow.outbox.publisher import OutboxPublisher

from .model import ClockDefinition, ClockState


class ClockService:
    def __init__(self, publisher: OutboxPublisher) -> None:
        self._pub = publisher

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(
        self,
        conn: asyncpg.Connection,
        tenant_id: str,
        case_id: str,
        defn: ClockDefinition,
        actor: Actor,
    ) -> ClockState:
        """Start a decision clock. Idempotent: if a clock already exists for
        (case_id, clock_type), returns the existing ClockState without writing
        a duplicate outbox event."""
        deadline = datetime.now(timezone.utc) + timedelta(days=defn.duration_calendar_days)
        row = await conn.fetchrow(
            """
            INSERT INTO clocks
              (tenant_id, case_id, clock_type, urgency, duration_calendar_days, deadline)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (case_id, clock_type) DO NOTHING
            RETURNING *
            """,
            tenant_id,
            uuid.UUID(case_id),
            defn.clock_type,
            defn.urgency,
            defn.duration_calendar_days,
            deadline,
        )
        if row is None:
            # Clock already existed — return current state without a new event
            row = await conn.fetchrow(
                "SELECT * FROM clocks WHERE case_id = $1 AND clock_type = $2",
                uuid.UUID(case_id),
                defn.clock_type,
            )
        else:
            state = _row_to_state(row)
            await self._pub.publish(
                conn,
                _make_event(Topics.CLOCK_STARTED, tenant_id, case_id, state, actor),
            )
        return _row_to_state(row)  # type: ignore[arg-type]

    async def pause(
        self,
        conn: asyncpg.Connection,
        tenant_id: str,
        case_id: str,
        clock_type: str,
        actor: Actor,
    ) -> ClockState:
        """Pause a running clock. Raises ValueError if no running clock exists."""
        row = await conn.fetchrow(
            """
            UPDATE clocks
            SET state = 'paused', paused_at = now()
            WHERE case_id = $1 AND clock_type = $2 AND state = 'running' AND tenant_id = $3
            RETURNING *
            """,
            uuid.UUID(case_id),
            clock_type,
            tenant_id,
        )
        if row is None:
            raise ValueError(
                f"No running clock for case_id={case_id!r}, clock_type={clock_type!r}"
            )
        state = _row_to_state(row)
        await self._pub.publish(
            conn,
            _make_event(Topics.CLOCK_PAUSED, tenant_id, case_id, state, actor),
        )
        return state

    async def resume(
        self,
        conn: asyncpg.Connection,
        tenant_id: str,
        case_id: str,
        clock_type: str,
        actor: Actor,
    ) -> ClockState:
        """Resume a paused clock. Accumulates elapsed pause time into
        total_paused_seconds. Raises ValueError if no paused clock exists."""
        row = await conn.fetchrow(
            """
            UPDATE clocks
            SET state = 'running',
                total_paused_seconds = total_paused_seconds
                    + EXTRACT(EPOCH FROM (now() - paused_at)),
                paused_at = NULL
            WHERE case_id = $1 AND clock_type = $2 AND state = 'paused' AND tenant_id = $3
            RETURNING *
            """,
            uuid.UUID(case_id),
            clock_type,
            tenant_id,
        )
        if row is None:
            raise ValueError(
                f"No paused clock for case_id={case_id!r}, clock_type={clock_type!r}"
            )
        state = _row_to_state(row)
        await self._pub.publish(
            conn,
            _make_event(Topics.CLOCK_RESUMED, tenant_id, case_id, state, actor),
        )
        return state

    async def check_breach(
        self,
        conn: asyncpg.Connection,
        tenant_id: str,
        case_id: str,
        clock_type: str,
        actor: Actor,
    ) -> ClockState | None:
        """Mark a running clock as breached if deadline <= now().

        Returns the breached ClockState (and publishes clock.breached) if
        the clock has passed its deadline, otherwise returns None.
        """
        row = await conn.fetchrow(
            """
            UPDATE clocks
            SET state = 'breached', breached_at = now()
            WHERE case_id = $1 AND clock_type = $2
              AND state = 'running'
              AND deadline <= now()
              AND tenant_id = $3
            RETURNING *
            """,
            uuid.UUID(case_id),
            clock_type,
            tenant_id,
        )
        if row is None:
            return None
        state = _row_to_state(row)
        await self._pub.publish(
            conn,
            _make_event(Topics.CLOCK_BREACHED, tenant_id, case_id, state, actor),
        )
        return state

    async def stop(
        self,
        conn: asyncpg.Connection,
        tenant_id: str,
        case_id: str,
        clock_type: str,
    ) -> None:
        """Stop a running or paused clock (terminal case outcome). No event published."""
        await conn.execute(
            """
            UPDATE clocks SET state = 'stopped'
            WHERE case_id = $1 AND clock_type = $2
              AND state IN ('running', 'paused')
              AND tenant_id = $3
            """,
            uuid.UUID(case_id),
            clock_type,
            tenant_id,
        )


# ------------------------------------------------------------------
# Private helpers
# ------------------------------------------------------------------


def _row_to_state(row: Any) -> ClockState:
    """Convert an asyncpg Record from the clocks table to a ClockState."""
    return ClockState(
        clock_id=str(row["clock_id"]),
        tenant_id=row["tenant_id"],
        case_id=str(row["case_id"]),
        clock_type=row["clock_type"],
        state=row["state"],
        deadline=row["deadline"],
        paused_at=row["paused_at"],
        total_paused_seconds=float(row["total_paused_seconds"]),
        breached_at=row["breached_at"],
    )


def _make_event(
    event_type: str,
    tenant_id: str,
    case_id: str,
    state: ClockState,
    actor: Actor,
) -> EventEnvelope:
    """Build a clock EventEnvelope for the outbox."""
    return EventEnvelope(
        event_id=uuid.uuid4(),
        tenant_id=tenant_id,
        case_id=uuid.UUID(case_id),
        correlation_id=str(uuid.uuid4()),
        type=event_type,
        occurred_at=datetime.now(timezone.utc),
        actor=actor,
        payload={
            "clock_id": state.clock_id,
            "clock_type": state.clock_type,
            "state": state.state,
            "urgency": state.clock_type,
            "deadline": state.deadline.isoformat(),
            "total_paused_seconds": state.total_paused_seconds,
        },
        schema_version="1.0.0",
    )
```

- [ ] **Step 4.4: Run start + pause + resume tests**

```bash
cd services/workflow-engine
uv run pytest tests/test_clocks.py -k "clock_start or clock_pause or clock_resume" -v
```

Expected:
```
tests/test_clocks.py::test_clock_start_creates_running_row PASSED
tests/test_clocks.py::test_clock_start_publishes_clock_started_event PASSED
tests/test_clocks.py::test_clock_start_idempotent_on_conflict PASSED
tests/test_clocks.py::test_clock_pause_changes_state_to_paused PASSED
tests/test_clocks.py::test_clock_pause_publishes_clock_paused_event PASSED
tests/test_clocks.py::test_clock_pause_nonexistent_clock_raises_value_error PASSED
tests/test_clocks.py::test_clock_resume_clears_paused_at_and_returns_running PASSED
tests/test_clocks.py::test_clock_resume_publishes_clock_resumed_event PASSED
tests/test_clocks.py::test_clock_resume_nonexistent_paused_clock_raises PASSED

============ 9 passed in X.Xs ============
```

- [ ] **Step 4.5: Commit**

```bash
cd services/workflow-engine
git add \
  enstellar_workflow/clocks/service.py \
  enstellar_workflow/clocks/__init__.py \
  tests/test_clocks.py
git commit -m "feat(workflow-engine): ClockService start/pause/resume with outbox events"
```

---

## Task 5: ClockService — check_breach + stop

**Files:**
- `enstellar_workflow/clocks/service.py` is already complete from Task 4 (both methods were included)
- Test: append to `services/workflow-engine/tests/test_clocks.py`

- [ ] **Step 5.1: Write the failing breach + stop tests**

Append to `services/workflow-engine/tests/test_clocks.py`:

```python
@pytest.mark.asyncio
async def test_check_breach_marks_clock_breached_when_past_deadline(pg_pool: asyncpg.Pool):
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-breach"
    case_id = str(uuid.uuid4())
    actor = Actor(id="system", type=ActorType.SYSTEM)

    # Insert a clock directly with a past deadline (simulates SLA exceeded)
    past_deadline = datetime.now(timezone.utc) - timedelta(hours=1)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO clocks (tenant_id, case_id, clock_type, urgency, "
                "duration_calendar_days, deadline, state) "
                "VALUES ($1, $2, $3, $4, $5, $6, 'running')",
                tenant_id,
                uuid.UUID(case_id),
                "decision",
                "standard",
                7,
                past_deadline,
            )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            breached = await service.check_breach(conn, tenant_id, case_id, "decision", actor)

    assert breached is not None
    assert breached.state == "breached"
    assert breached.breached_at is not None


@pytest.mark.asyncio
async def test_check_breach_returns_none_when_deadline_not_passed(pg_pool: asyncpg.Pool):
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-no-breach"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("standard", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.start(conn, tenant_id, case_id, defn, actor)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            result = await service.check_breach(conn, tenant_id, case_id, "decision", actor)

    assert result is None


@pytest.mark.asyncio
async def test_check_breach_publishes_clock_breached_event(pg_pool: asyncpg.Pool):
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-breach-evt"
    case_id = str(uuid.uuid4())
    actor = Actor(id="system", type=ActorType.SYSTEM)

    past_deadline = datetime.now(timezone.utc) - timedelta(hours=2)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO clocks (tenant_id, case_id, clock_type, urgency, "
                "duration_calendar_days, deadline, state) "
                "VALUES ($1, $2, $3, $4, $5, $6, 'running')",
                tenant_id,
                uuid.UUID(case_id),
                "decision",
                "standard",
                7,
                past_deadline,
            )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.check_breach(conn, tenant_id, case_id, "decision", actor)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT type FROM outbox WHERE case_id = $1 AND type = 'clock.breached'",
            uuid.UUID(case_id),
        )
    assert row is not None


@pytest.mark.asyncio
async def test_stop_sets_state_to_stopped(pg_pool: asyncpg.Pool):
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-stop"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("standard", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.start(conn, tenant_id, case_id, defn, actor)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.stop(conn, tenant_id, case_id, "decision")

    async with pg_pool.acquire() as conn:
        state = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id = $1 AND clock_type = 'decision'",
            uuid.UUID(case_id),
        )
    assert state == "stopped"


@pytest.mark.asyncio
async def test_stop_also_stops_paused_clock(pg_pool: asyncpg.Pool):
    """stop() should also stop a clock that is currently paused."""
    from enstellar_events import Actor, ActorType
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-stop-paused"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("standard", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.start(conn, tenant_id, case_id, defn, actor)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.pause(conn, tenant_id, case_id, "decision", actor)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.stop(conn, tenant_id, case_id, "decision")

    async with pg_pool.acquire() as conn:
        state = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id = $1 AND clock_type = 'decision'",
            uuid.UUID(case_id),
        )
    assert state == "stopped"
```

- [ ] **Step 5.2: Run breach + stop tests**

```bash
cd services/workflow-engine
uv run pytest tests/test_clocks.py -k "breach or stop" -v
```

Expected:
```
tests/test_clocks.py::test_check_breach_marks_clock_breached_when_past_deadline PASSED
tests/test_clocks.py::test_check_breach_returns_none_when_deadline_not_passed PASSED
tests/test_clocks.py::test_check_breach_publishes_clock_breached_event PASSED
tests/test_clocks.py::test_stop_sets_state_to_stopped PASSED
tests/test_clocks.py::test_stop_also_stops_paused_clock PASSED

============ 5 passed in X.Xs ============
```

- [ ] **Step 5.3: Run the full test_clocks.py to confirm all tests pass**

```bash
cd services/workflow-engine
uv run pytest tests/test_clocks.py -v
```

Expected: all tests (migration, model, ClockService) pass.

- [ ] **Step 5.4: Commit**

```bash
cd services/workflow-engine
git add tests/test_clocks.py
git commit -m "feat(workflow-engine): ClockService check_breach + stop — SLA breach detection"
```

---

## Task 6: RfiService + CaseService.pend_rfi() + FastAPI Endpoint

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/rfi/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/rfi/service.py`
- Modify: `services/workflow-engine/enstellar_workflow/cases/service.py`
- Modify: `services/workflow-engine/enstellar_workflow/api/router.py`
- Create: `services/workflow-engine/tests/test_rfi.py`

- [ ] **Step 6.1: Write the failing tests**

Create `services/workflow-engine/tests/test_rfi.py`:

```python
"""Integration tests for RfiService, CaseService.pend_rfi(), and the pend-rfi endpoint."""
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_events import Actor, ActorType
from tests.conftest import make_case


# ---------------------------------------------------------------------------
# RfiService unit + integration tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_rfi_publishes_rfi_dispatched_event(pg_pool: asyncpg.Pool):
    import json
    from enstellar_workflow.rfi.service import RfiRequest, RfiService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = RfiService(publisher)
    tenant_id = "tenant-rfi-t13"
    case_id = str(uuid.uuid4())
    actor = Actor(id="reviewer-001", type=ActorType.USER)
    req = RfiRequest(
        tenant_id=tenant_id,
        case_id=case_id,
        required_documents=["clinical_notes", "lab_results"],
        due_date_days=14,
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.dispatch_rfi(conn, req, actor)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT type, payload FROM outbox "
            "WHERE case_id = $1 AND type = 'rfi.dispatched'",
            uuid.UUID(case_id),
        )
    assert row is not None
    payload = json.loads(row["payload"]) if isinstance(row["payload"], str) else row["payload"]
    assert payload["required_documents"] == ["clinical_notes", "lab_results"]
    assert payload["due_date_days"] == 14


@pytest.mark.asyncio
async def test_dispatch_rfi_rejects_blank_tenant_id(pg_pool: asyncpg.Pool):
    from enstellar_workflow.rfi.service import RfiRequest, RfiService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = RfiService(publisher)
    actor = Actor(id="system", type=ActorType.SYSTEM)
    req = RfiRequest(
        tenant_id="",
        case_id=str(uuid.uuid4()),
        required_documents=[],
        due_date_days=7,
    )
    with pytest.raises(ValueError, match="tenant_id required"):
        async with pg_pool.acquire() as conn:
            async with conn.transaction():
                await service.dispatch_rfi(conn, req, actor)


# ---------------------------------------------------------------------------
# CaseService.pend_rfi() integration test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pend_rfi_transitions_case_pauses_clock_dispatches_rfi(pg_pool: asyncpg.Pool):
    """pend_rfi() does three things in ONE transaction:
    1. Transitions the case to pend_rfi
    2. Pauses the decision clock
    3. Publishes an rfi.dispatched outbox event
    """
    import json
    from canonical_model import Status
    from enstellar_workflow.cases.repository import CaseRepository
    from enstellar_workflow.cases.service import CaseService
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from enstellar_workflow.rfi.service import RfiService

    publisher = OutboxPublisher()
    clock_service = ClockService(publisher)
    rfi_service = RfiService(publisher)
    case_service = CaseService(pg_pool, clock_service=clock_service, rfi_service=rfi_service)

    case = make_case(tenant_id="tenant-prfi-t13")
    created = await case_service.create_case(case)

    await case_service.pend_rfi(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        required_documents=["clinical_notes"],
        due_date_days=14,
        actor=Actor(id="reviewer-001", type=ActorType.USER),
        correlation_id=created.correlation_id,
    )

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        updated = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)
    assert updated.status == Status.pend_rfi, f"Expected pend_rfi, got {updated.status}"

    async with pg_pool.acquire() as conn:
        clock_row = await conn.fetchrow(
            "SELECT state FROM clocks WHERE case_id = $1 AND clock_type = 'decision'",
            created.case_id,
        )
    assert clock_row is not None, "Clock row not found — was start() called in create_case?"
    assert clock_row["state"] == "paused"

    async with pg_pool.acquire() as conn:
        rfi_row = await conn.fetchrow(
            "SELECT type FROM outbox WHERE case_id = $1 AND type = 'rfi.dispatched'",
            created.case_id,
        )
    assert rfi_row is not None


@pytest.mark.asyncio
async def test_transition_to_terminal_state_stops_clock(pg_pool: asyncpg.Pool):
    """Transitioning to 'approved' via CaseService.transition() stops the clock."""
    from enstellar_workflow.cases.service import CaseService
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.engine.transitions import TransitionRequest
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    clock_service = ClockService(publisher)
    case_service = CaseService(pg_pool, clock_service=clock_service)

    case = make_case(tenant_id="tenant-terminal-t13")
    created = await case_service.create_case(case)

    await case_service.transition(TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="approved",
        actor_id="reviewer-001",
        actor_type="user",
        correlation_id=created.correlation_id,
        human_signoff_recorded=False,  # approved is not adverse
    ))

    async with pg_pool.acquire() as conn:
        state = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id = $1 AND clock_type = 'decision'",
            created.case_id,
        )
    assert state == "stopped"


# ---------------------------------------------------------------------------
# FastAPI endpoint test
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def ac_with_clocks(db_dsn: str, monkeypatch) -> AsyncClient:
    """AsyncClient wired to the Testcontainers PostgreSQL with ClockService + RfiService."""
    monkeypatch.setenv(
        "WORKFLOW_DB_URL",
        db_dsn.replace("postgresql://", "postgresql+asyncpg://"),
    )
    import enstellar_workflow.config as cfg_mod
    import enstellar_workflow.db.connection as conn_mod

    cfg_mod._settings = None
    conn_mod._pool = None

    from enstellar_workflow.main import app
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client

    from enstellar_workflow.db.connection import close_pool
    await close_pool()
    conn_mod._pool = None


@pytest.mark.asyncio
async def test_post_pend_rfi_returns_pend_rfi_status(ac_with_clocks: AsyncClient):
    case = make_case()
    create_resp = await ac_with_clocks.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert create_resp.status_code == 201

    resp = await ac_with_clocks.post(
        f"/cases/{case.case_id}/pend-rfi",
        json={
            "tenant_id": case.tenant_id,
            "required_documents": ["clinical_notes", "lab_results"],
            "due_date_days": 14,
            "actor_id": "reviewer-001",
            "actor_type": "user",
            "correlation_id": case.correlation_id,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "pend_rfi"


@pytest.mark.asyncio
async def test_post_pend_rfi_unknown_case_returns_404(ac_with_clocks: AsyncClient):
    resp = await ac_with_clocks.post(
        f"/cases/{uuid.uuid4()}/pend-rfi",
        json={
            "tenant_id": "tenant-t13",
            "required_documents": [],
            "due_date_days": 14,
            "actor_id": "system",
            "actor_type": "system",
            "correlation_id": "corr-missing",
        },
    )
    assert resp.status_code == 404
```

- [ ] **Step 6.2: Run to confirm failure**

```bash
cd services/workflow-engine
uv run pytest tests/test_rfi.py -v
```

Expected:
```
ERROR tests/test_rfi.py - ModuleNotFoundError: No module named 'enstellar_workflow.rfi'
```

- [ ] **Step 6.3: Create the rfi package**

Create `services/workflow-engine/enstellar_workflow/rfi/__init__.py`:

```python
"""RFI sub-package."""
from .service import RfiRequest, RfiService

__all__ = ["RfiRequest", "RfiService"]
```

Create `services/workflow-engine/enstellar_workflow/rfi/service.py`:

```python
"""RfiService — dispatches an RFI to the outbox.

dispatch_rfi() publishes an rfi.dispatched event inside the caller's transaction.
The caller (CaseService.pend_rfi) owns the transaction boundary.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncpg

from enstellar_events import Actor, EventEnvelope, Topics
from enstellar_workflow.outbox.publisher import OutboxPublisher


@dataclass
class RfiRequest:
    tenant_id: str
    case_id: str
    required_documents: list[str]
    due_date_days: int


class RfiService:
    def __init__(self, publisher: OutboxPublisher) -> None:
        self._pub = publisher

    async def dispatch_rfi(
        self,
        conn: asyncpg.Connection,
        req: RfiRequest,
        actor: Actor,
    ) -> None:
        """Publish an rfi.dispatched outbox event inside the caller's transaction.

        Raises ValueError if tenant_id is blank — invariant #5.
        """
        if not req.tenant_id or not req.tenant_id.strip():
            raise ValueError("tenant_id required — invariant #5")

        event = EventEnvelope(
            event_id=uuid.uuid4(),
            tenant_id=req.tenant_id,
            case_id=uuid.UUID(req.case_id),
            correlation_id=str(uuid.uuid4()),
            type=Topics.RFI_DISPATCHED,
            occurred_at=datetime.now(timezone.utc),
            actor=actor,
            payload={
                "required_documents": req.required_documents,
                "due_date_days": req.due_date_days,
            },
            schema_version="1.0.0",
        )
        await self._pub.publish(conn, event)
```

- [ ] **Step 6.4: Update CaseService to wire ClockService + RfiService**

Edit `services/workflow-engine/enstellar_workflow/cases/service.py`. Apply the following changes:

**a) Add imports at the top (after existing imports):**

```python
from enstellar_events import Actor, ActorType, EventEnvelope, Topics

# Add after existing imports:
from ..clocks.model import ClockDefinition
from ..clocks.service import ClockService
from ..rfi.service import RfiRequest, RfiService
```

**b) Replace the `CaseService.__init__` signature:**

```python
class CaseService:
    _TERMINAL_STATES: frozenset[str] = frozenset({
        "approved",
        "denied",
        "partially_denied",
        "adverse_modification",
        "closed",
        "withdrawn",
    })

    def __init__(
        self,
        pool: asyncpg.Pool,
        clock_service: ClockService | None = None,
        rfi_service: RfiService | None = None,
    ) -> None:
        self._pool = pool
        self._repo = CaseRepository()
        self._engine = TransitionEngine()
        self._publisher = OutboxPublisher()
        self._clock_service = clock_service
        self._rfi_service = rfi_service
```

**c) In `create_case()`, add clock start AFTER the new case is successfully inserted (inside the same `if row is not None:` branch, after publishing the intake event):**

```python
                # New case — start the decision clock in the same transaction
                if self._clock_service is not None:
                    defn = ClockDefinition.for_case(case.urgency.value, "decision")
                    await self._clock_service.start(
                        conn,
                        case.tenant_id,
                        str(case.case_id),
                        defn,
                        Actor(id="system", type=ActorType.SYSTEM),
                    )
                return case
```

The full updated `create_case` method (replace the entire method):

```python
    async def create_case(self, case: Case) -> Case:
        """Create a case, idempotent on (correlation_id, tenant_id).

        If a row with the same correlation_id already exists for this tenant,
        returns the existing case with no side-effects. Otherwise inserts the
        row, writes a case.intake.received outbox event, and starts the
        decision clock — all in a single transaction.
        """
        async with self._pool.acquire() as conn:
            async with conn.transaction():
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
                    existing = await self._repo.fetch_by_correlation_id(
                        conn, case.correlation_id, case.tenant_id
                    )
                    return existing  # type: ignore[return-value]

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

                if self._clock_service is not None:
                    defn = ClockDefinition.for_case(case.urgency.value, "decision")
                    await self._clock_service.start(
                        conn,
                        case.tenant_id,
                        str(case.case_id),
                        defn,
                        Actor(id="system", type=ActorType.SYSTEM),
                    )

                return case
```

**d) Replace the `transition()` method (add clock stop on terminal states):**

```python
    async def transition(self, req: TransitionRequest) -> Case:
        """Apply a state transition.

        Wraps TransitionEngine.apply in a transaction. GuardError propagates
        unchanged so the API layer can convert it to HTTP 409. If the target
        state is terminal and a ClockService is wired, the decision clock is
        stopped in the same transaction.
        """
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                updated = await self._engine.apply(conn, req)
                if (
                    self._clock_service is not None
                    and req.to_state in self._TERMINAL_STATES
                ):
                    await self._clock_service.stop(
                        conn, req.tenant_id, str(req.case_id), "decision"
                    )
                return updated
```

**e) Add the new `pend_rfi()` method after `transition()`:**

```python
    async def pend_rfi(
        self,
        case_id: uuid.UUID,
        tenant_id: str,
        required_documents: list[str],
        due_date_days: int,
        actor: Actor,
        correlation_id: str,
    ) -> Case:
        """Transition to pend_rfi, pause the decision clock, and dispatch an RFI.

        All three writes happen in ONE transaction. If ClockService or RfiService
        are not wired, raises ValueError immediately (misconfiguration guard).
        """
        if self._clock_service is None or self._rfi_service is None:
            raise ValueError(
                "ClockService and RfiService must be injected to call pend_rfi()"
            )
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                updated = await self._engine.apply(
                    conn,
                    TransitionRequest(
                        case_id=case_id,
                        tenant_id=tenant_id,
                        to_state="pend_rfi",
                        actor_id=actor.id,
                        actor_type=actor.type.value,
                        correlation_id=correlation_id,
                    ),
                )
                await self._clock_service.pause(
                    conn, tenant_id, str(case_id), "decision", actor
                )
                rfi_req = RfiRequest(
                    tenant_id=tenant_id,
                    case_id=str(case_id),
                    required_documents=required_documents,
                    due_date_days=due_date_days,
                )
                await self._rfi_service.dispatch_rfi(conn, rfi_req, actor)
                return updated
```

- [ ] **Step 6.5: Add `POST /cases/{case_id}/pend-rfi` to the API router**

Edit `services/workflow-engine/enstellar_workflow/api/router.py`. Make the following changes:

**a) Add imports (after existing imports at the top):**

```python
from enstellar_events import Actor, ActorType
from ..clocks.service import ClockService
from ..outbox.publisher import OutboxPublisher
from ..rfi.service import RfiService
```

**b) Replace `_get_service()` with a version that wires ClockService and RfiService:**

```python
async def _get_service() -> CaseService:
    pool = await get_pool()
    publisher = OutboxPublisher()
    clock_service = ClockService(publisher)
    rfi_service = RfiService(publisher)
    return CaseService(pool, clock_service=clock_service, rfi_service=rfi_service)
```

**c) Add `PendRfiBody` model and the endpoint (after the existing `transition_case` endpoint):**

```python
class PendRfiBody(BaseModel):
    """Request body for POST /cases/{case_id}/pend-rfi."""

    tenant_id: str
    required_documents: list[str]
    due_date_days: int
    actor_id: str = "system"
    actor_type: str = "system"
    correlation_id: str


@router.post("/{case_id}/pend-rfi", response_model=None)
async def pend_rfi(
    case_id: uuid.UUID,
    body: PendRfiBody,
    service: CaseService = Depends(_get_service),
) -> Any:
    """Transition a case to pend_rfi, pause the clock, and dispatch an RFI.

    Returns 200 with the updated Case JSON.
    Returns 404 if the case is not found.
    Returns 409 if a guard rejects the transition.
    """
    try:
        actor_type_enum = ActorType(body.actor_type)
    except ValueError:
        actor_type_enum = ActorType.SYSTEM

    try:
        updated = await service.pend_rfi(
            case_id=case_id,
            tenant_id=body.tenant_id,
            required_documents=body.required_documents,
            due_date_days=body.due_date_days,
            actor=Actor(id=body.actor_id, type=actor_type_enum),
            correlation_id=body.correlation_id,
        )
    except GuardError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return updated.model_dump(mode="json")
```

- [ ] **Step 6.6: Run the rfi tests**

```bash
cd services/workflow-engine
uv run pytest tests/test_rfi.py -v
```

Expected:
```
tests/test_rfi.py::test_dispatch_rfi_publishes_rfi_dispatched_event PASSED
tests/test_rfi.py::test_dispatch_rfi_rejects_blank_tenant_id PASSED
tests/test_rfi.py::test_pend_rfi_transitions_case_pauses_clock_dispatches_rfi PASSED
tests/test_rfi.py::test_transition_to_terminal_state_stops_clock PASSED
tests/test_rfi.py::test_post_pend_rfi_returns_pend_rfi_status PASSED
tests/test_rfi.py::test_post_pend_rfi_unknown_case_returns_404 PASSED

============ 6 passed in X.Xs ============
```

- [ ] **Step 6.7: Confirm existing T08 tests still pass (regression check)**

```bash
cd services/workflow-engine
uv run pytest tests/test_cases_api.py tests/test_case_service.py tests/test_transitions.py -v
```

Expected: all pass (existing T08 invariant tests must remain green).

- [ ] **Step 6.8: Commit**

```bash
cd services/workflow-engine
git add \
  enstellar_workflow/rfi/__init__.py \
  enstellar_workflow/rfi/service.py \
  enstellar_workflow/cases/service.py \
  enstellar_workflow/api/router.py \
  tests/test_rfi.py
git commit -m "feat(workflow-engine): RfiService + CaseService.pend_rfi() + POST /cases/{id}/pend-rfi"
```

---

## Task 7: RfiResponseConsumer + Accumulated Pause Test + Mark T13 Done

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/consumers/rfi_response.py`
- Modify: `services/workflow-engine/enstellar_workflow/consumers/__init__.py`
- Test: append to `services/workflow-engine/tests/test_rfi.py`
- Modify: `.claude/task-graph.md`

- [ ] **Step 7.1: Write the failing tests**

Append the following to `services/workflow-engine/tests/test_rfi.py`:

```python
# ---------------------------------------------------------------------------
# Accumulated pause test (two full pause/resume cycles)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_accumulated_pause_across_two_cycles(pg_pool: asyncpg.Pool):
    """total_paused_seconds accumulates correctly across two full pause/resume cycles.

    This covers the DoD requirement: 'Clock pause duration accumulates correctly
    across multiple pause/resume cycles.'
    """
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-acc-pause"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("expedited", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    # Start clock
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.start(conn, tenant_id, case_id, defn, actor)

    # Cycle 1: pause → resume
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.pause(conn, tenant_id, case_id, "decision", actor)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.resume(conn, tenant_id, case_id, "decision", actor)

    async with pg_pool.acquire() as conn:
        tps_after_cycle1 = await conn.fetchval(
            "SELECT total_paused_seconds FROM clocks "
            "WHERE case_id = $1 AND clock_type = 'decision'",
            uuid.UUID(case_id),
        )

    # Cycle 2: pause → resume
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.pause(conn, tenant_id, case_id, "decision", actor)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await service.resume(conn, tenant_id, case_id, "decision", actor)

    async with pg_pool.acquire() as conn:
        tps_after_cycle2 = await conn.fetchval(
            "SELECT total_paused_seconds FROM clocks "
            "WHERE case_id = $1 AND clock_type = 'decision'",
            uuid.UUID(case_id),
        )
        final_state = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id = $1 AND clock_type = 'decision'",
            uuid.UUID(case_id),
        )

    # total_paused_seconds must be strictly greater after cycle 2
    assert float(tps_after_cycle2) > float(tps_after_cycle1), (
        f"Pause time did not accumulate: cycle1={tps_after_cycle1}, cycle2={tps_after_cycle2}"
    )
    assert float(tps_after_cycle2) >= 0.0
    assert final_state == "running"


@pytest.mark.asyncio
async def test_accumulated_pause_expedited_72h_rule(pg_pool: asyncpg.Pool):
    """Sanity check: expedited clock has 3-day deadline (72h rule)."""
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-72h"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("expedited", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            state = await service.start(conn, tenant_id, case_id, defn, actor)

    from datetime import timedelta
    expected = datetime.now(timezone.utc) + timedelta(days=3)
    assert abs((state.deadline - expected).total_seconds()) < 10, (
        f"Expedited deadline should be ~3 days from now. Got: {state.deadline}"
    )


@pytest.mark.asyncio
async def test_accumulated_pause_standard_7_day_rule(pg_pool: asyncpg.Pool):
    """Sanity check: standard clock has 7-day deadline."""
    from enstellar_workflow.clocks.model import ClockDefinition
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    service = ClockService(publisher)
    tenant_id = "tenant-7day"
    case_id = str(uuid.uuid4())
    defn = ClockDefinition.for_case("standard", "decision")
    actor = Actor(id="system", type=ActorType.SYSTEM)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            state = await service.start(conn, tenant_id, case_id, defn, actor)

    from datetime import timedelta
    expected = datetime.now(timezone.utc) + timedelta(days=7)
    assert abs((state.deadline - expected).total_seconds()) < 10


# ---------------------------------------------------------------------------
# RfiResponseConsumer integration test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rfi_response_consumer_resumes_clock_and_transitions_to_clinical_review(
    pg_pool: asyncpg.Pool,
):
    """RfiResponseConsumer.handle() resumes the clock and transitions case to clinical_review."""
    from canonical_model import Status
    from enstellar_workflow.cases.repository import CaseRepository
    from enstellar_workflow.cases.service import CaseService
    from enstellar_workflow.clocks.service import ClockService
    from enstellar_workflow.consumers.rfi_response import RfiResponseConsumer
    from enstellar_workflow.engine.transitions import TransitionEngine
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    publisher = OutboxPublisher()
    clock_service = ClockService(publisher)
    transition_engine = TransitionEngine()
    case_service = CaseService(pg_pool, clock_service=clock_service)

    case = make_case(tenant_id="tenant-rfi-consumer")
    created = await case_service.create_case(case)

    # Manually transition to pend_rfi (bypassing pend_rfi() to set up state)
    from enstellar_workflow.engine.transitions import TransitionRequest
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await transition_engine.apply(
                conn,
                TransitionRequest(
                    case_id=created.case_id,
                    tenant_id=created.tenant_id,
                    to_state="pend_rfi",
                    actor_id="system",
                    actor_type="system",
                    correlation_id=created.correlation_id,
                ),
            )

    # Manually pause the clock (normally done by pend_rfi())
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await clock_service.pause(
                conn,
                created.tenant_id,
                str(created.case_id),
                "decision",
                Actor(id="system", type=ActorType.SYSTEM),
            )

    # Simulate rfi.response.received event
    from enstellar_events import EventEnvelope, Topics
    rfi_response_event = EventEnvelope(
        event_id=uuid.uuid4(),
        tenant_id=created.tenant_id,
        case_id=created.case_id,
        correlation_id=created.correlation_id,
        type=Topics.RFI_RESPONSE_RECEIVED,
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="provider-001", type=ActorType.SERVICE),
        payload={"received_documents": ["clinical_notes"]},
        schema_version="1.0.0",
    )

    consumer = RfiResponseConsumer(pg_pool, clock_service, transition_engine)
    await consumer.handle(rfi_response_event)

    # Clock must be running again
    async with pg_pool.acquire() as conn:
        clock_state = await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id = $1 AND clock_type = 'decision'",
            created.case_id,
        )
    assert clock_state == "running", f"Expected 'running', got {clock_state!r}"

    # Case must be in clinical_review
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        refreshed = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)
    assert refreshed.status == Status.clinical_review, (
        f"Expected clinical_review, got {refreshed.status}"
    )
```

- [ ] **Step 7.2: Run to confirm failure**

```bash
cd services/workflow-engine
uv run pytest tests/test_rfi.py -k "accumulated_pause or rfi_response_consumer" -v
```

Expected:
```
ERROR — ModuleNotFoundError: No module named 'enstellar_workflow.consumers.rfi_response'
```

- [ ] **Step 7.3: Create RfiResponseConsumer**

Create `services/workflow-engine/enstellar_workflow/consumers/rfi_response.py`:

```python
"""RfiResponseConsumer — handles rfi.response.received events.

On receiving rfi.response.received:
  1. Resumes the decision clock (was paused during pend_rfi).
  2. Transitions the case from pend_rfi → clinical_review.

Both operations happen in ONE transaction so either both succeed or neither does.
Uses TransitionEngine directly (not CaseService.transition) to keep the consumer's
transaction boundary clean and avoid creating a nested pool acquire.
"""
from __future__ import annotations

import logging

import asyncpg

from enstellar_events import Actor, ActorType, EventEnvelope, Topics
from enstellar_workflow.clocks.service import ClockService
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from enstellar_workflow.kafka.consumer import IdempotentKafkaConsumer

logger = logging.getLogger(__name__)


class RfiResponseConsumer(IdempotentKafkaConsumer):
    """Consumes rfi.response.received and resumes the decision clock + transitions case."""

    def __init__(
        self,
        pool: asyncpg.Pool,
        clock_service: ClockService,
        transition_engine: TransitionEngine,
    ) -> None:
        super().__init__(
            pool,
            [Topics.RFI_RESPONSE_RECEIVED],
            group_id="workflow-engine-rfi-response",
        )
        self._clock_service = clock_service
        self._transition_engine = transition_engine

    async def handle(self, event: EventEnvelope) -> None:
        """Resume clock and transition case to clinical_review in one transaction."""
        if event.case_id is None:
            logger.error(
                "rfi_response_consumer_missing_case_id",
                extra={
                    "tenant_id": event.tenant_id,
                    "event_id": str(event.event_id),
                },
            )
            return

        system_actor = Actor(id="system", type=ActorType.SYSTEM)

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await self._clock_service.resume(
                    conn,
                    event.tenant_id,
                    str(event.case_id),
                    "decision",
                    system_actor,
                )
                await self._transition_engine.apply(
                    conn,
                    TransitionRequest(
                        case_id=event.case_id,
                        tenant_id=event.tenant_id,
                        to_state="clinical_review",
                        actor_id="system",
                        actor_type="system",
                        correlation_id=event.correlation_id,
                    ),
                )

        logger.info(
            "rfi_response_consumed",
            extra={
                "tenant_id": event.tenant_id,
                "case_id": str(event.case_id),
                "correlation_id": event.correlation_id,
            },
        )
```

- [ ] **Step 7.4: Update consumers/__init__.py to export RfiResponseConsumer**

Edit `services/workflow-engine/enstellar_workflow/consumers/__init__.py`. Replace its contents:

```python
"""Kafka consumers for the workflow engine."""
from .intake_consumer import IntakeConsumer
from .rfi_response import RfiResponseConsumer

__all__ = ["IntakeConsumer", "RfiResponseConsumer"]
```

- [ ] **Step 7.5: Run all the new tests in test_rfi.py**

```bash
cd services/workflow-engine
uv run pytest tests/test_rfi.py -v
```

Expected:
```
tests/test_rfi.py::test_dispatch_rfi_publishes_rfi_dispatched_event PASSED
tests/test_rfi.py::test_dispatch_rfi_rejects_blank_tenant_id PASSED
tests/test_rfi.py::test_pend_rfi_transitions_case_pauses_clock_dispatches_rfi PASSED
tests/test_rfi.py::test_transition_to_terminal_state_stops_clock PASSED
tests/test_rfi.py::test_post_pend_rfi_returns_pend_rfi_status PASSED
tests/test_rfi.py::test_post_pend_rfi_unknown_case_returns_404 PASSED
tests/test_rfi.py::test_accumulated_pause_across_two_cycles PASSED
tests/test_rfi.py::test_accumulated_pause_expedited_72h_rule PASSED
tests/test_rfi.py::test_accumulated_pause_standard_7_day_rule PASSED
tests/test_rfi.py::test_rfi_response_consumer_resumes_clock_and_transitions_to_clinical_review PASSED

============ 10 passed in X.Xs ============
```

- [ ] **Step 7.6: Run the full test suite**

```bash
cd services/workflow-engine
uv run pytest -v
```

Expected: ALL tests pass — including T04/T07 tests (publisher, relay, normalization, consumer), T08 tests (guards, repository, recorder, transitions, case service, API with invariant proofs), and T13 tests (clocks, rfi).

The invariant tests from T08 that must remain green:
```
tests/test_transitions.py::test_engine_denied_without_signoff_raises_guard_error PASSED
tests/test_cases_api.py::test_api_transition_denied_without_signoff_returns_409 PASSED
```

- [ ] **Step 7.7: Mark T13 done in task-graph.md**

Edit `.claude/task-graph.md`. Find:

```
| T13 pend/RFI + clock/SLA | Py | T12 | **sensitive (clocks)** | `[ ]` |
```

Change to:

```
| T13 pend/RFI + clock/SLA | Py | T12 | **sensitive (clocks)** | `[x]` |
```

- [ ] **Step 7.8: Commit**

```bash
cd services/workflow-engine
git add \
  enstellar_workflow/consumers/rfi_response.py \
  enstellar_workflow/consumers/__init__.py \
  tests/test_rfi.py

git add .claude/task-graph.md

git commit -m "feat(workflow-engine): RfiResponseConsumer, accumulated-pause tests — T13 done"
```

---

## Self-Review

### Spec coverage

| DoD Requirement | Covered by |
|---|---|
| `pend_rfi` entry pauses decision clock; publishes `clock.paused` | `CaseService.pend_rfi()` calls `ClockService.pause()` in same transaction; `test_pend_rfi_transitions_case_pauses_clock_dispatches_rfi` |
| RFI dispatched event on `pend_rfi` entry with structured payload | `RfiService.dispatch_rfi()` publishes `rfi.dispatched`; payload includes `required_documents` + `due_date_days`; `test_dispatch_rfi_publishes_rfi_dispatched_event` |
| `rfi.response.received` resumes clock; publishes `clock.resumed` | `RfiResponseConsumer.handle()` calls `ClockService.resume()`; `test_rfi_response_consumer_resumes_clock_and_transitions_to_clinical_review` |
| `clock.breached` published when SLA deadline passed and clock running | `ClockService.check_breach()` + `test_check_breach_marks_clock_breached_when_past_deadline` + `test_check_breach_publishes_clock_breached_event` |
| Pause duration accumulates correctly across multiple pause/resume cycles | SQL: `total_paused_seconds = total_paused_seconds + EXTRACT(EPOCH FROM (now() - paused_at))`; `test_accumulated_pause_across_two_cycles` |
| Integration tests cover expedited 72h rule | `test_accumulated_pause_expedited_72h_rule` verifies 3-day deadline |
| Integration tests cover standard 7-day rule | `test_accumulated_pause_standard_7_day_rule` verifies 7-day deadline |

### Placeholder scan

No TBDs or incomplete steps. Every step has complete code.

### Type consistency

- `ClockService` constructor: `(publisher: OutboxPublisher)` — consistent across `service.py`, `test_clocks.py`, `test_rfi.py`, `api/router.py`, `rfi_response.py`.
- `ClockService.pause(conn, tenant_id, case_id, clock_type, actor)` — all callers pass `str(case_id)` (not raw UUID). Consistent.
- `ClockService.stop(conn, tenant_id, case_id, clock_type)` — no `actor` param (no event published). Callers in `CaseService.transition()` match.
- `RfiService.dispatch_rfi(conn, RfiRequest, actor)` — consistent in all callers.
- `CaseService(pool, clock_service=None, rfi_service=None)` — existing tests in T08 (`test_case_service.py`, `IntakeConsumer`) construct `CaseService(pool)` without keyword args → still valid since they are optional.
- `RfiResponseConsumer(pool, clock_service, transition_engine)` — constructor matches all call sites in `test_rfi.py`.
- `Actor(id="system", type=ActorType.SYSTEM)` — uses `ActorType` enum, consistent with envelope.py and existing test patterns throughout.

### Invariant verification

- Invariant #1 (no adverse determination without human sign-off): unchanged. All existing T08 guard tests still run. `pend_rfi` is not an adverse state and does not touch guards.
- Invariant #5 (tenant_id on every write): `ClockService._make_event()` requires `tenant_id`; `RfiService.dispatch_rfi()` raises `ValueError` on blank tenant_id; `ClockService` SQL always includes `AND tenant_id = $3` in UPDATE statements.
- Clock rules are regulatory constants in `CLOCK_RULES` dict, not configurable at runtime.
