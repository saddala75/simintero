# T16 — Triage + Escalation + Human Sign-Off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Triage & Routing advisory agent (`POST /assist/triage`), case escalation to MD review queue (`POST /cases/{id}/escalate`), and the human sign-off recording + adverse-determination workflow (`POST /cases/{id}/human-signoff` → `POST /cases/{id}/transitions` with `human_signoff_recorded=True`).

**Architecture:** Triage agent follows the same LangGraph + guardrail pattern as the Completeness agent (T14): 3 nodes (call_model → parse_output → run_guardrails), typed `AgentOutput`, abstains on low confidence, guardrail engine blocks adverse language. Escalation is a pure state-machine side effect (no AI): validates current state = `clinical_review`, updates `assignee_queue`, emits `case.assigned` via outbox. Human sign-off uses a `human_signoffs` table; the existing T08 `adverse_transition_guard` remains the sole enforcement point — all code paths converge through it. BFF `adverse-decision` endpoint is the only UI-facing entry point for adverse decisions.

**Tech Stack:** Python 3.12, FastAPI, asyncpg, LangGraph, Hypothesis (property tests), Pydantic v2, Testcontainers.

> **Sensitive task (decision path):** Mandatory senior engineer review. The `adverse_transition_guard` is sacred — do not weaken or bypass it. Hypothesis property tests (Task 5) are a CI gate, not optional.

**Depends on:** T08 (TransitionEngine, guards, CaseService, api/router.py), T13 (workflow DB schema with `clocks` table as migration 0003 predecessor), T14 (GuardrailEngine, AgentOutput, model adapter, `POST /assist/completeness`), T12 (BFF `cases.py` router, `WorkflowClient`).

---

## Background (read before touching code)

### What already exists (verify these are done before starting)

**workflow-engine** (`services/workflow-engine/enstellar_workflow/`):
- `engine/guards.py` — `ADVERSE_STATES = frozenset({"denied", "partially_denied", "adverse_modification"})`, `GuardResult(NamedTuple)` with fields `passed: bool` and `reason: str | None`, `adverse_transition_guard(to_state, human_signoff_recorded) -> GuardResult`
- `engine/transitions.py` — `TransitionRequest` (dataclass: `case_id`, `tenant_id`, `to_state`, `actor_id`, `actor_type`, `correlation_id`, `payload`, `human_signoff_recorded`), `TransitionEngine.apply(conn, req) -> Case`
- `cases/service.py` — `CaseService(pool)`: `create_case(case)`, `transition(req)`, `get_events(case_id, tenant_id)`, `pend_rfi(...)` (added in T13)
- `api/router.py` — `POST /cases`, `GET /cases/{id}`, `GET /cases/{id}/events`, `POST /cases/{id}/transitions`
- `outbox/publisher.py` — `OutboxPublisher.publish(conn, event)` (inserts into outbox inside caller's transaction)
- `migrations/versions/0001_create_outbox_tables.py`, `0002_create_workflow_tables.py`, `0003_clocks.py`
- `tests/conftest.py` — `pg_pool`, `db_dsn`, `make_case()`

**agent-layer** (`services/agent-layer/enstellar_agents/`):
- `models.py` — `AgentInput`, `AgentOutput`, `GuardrailResult`
- `guardrails/engine.py` — `GuardrailEngine.check(output, expected_tenant_id) -> GuardrailResult`
- `model_access/base.py` — `ModelAdapter` ABC with `complete(system_prompt, user_message) -> str` and `model_name() -> str`
- `model_access/factory.py` — `get_adapter(settings: AgentSettings) -> ModelAdapter`
- `agents/completeness.py` — `build_graph(adapter: ModelAdapter)` → compiled LangGraph graph
- `routers/assist.py` — `POST /assist/completeness`; `router = APIRouter()`
- `main.py` — includes `assist_router`
- `tests/conftest.py` — `MockAdapter` class, `_reset_agent_settings` autouse fixture, `VALID_RESPONSE` / `INVALID_JSON_RESPONSE` / `LOW_CONFIDENCE_RESPONSE` constants

**portal-bff** (`services/portal-bff/enstellar_bff/`):
- `clients/workflow.py` — `WorkflowClient`: `get_case()`, `get_worklist()`, `transition()`, `workflow_client` singleton
- `routers/cases.py` — `GET /bff/cases/{id}`, `POST /bff/cases/{id}/decision`; uses `require_reviewer` dependency
- `auth.py` — `require_reviewer` FastAPI dependency (validates JWT, extracts `tenant_id`, `roles`, `sub`)
- `tests/conftest.py` — `app` fixture, `client` async client, `reviewer_token` fixture, `mock_jwks` fixture

### asyncpg and transaction patterns (codebase convention)
```python
async with pool.acquire() as conn:
    async with conn.transaction():
        # all writes inside here are atomic
        await some_service_method(conn, ...)
        await publisher.publish(conn, event)  # outbox write in same tx
```

### Event type for escalation
`Topics.CASE_ASSIGNED = "case.assigned"` already exists in `packages/event-contracts/enstellar_events/topics.py`.

### Import shortcuts used across this plan
```python
from enstellar_events import Actor, ActorType, EventEnvelope
from enstellar_events.topics import Topics
from enstellar_workflow.outbox.publisher import OutboxPublisher
from enstellar_workflow.engine.guards import ADVERSE_STATES, GuardResult, adverse_transition_guard
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.db.connection import get_pool
from tests.conftest import make_case
```

---

## File Map

### workflow-engine — new files

| File | Responsibility |
|---|---|
| `migrations/versions/0004_signoff_queue.py` | `human_signoffs` table + `assignee_queue` + `human_signoff_id` columns on `workflow_instances` |
| `enstellar_workflow/signoff/__init__.py` | Package marker; re-exports `SignoffService` |
| `enstellar_workflow/signoff/service.py` | `SignoffService.record_signoff()`, `SignoffService.has_signoff()` |
| `enstellar_workflow/escalation/__init__.py` | Package marker; re-exports `EscalationService` |
| `enstellar_workflow/escalation/service.py` | `EscalationService.escalate()` — validates state, updates queue, emits event |
| `tests/test_signoff.py` | Migration assertions + `SignoffService` integration tests |
| `tests/test_escalation.py` | `EscalationService` integration tests |
| `tests/test_adverse_invariant.py` | Hypothesis property tests — adverse guard exhaustive coverage |

### workflow-engine — modified files

| File | Change |
|---|---|
| `enstellar_workflow/cases/service.py` | Add `escalate()` and `record_signoff()` methods (pool + transaction wrappers) |
| `enstellar_workflow/api/router.py` | Add `POST /cases/{case_id}/escalate`, `POST /cases/{case_id}/human-signoff` |
| `pyproject.toml` | Add `hypothesis>=6.100` to dev dependencies |

### agent-layer — new files

| File | Responsibility |
|---|---|
| `enstellar_agents/agents/triage.py` | `TriageState` TypedDict, `build_triage_graph(adapter)` — 3-node LangGraph graph |
| `tests/test_triage_agent.py` | Agent tests (valid, adverse block, low confidence, invalid JSON) + router tests |

### agent-layer — modified files

| File | Change |
|---|---|
| `enstellar_agents/routers/assist.py` | Add `POST /assist/triage` endpoint |

### portal-bff — new files

| File | Responsibility |
|---|---|
| `tests/test_adverse_decision.py` | BFF adverse-decision endpoint tests |

### portal-bff — modified files

| File | Change |
|---|---|
| `enstellar_bff/clients/workflow.py` | Add `record_signoff()` method to `WorkflowClient` |
| `enstellar_bff/routers/cases.py` | Add `AdverseDecisionRequest` model + `POST /bff/cases/{id}/adverse-decision` |

### root — modified files

| File | Change |
|---|---|
| `Makefile` | Add `test-agents`, `test-bff` targets; update `test` target |
| `.claude/task-graph.md` | Mark T16 `[x]` |

---

## Task 1: Migration 0004 — human_signoffs table + workflow_instances columns

**Files:**
- Create: `services/workflow-engine/migrations/versions/0004_signoff_queue.py`
- Create: `services/workflow-engine/tests/test_signoff.py` (migration assertions only; service tests added in Task 2)

- [ ] **Step 1.1: Write the failing migration-assertion tests**

Create `services/workflow-engine/tests/test_signoff.py`:

```python
"""Tests for SignoffService and migration 0004 schema assertions.

Migration assertions run first (they only need pg_pool from conftest).
Service integration tests are appended in Task 2.
"""
import asyncpg
import pytest


# ---------------------------------------------------------------------------
# Migration assertions (Task 1)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_human_signoffs_table_exists(pg_pool: asyncpg.Pool):
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'human_signoffs'"
        )
    assert row is not None, "human_signoffs table was not created by migration 0004"


@pytest.mark.asyncio
async def test_workflow_instances_has_assignee_queue(pg_pool: asyncpg.Pool):
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'workflow_instances' AND column_name = 'assignee_queue'"
        )
    assert row is not None, "assignee_queue column missing from workflow_instances"


@pytest.mark.asyncio
async def test_workflow_instances_has_human_signoff_id(pg_pool: asyncpg.Pool):
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'workflow_instances' AND column_name = 'human_signoff_id'"
        )
    assert row is not None, "human_signoff_id column missing from workflow_instances"


@pytest.mark.asyncio
async def test_human_signoffs_unique_constraint_on_case_tenant(pg_pool: asyncpg.Pool):
    """Inserting two signoffs for the same (case_id, tenant_id) must raise UniqueViolationError."""
    import uuid
    case_id = uuid.uuid4()
    tenant_id = f"tenant-dup-{uuid.uuid4()}"
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO human_signoffs (case_id, tenant_id, actor_id, actor_type, outcome_context)
            VALUES ($1, $2, 'dr-jones', 'clinician', 'denied')
            """,
            case_id, tenant_id,
        )
        with pytest.raises(asyncpg.UniqueViolationError):
            await conn.execute(
                """
                INSERT INTO human_signoffs (case_id, tenant_id, actor_id, actor_type, outcome_context)
                VALUES ($1, $2, 'dr-smith', 'physician', 'denied')
                """,
                case_id, tenant_id,
            )
```

- [ ] **Step 1.2: Run to confirm the tests fail (table does not exist)**

```bash
cd services/workflow-engine && uv run pytest tests/test_signoff.py -v
```

Expected: All 4 tests fail — `human_signoffs table was not created by migration 0004` or similar assertion error because the migration has not been written yet.

- [ ] **Step 1.3: Write the migration**

Create `services/workflow-engine/migrations/versions/0004_signoff_queue.py`:

```python
"""Add human_signoffs table and update workflow_instances.

Adds:
  - human_signoffs table (one active sign-off per case per tenant)
  - workflow_instances.assignee_queue TEXT DEFAULT 'standard'
  - workflow_instances.human_signoff_id UUID FK → human_signoffs.signoff_id

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-06
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "human_signoffs",
        sa.Column(
            "signoff_id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("case_id", UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("actor_id", sa.Text, nullable=False),
        sa.Column("actor_type", sa.Text, nullable=False),
        sa.Column(
            "signed_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("outcome_context", sa.Text, nullable=True),
        sa.CheckConstraint("tenant_id != ''", name="ck_human_signoffs_tenant_id_not_empty"),
        sa.UniqueConstraint("case_id", "tenant_id", name="uq_human_signoffs_case_tenant"),
    )
    op.create_index("ix_human_signoffs_case_id", "human_signoffs", ["case_id"])
    op.create_index("ix_human_signoffs_tenant_id", "human_signoffs", ["tenant_id"])

    op.add_column(
        "workflow_instances",
        sa.Column("assignee_queue", sa.Text, nullable=True, server_default="standard"),
    )
    op.add_column(
        "workflow_instances",
        sa.Column(
            "human_signoff_id",
            UUID(as_uuid=True),
            sa.ForeignKey("human_signoffs.signoff_id"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("workflow_instances", "human_signoff_id")
    op.drop_column("workflow_instances", "assignee_queue")
    op.drop_index("ix_human_signoffs_tenant_id")
    op.drop_index("ix_human_signoffs_case_id")
    op.drop_table("human_signoffs")
```

- [ ] **Step 1.4: Run the migration assertions to confirm they pass**

```bash
cd services/workflow-engine && uv run pytest tests/test_signoff.py -v -k "migration or table_exists or assignee_queue or human_signoff_id or unique"
```

The Testcontainers conftest runs `alembic upgrade head` which now includes 0004. Expected:

```
PASSED tests/test_signoff.py::test_human_signoffs_table_exists
PASSED tests/test_signoff.py::test_workflow_instances_has_assignee_queue
PASSED tests/test_signoff.py::test_workflow_instances_has_human_signoff_id
PASSED tests/test_signoff.py::test_human_signoffs_unique_constraint_on_case_tenant
4 passed
```

- [ ] **Step 1.5: Commit**

```bash
git add \
  services/workflow-engine/migrations/versions/0004_signoff_queue.py \
  services/workflow-engine/tests/test_signoff.py
git commit -m "feat(workflow-engine): alembic migration 0004 — human_signoffs table + assignee_queue/human_signoff_id columns"
```

---

## Task 2: SignoffService

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/signoff/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/signoff/service.py`
- Extend: `services/workflow-engine/tests/test_signoff.py` (append service integration tests)

- [ ] **Step 2.1: Write the failing service tests (append to test_signoff.py)**

Append to the bottom of `services/workflow-engine/tests/test_signoff.py`:

```python
# ---------------------------------------------------------------------------
# SignoffService integration tests (Task 2)
# ---------------------------------------------------------------------------

import uuid
from tests.conftest import make_case
from enstellar_workflow.cases.repository import CaseRepository


@pytest.mark.asyncio
async def test_record_signoff_inserts_row_and_links_instance(pg_pool: asyncpg.Pool):
    """record_signoff must insert a human_signoffs row and link it from workflow_instances."""
    case = make_case(tenant_id="tenant-signoff-01")
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    from enstellar_workflow.signoff.service import SignoffService

    svc = SignoffService()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            result = await svc.record_signoff(
                conn,
                case_id=str(case.case_id),
                tenant_id=case.tenant_id,
                actor_id="dr-jones",
                actor_type="clinician",
                outcome_context="denied",
            )

    assert result["case_id"] == case.case_id
    assert result["tenant_id"] == case.tenant_id
    assert result["actor_id"] == "dr-jones"
    assert result["actor_type"] == "clinician"
    assert result["outcome_context"] == "denied"
    assert result["signoff_id"] is not None

    # Verify workflow_instances.human_signoff_id is set
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT human_signoff_id FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id, case.tenant_id,
        )
    assert row is not None
    assert row["human_signoff_id"] == result["signoff_id"]


@pytest.mark.asyncio
async def test_has_signoff_returns_false_before_record(pg_pool: asyncpg.Pool):
    case = make_case(tenant_id="tenant-signoff-02")
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    from enstellar_workflow.signoff.service import SignoffService

    svc = SignoffService()
    async with pg_pool.acquire() as conn:
        result = await svc.has_signoff(conn, str(case.case_id), case.tenant_id)
    assert result is False


@pytest.mark.asyncio
async def test_has_signoff_returns_true_after_record(pg_pool: asyncpg.Pool):
    case = make_case(tenant_id="tenant-signoff-03")
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    from enstellar_workflow.signoff.service import SignoffService

    svc = SignoffService()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.record_signoff(
                conn,
                case_id=str(case.case_id),
                tenant_id=case.tenant_id,
                actor_id="dr-jones",
                actor_type="clinician",
                outcome_context="adverse_modification",
            )

    async with pg_pool.acquire() as conn:
        result = await svc.has_signoff(conn, str(case.case_id), case.tenant_id)
    assert result is True


@pytest.mark.asyncio
async def test_record_signoff_upserts_on_duplicate(pg_pool: asyncpg.Pool):
    """Calling record_signoff twice for the same case must update the existing row (upsert)."""
    case = make_case(tenant_id="tenant-signoff-04")
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    from enstellar_workflow.signoff.service import SignoffService

    svc = SignoffService()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            first = await svc.record_signoff(
                conn,
                case_id=str(case.case_id),
                tenant_id=case.tenant_id,
                actor_id="dr-first",
                actor_type="clinician",
                outcome_context="denied",
            )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            second = await svc.record_signoff(
                conn,
                case_id=str(case.case_id),
                tenant_id=case.tenant_id,
                actor_id="dr-second",
                actor_type="physician",
                outcome_context="partially_denied",
            )

    # signoff_id must be the same row (upsert, not insert)
    assert first["signoff_id"] == second["signoff_id"]
    assert second["actor_id"] == "dr-second"
    assert second["outcome_context"] == "partially_denied"


@pytest.mark.asyncio
async def test_record_signoff_tenant_isolation(pg_pool: asyncpg.Pool):
    """has_signoff for a different tenant must return False even if same case_id."""
    case = make_case(tenant_id="tenant-signoff-05")
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    from enstellar_workflow.signoff.service import SignoffService

    svc = SignoffService()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.record_signoff(
                conn,
                case_id=str(case.case_id),
                tenant_id=case.tenant_id,
                actor_id="dr-jones",
                actor_type="clinician",
                outcome_context="denied",
            )

    async with pg_pool.acquire() as conn:
        result = await svc.has_signoff(conn, str(case.case_id), "other-tenant")
    assert result is False
```

- [ ] **Step 2.2: Run to confirm the new tests fail (module not found)**

```bash
cd services/workflow-engine && uv run pytest tests/test_signoff.py -v -k "record_signoff or has_signoff"
```

Expected: `ModuleNotFoundError: No module named 'enstellar_workflow.signoff'`

- [ ] **Step 2.3: Create `signoff/__init__.py`**

Create `services/workflow-engine/enstellar_workflow/signoff/__init__.py`:

```python
"""Signoff sub-package: human clinician sign-off recording."""
from .service import SignoffService

__all__ = ["SignoffService"]
```

- [ ] **Step 2.4: Create `signoff/service.py`**

Create `services/workflow-engine/enstellar_workflow/signoff/service.py`:

```python
"""SignoffService — records human clinician sign-off for adverse determinations.

Invariant #1: No adverse determination may be issued without a recorded
human sign-off. This service records the sign-off; the TransitionEngine's
adverse_transition_guard enforces that the sign-off exists before the
transition is applied.

All write methods require the caller to be inside a transaction.
"""
from __future__ import annotations

import uuid

import asyncpg


class SignoffService:
    async def record_signoff(
        self,
        conn: asyncpg.Connection,
        case_id: str,
        tenant_id: str,
        actor_id: str,
        actor_type: str,
        outcome_context: str,
    ) -> dict:
        """Insert or update a human_signoffs row and link it to workflow_instances.

        Uses ON CONFLICT … DO UPDATE so that a second call for the same
        (case_id, tenant_id) pair updates the row rather than erroring.

        The caller must be inside a transaction.

        Returns the full row as a plain dict.
        """
        row = await conn.fetchrow(
            """
            INSERT INTO human_signoffs
              (case_id, tenant_id, actor_id, actor_type, outcome_context)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (case_id, tenant_id) DO UPDATE
              SET actor_id       = EXCLUDED.actor_id,
                  actor_type     = EXCLUDED.actor_type,
                  signed_at      = now(),
                  outcome_context = EXCLUDED.outcome_context
            RETURNING signoff_id, case_id, tenant_id, actor_id, actor_type,
                      signed_at, outcome_context
            """,
            uuid.UUID(case_id),
            tenant_id,
            actor_id,
            actor_type,
            outcome_context,
        )
        # Link the sign-off to the case row
        await conn.execute(
            """
            UPDATE workflow_instances
               SET human_signoff_id = $1
             WHERE case_id = $2 AND tenant_id = $3
            """,
            row["signoff_id"],
            uuid.UUID(case_id),
            tenant_id,
        )
        return dict(row)

    async def has_signoff(
        self,
        conn: asyncpg.Connection,
        case_id: str,
        tenant_id: str,
    ) -> bool:
        """Return True if a sign-off row exists for (case_id, tenant_id)."""
        row = await conn.fetchrow(
            "SELECT signoff_id FROM human_signoffs WHERE case_id = $1 AND tenant_id = $2",
            uuid.UUID(case_id),
            tenant_id,
        )
        return row is not None
```

- [ ] **Step 2.5: Run all test_signoff.py tests to confirm they pass**

```bash
cd services/workflow-engine && uv run pytest tests/test_signoff.py -v
```

Expected:
```
PASSED tests/test_signoff.py::test_human_signoffs_table_exists
PASSED tests/test_signoff.py::test_workflow_instances_has_assignee_queue
PASSED tests/test_signoff.py::test_workflow_instances_has_human_signoff_id
PASSED tests/test_signoff.py::test_human_signoffs_unique_constraint_on_case_tenant
PASSED tests/test_signoff.py::test_record_signoff_inserts_row_and_links_instance
PASSED tests/test_signoff.py::test_has_signoff_returns_false_before_record
PASSED tests/test_signoff.py::test_has_signoff_returns_true_after_record
PASSED tests/test_signoff.py::test_record_signoff_upserts_on_duplicate
PASSED tests/test_signoff.py::test_record_signoff_tenant_isolation
9 passed
```

- [ ] **Step 2.6: Commit**

```bash
git add \
  services/workflow-engine/enstellar_workflow/signoff/__init__.py \
  services/workflow-engine/enstellar_workflow/signoff/service.py \
  services/workflow-engine/tests/test_signoff.py
git commit -m "feat(workflow-engine): SignoffService — record_signoff(), has_signoff() with upsert + tenant isolation"
```

---

## Task 3: EscalationService

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/escalation/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/escalation/service.py`
- Create: `services/workflow-engine/tests/test_escalation.py`

- [ ] **Step 3.1: Write the failing escalation tests**

Create `services/workflow-engine/tests/test_escalation.py`:

```python
"""Integration tests for EscalationService — requires PostgreSQL (Testcontainers)."""
import uuid

import asyncpg
import pytest

from canonical_model import Status
from enstellar_events import Actor, ActorType
from tests.conftest import make_case
from enstellar_workflow.cases.repository import CaseRepository


@pytest.mark.asyncio
async def test_escalate_from_clinical_review_updates_queue(pg_pool: asyncpg.Pool):
    """Escalating a clinical_review case sets assignee_queue='md_review'."""
    case = make_case(tenant_id="tenant-esc-01", status=Status.clinical_review)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    from enstellar_workflow.escalation.service import EscalationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    actor = Actor(id="user-reviewer-1", type=ActorType.USER)
    svc = EscalationService(OutboxPublisher())

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            result = await svc.escalate(conn, str(case.case_id), case.tenant_id, actor, reason="Needs MD")

    assert result["case_id"] == str(case.case_id)
    assert result["queue"] == "md_review"

    # Verify DB column was updated
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT assignee_queue FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id, case.tenant_id,
        )
    assert row["assignee_queue"] == "md_review"


@pytest.mark.asyncio
async def test_escalate_emits_case_assigned_outbox_event(pg_pool: asyncpg.Pool):
    """escalate() must write a case.assigned event to the outbox table."""
    case = make_case(tenant_id="tenant-esc-02", status=Status.clinical_review)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    from enstellar_workflow.escalation.service import EscalationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    actor = Actor(id="user-reviewer-2", type=ActorType.USER)
    svc = EscalationService(OutboxPublisher())

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.escalate(conn, str(case.case_id), case.tenant_id, actor)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT type, tenant_id, case_id FROM outbox WHERE case_id=$1 AND type='case.assigned'",
            case.case_id,
        )
    assert row is not None, "case.assigned event not found in outbox"
    assert row["tenant_id"] == case.tenant_id


@pytest.mark.asyncio
async def test_escalate_raises_if_not_clinical_review(pg_pool: asyncpg.Pool):
    """Escalating from a non-clinical_review state must raise ValueError."""
    case = make_case(tenant_id="tenant-esc-03", status=Status.intake)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    from enstellar_workflow.escalation.service import EscalationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    actor = Actor(id="user-reviewer-3", type=ActorType.USER)
    svc = EscalationService(OutboxPublisher())

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            with pytest.raises(ValueError, match="clinical_review"):
                await svc.escalate(conn, str(case.case_id), case.tenant_id, actor)


@pytest.mark.asyncio
async def test_escalate_raises_if_case_not_found(pg_pool: asyncpg.Pool):
    """Escalating a non-existent case_id must raise ValueError."""
    from enstellar_workflow.escalation.service import EscalationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    actor = Actor(id="user-reviewer-4", type=ActorType.USER)
    svc = EscalationService(OutboxPublisher())
    missing_id = str(uuid.uuid4())

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            with pytest.raises(ValueError, match="not found"):
                await svc.escalate(conn, missing_id, "tenant-esc-04", actor)


@pytest.mark.asyncio
async def test_escalate_tenant_isolation(pg_pool: asyncpg.Pool):
    """Escalating with a different tenant_id must raise ValueError (case not found)."""
    case = make_case(tenant_id="tenant-esc-05", status=Status.clinical_review)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    from enstellar_workflow.escalation.service import EscalationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    actor = Actor(id="user-reviewer-5", type=ActorType.USER)
    svc = EscalationService(OutboxPublisher())

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            with pytest.raises(ValueError, match="not found"):
                await svc.escalate(conn, str(case.case_id), "wrong-tenant", actor)
```

- [ ] **Step 3.2: Run to confirm the tests fail (module not found)**

```bash
cd services/workflow-engine && uv run pytest tests/test_escalation.py -v
```

Expected: `ModuleNotFoundError: No module named 'enstellar_workflow.escalation'`

- [ ] **Step 3.3: Create `escalation/__init__.py`**

Create `services/workflow-engine/enstellar_workflow/escalation/__init__.py`:

```python
"""Escalation sub-package: case escalation to MD review queue."""
from .service import EscalationService

__all__ = ["EscalationService"]
```

- [ ] **Step 3.4: Create `escalation/service.py`**

Create `services/workflow-engine/enstellar_workflow/escalation/service.py`:

```python
"""EscalationService — escalates a case to the MD review queue.

Validates that the case is in 'clinical_review' state, updates
assignee_queue='md_review', and emits a 'case.assigned' outbox event.

No LLM call, no coverage determination — this is a pure state-machine
side effect.

All writes must occur inside the caller's transaction.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import asyncpg

from enstellar_events import Actor, EventEnvelope
from enstellar_events.topics import Topics
from enstellar_workflow.outbox.publisher import OutboxPublisher


class EscalationService:
    def __init__(self, publisher: OutboxPublisher) -> None:
        self._pub = publisher

    async def escalate(
        self,
        conn: asyncpg.Connection,
        case_id: str,
        tenant_id: str,
        actor: Actor,
        reason: str | None = None,
    ) -> dict:
        """Escalate a case from clinical_review to md_review queue.

        Validates that the current status is 'clinical_review'.
        Updates workflow_instances.assignee_queue to 'md_review'.
        Writes a 'case.assigned' event to the outbox (same transaction).

        Args:
            conn:       asyncpg connection; the caller must be in a transaction.
            case_id:    UUID string of the case to escalate.
            tenant_id:  Tenant owning the case.
            actor:      The Actor (id + type) performing the escalation.
            reason:     Optional human-readable escalation reason.

        Returns:
            dict with keys 'case_id' and 'queue'.

        Raises:
            ValueError: if the case is not found, or is not in clinical_review.
        """
        row = await conn.fetchrow(
            "SELECT status FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            uuid.UUID(case_id),
            tenant_id,
        )
        if row is None:
            raise ValueError(f"Case {case_id} not found for tenant {tenant_id!r}")
        if row["status"] != "clinical_review":
            raise ValueError(
                f"Can only escalate from clinical_review; current status={row['status']!r}"
            )

        await conn.execute(
            """
            UPDATE workflow_instances
               SET assignee_queue = 'md_review', updated_at = now()
             WHERE case_id = $1 AND tenant_id = $2
            """,
            uuid.UUID(case_id),
            tenant_id,
        )

        event = EventEnvelope(
            event_id=uuid.uuid4(),
            tenant_id=tenant_id,
            case_id=uuid.UUID(case_id),
            correlation_id=str(uuid.uuid4()),
            type=Topics.CASE_ASSIGNED,
            occurred_at=datetime.now(timezone.utc),
            actor=actor,
            payload={"queue": "md_review", "reason": reason or "escalation"},
            schema_version="1.0.0",
        )
        await self._pub.publish(conn, event)

        return {"case_id": case_id, "queue": "md_review"}
```

- [ ] **Step 3.5: Run all escalation tests to confirm they pass**

```bash
cd services/workflow-engine && uv run pytest tests/test_escalation.py -v
```

Expected:
```
PASSED tests/test_escalation.py::test_escalate_from_clinical_review_updates_queue
PASSED tests/test_escalation.py::test_escalate_emits_case_assigned_outbox_event
PASSED tests/test_escalation.py::test_escalate_raises_if_not_clinical_review
PASSED tests/test_escalation.py::test_escalate_raises_if_case_not_found
PASSED tests/test_escalation.py::test_escalate_tenant_isolation
5 passed
```

- [ ] **Step 3.6: Commit**

```bash
git add \
  services/workflow-engine/enstellar_workflow/escalation/__init__.py \
  services/workflow-engine/enstellar_workflow/escalation/service.py \
  services/workflow-engine/tests/test_escalation.py
git commit -m "feat(workflow-engine): EscalationService — validate clinical_review, update assignee_queue, emit case.assigned"
```

---

## Task 4: Workflow-engine router additions + CaseService additions

**Files:**
- Modify: `services/workflow-engine/enstellar_workflow/cases/service.py` (add `escalate()`, `record_signoff()`)
- Modify: `services/workflow-engine/enstellar_workflow/api/router.py` (add two endpoints + body models)
- Create: `services/workflow-engine/tests/test_escalation_api.py`

- [ ] **Step 4.1: Write the failing API tests**

Create `services/workflow-engine/tests/test_escalation_api.py`:

```python
"""Integration tests for POST /cases/{id}/escalate and POST /cases/{id}/human-signoff.

Uses httpx AsyncClient + ASGITransport (no real server) backed by a real
Testcontainers PostgreSQL via pg_pool from conftest.
"""
import uuid
import json

import asyncpg
import httpx
import pytest

from canonical_model import Status
from tests.conftest import make_case
from enstellar_workflow.cases.repository import CaseRepository


@pytest.fixture
def wf_app():
    from enstellar_workflow.main import app
    return app


@pytest.fixture
async def _seed_clinical_review_case(pg_pool: asyncpg.Pool):
    """Insert a clinical_review case and return it."""
    case = make_case(tenant_id="tenant-api-esc-01", status=Status.clinical_review)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)
    return case


@pytest.mark.asyncio
async def test_post_escalate_returns_200_and_md_review(wf_app, _seed_clinical_review_case, monkeypatch):
    """POST /cases/{id}/escalate returns 200 {'case_id': ..., 'queue': 'md_review'}."""
    case = _seed_clinical_review_case

    # Point CaseService to the test pool
    from enstellar_workflow.db import connection as _conn_mod
    from enstellar_workflow.cases.service import CaseService
    from tests.conftest import pg_pool as _pool_fixture  # fixture resolved by DI below

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=wf_app), base_url="http://test"
    ) as client:
        r = await client.post(
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


@pytest.mark.asyncio
async def test_post_escalate_returns_409_if_not_clinical_review(wf_app, pg_pool: asyncpg.Pool):
    """POST /cases/{id}/escalate returns 409 when current state != clinical_review."""
    case = make_case(tenant_id="tenant-api-esc-02", status=Status.intake)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=wf_app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/cases/{case.case_id}/escalate",
            json={
                "tenant_id": case.tenant_id,
                "actor_id": "user-001",
                "actor_type": "user",
            },
        )

    assert r.status_code == 409, r.text
    assert "clinical_review" in r.json()["detail"]


@pytest.mark.asyncio
async def test_post_escalate_returns_409_for_missing_case(wf_app):
    """POST /cases/{id}/escalate returns 409 when case does not exist."""
    missing_id = str(uuid.uuid4())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=wf_app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/cases/{missing_id}/escalate",
            json={
                "tenant_id": "tenant-api-esc-03",
                "actor_id": "user-001",
                "actor_type": "user",
            },
        )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_post_human_signoff_returns_201_and_links_case(wf_app, pg_pool: asyncpg.Pool):
    """POST /cases/{id}/human-signoff returns 201 with signoff row and links workflow_instances."""
    case = make_case(tenant_id="tenant-api-signoff-01", status=Status.clinical_review)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=wf_app), base_url="http://test"
    ) as client:
        r = await client.post(
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
    assert "signoff_id" in body

    # Verify DB link
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT human_signoff_id FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id, case.tenant_id,
        )
    assert row["human_signoff_id"] is not None


@pytest.mark.asyncio
async def test_adverse_transition_blocked_without_signoff(wf_app, pg_pool: asyncpg.Pool):
    """INVARIANT: POST /cases/{id}/transitions to 'denied' returns 409 without prior sign-off."""
    case = make_case(tenant_id="tenant-api-guard-01", status=Status.clinical_review)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=wf_app), base_url="http://test"
    ) as client:
        r = await client.post(
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
```

- [ ] **Step 4.2: Run to confirm the API tests fail (routes not yet wired)**

```bash
cd services/workflow-engine && uv run pytest tests/test_escalation_api.py -v
```

Expected: The escalate/human-signoff routes return 404 (not yet registered), making the status-code assertions fail.

- [ ] **Step 4.3: Add `escalate()` and `record_signoff()` to `CaseService`**

Open `services/workflow-engine/enstellar_workflow/cases/service.py` and add the following methods at the end of the `CaseService` class (after the existing `get_events` method). Also add the required imports at the top of the file:

Add to the imports section at the top of `service.py`:
```python
import uuid as _uuid_mod
from enstellar_events import Actor
from enstellar_workflow.escalation.service import EscalationService
from enstellar_workflow.signoff.service import SignoffService
from enstellar_workflow.outbox.publisher import OutboxPublisher
```

Add these methods to the `CaseService` class body:

```python
    async def escalate(
        self,
        case_id: _uuid_mod.UUID,
        tenant_id: str,
        actor: Actor,
        reason: str | None = None,
    ) -> dict:
        """Escalate a case to the md_review queue (transition must be clinical_review).

        Raises ValueError (caller maps to 409) if the case is not in clinical_review
        or does not exist for the given tenant.
        """
        svc = EscalationService(OutboxPublisher())
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                return await svc.escalate(conn, str(case_id), tenant_id, actor, reason)

    async def record_signoff(
        self,
        case_id: _uuid_mod.UUID,
        tenant_id: str,
        actor_id: str,
        actor_type: str,
        outcome_context: str,
    ) -> dict:
        """Record human clinician sign-off for an adverse determination.

        Returns the signoff row as a plain dict.
        """
        svc = SignoffService()
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                return await svc.record_signoff(
                    conn, str(case_id), tenant_id, actor_id, actor_type, outcome_context
                )
```

- [ ] **Step 4.4: Add the two new endpoints and request-body models to `router.py`**

Open `services/workflow-engine/enstellar_workflow/api/router.py` and apply the following additions:

Add these imports at the top of `router.py` (after the existing imports):
```python
from enstellar_events import Actor, ActorType
```

Add the two new Pydantic body models after `TransitionBody`:
```python
class EscalateBody(BaseModel):
    """Request body for POST /cases/{case_id}/escalate."""

    tenant_id: str
    actor_id: str
    actor_type: str  # 'user' | 'system' | 'service'
    reason: str | None = None


class SignoffBody(BaseModel):
    """Request body for POST /cases/{case_id}/human-signoff."""

    tenant_id: str
    actor_id: str
    actor_type: str  # 'clinician' | 'physician' | 'user'
    outcome_context: str
```

Add the two new route handlers after the existing `transition_case` handler:
```python
@router.post("/{case_id}/escalate", response_model=None)
async def escalate_case(
    case_id: uuid.UUID,
    body: EscalateBody,
    service: CaseService = Depends(_get_service),
) -> Any:
    """Escalate a case from clinical_review to the md_review queue.

    Returns 200 with {'case_id': ..., 'queue': 'md_review'}.
    Returns 409 if the case is not in clinical_review or not found.
    """
    actor = Actor(id=body.actor_id, type=ActorType(body.actor_type))
    try:
        return await service.escalate(case_id, body.tenant_id, actor, body.reason)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{case_id}/human-signoff", status_code=201, response_model=None)
async def record_human_signoff(
    case_id: uuid.UUID,
    body: SignoffBody,
    service: CaseService = Depends(_get_service),
) -> Any:
    """Record human clinician sign-off for an adverse determination.

    Returns 201 with the signoff row.
    This endpoint does NOT transition the case — use POST /cases/{id}/transitions
    with human_signoff_recorded=True after calling this endpoint.
    """
    return await service.record_signoff(
        case_id,
        body.tenant_id,
        body.actor_id,
        body.actor_type,
        body.outcome_context,
    )
```

- [ ] **Step 4.5: Run the full workflow-engine test suite**

```bash
cd services/workflow-engine && uv run pytest -v
```

Expected: All previously-passing tests continue to pass, plus the new API tests:
```
PASSED tests/test_escalation_api.py::test_post_escalate_returns_200_and_md_review
PASSED tests/test_escalation_api.py::test_post_escalate_returns_409_if_not_clinical_review
PASSED tests/test_escalation_api.py::test_post_escalate_returns_409_for_missing_case
PASSED tests/test_escalation_api.py::test_post_human_signoff_returns_201_and_links_case
PASSED tests/test_escalation_api.py::test_adverse_transition_blocked_without_signoff
```

- [ ] **Step 4.6: Commit**

```bash
git add \
  services/workflow-engine/enstellar_workflow/cases/service.py \
  services/workflow-engine/enstellar_workflow/api/router.py \
  services/workflow-engine/tests/test_escalation_api.py
git commit -m "feat(workflow-engine): add escalate() and record_signoff() to CaseService; wire POST /cases/{id}/escalate and POST /cases/{id}/human-signoff"
```

---

## Task 5: Hypothesis property tests

**Files:**
- Modify: `services/workflow-engine/pyproject.toml` (add `hypothesis` to dev deps)
- Create: `services/workflow-engine/tests/test_adverse_invariant.py`

- [ ] **Step 5.1: Add `hypothesis` to the dev dependency group**

Open `services/workflow-engine/pyproject.toml` and add `"hypothesis>=6.100"` to the `[dependency-groups] dev` list:

```toml
[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "testcontainers[postgres]>=4.7",
    "testcontainers[kafka]>=4.7",
    "testcontainers[minio]>=4.7",
    "psycopg2-binary>=2.9",
    "httpx>=0.27",
    "hypothesis>=6.100",
]
```

- [ ] **Step 5.2: Sync deps to install hypothesis**

```bash
cd services/workflow-engine && uv sync
```

Expected: `hypothesis` and its transitive dep `attrs` are installed with no errors.

- [ ] **Step 5.3: Write the Hypothesis property tests**

Create `services/workflow-engine/tests/test_adverse_invariant.py`:

```python
"""Hypothesis property tests — adverse transition guard exhaustive coverage.

These tests MUST remain in CI. They prove that no combination of
(to_state, human_signoff_recorded) can bypass the adverse-transition
guard defined in enstellar_workflow.engine.guards.

INVARIANT #1: No adverse determination without recorded human sign-off.
Tests here are CI gates — never weaken or skip them.
"""
from __future__ import annotations

import pytest
from hypothesis import given, settings as hyp_settings
from hypothesis import strategies as st

ADVERSE_STATES: frozenset[str] = frozenset(
    {"denied", "partially_denied", "adverse_modification"}
)

NON_ADVERSE_STATES: frozenset[str] = frozenset(
    {
        "intake",
        "completeness_check",
        "auto_determination",
        "clinical_review",
        "pend_rfi",
        "approved",
        "withdrawn",
        "closed",
    }
)


@given(
    to_state=st.sampled_from(sorted(ADVERSE_STATES)),
    human_signoff_recorded=st.just(False),
)
@hyp_settings(max_examples=100)
def test_adverse_guard_always_blocks_without_signoff(to_state: str, human_signoff_recorded: bool):
    """INVARIANT #1: Adverse state + no signoff → guard must block. Always."""
    from enstellar_workflow.engine.guards import adverse_transition_guard

    result = adverse_transition_guard(to_state, human_signoff_recorded)
    assert not result.passed, (
        f"INVARIANT VIOLATION: guard ALLOWED adverse state {to_state!r} "
        f"without human_signoff_recorded — this must never happen."
    )
    assert result.reason is not None
    assert "sign-off" in result.reason


@given(
    to_state=st.sampled_from(sorted(ADVERSE_STATES)),
    human_signoff_recorded=st.just(True),
)
@hyp_settings(max_examples=100)
def test_adverse_guard_always_allows_with_signoff(to_state: str, human_signoff_recorded: bool):
    """With human_signoff_recorded=True, all adverse states must be allowed."""
    from enstellar_workflow.engine.guards import adverse_transition_guard

    result = adverse_transition_guard(to_state, human_signoff_recorded)
    assert result.passed, (
        f"Guard blocked {to_state!r} even with human_signoff_recorded=True — "
        f"this prevents legitimate adverse determinations."
    )


@given(to_state=st.sampled_from(sorted(NON_ADVERSE_STATES)))
@hyp_settings(max_examples=50)
def test_non_adverse_never_requires_signoff(to_state: str):
    """Non-adverse states must never require sign-off — that would break approvals."""
    from enstellar_workflow.engine.guards import adverse_transition_guard

    result = adverse_transition_guard(to_state, human_signoff_recorded=False)
    assert result.passed, (
        f"Guard incorrectly blocked non-adverse state {to_state!r} without signoff."
    )


def test_adverse_states_constant_is_exactly_three():
    """The ADVERSE_STATES constant must contain exactly the three specified states."""
    from enstellar_workflow.engine.guards import ADVERSE_STATES as GUARD_ADVERSE_STATES

    assert GUARD_ADVERSE_STATES == frozenset(
        {"denied", "partially_denied", "adverse_modification"}
    ), (
        f"ADVERSE_STATES has changed: {GUARD_ADVERSE_STATES!r}. "
        "Any change here requires senior engineer sign-off."
    )


@given(
    to_state=st.sampled_from(sorted(ADVERSE_STATES)),
    human_signoff_recorded=st.booleans(),
)
@hyp_settings(max_examples=100)
def test_guard_result_is_deterministic(to_state: str, human_signoff_recorded: bool):
    """Same inputs must always produce the same result — guard is pure."""
    from enstellar_workflow.engine.guards import adverse_transition_guard

    r1 = adverse_transition_guard(to_state, human_signoff_recorded)
    r2 = adverse_transition_guard(to_state, human_signoff_recorded)
    assert r1.passed == r2.passed
    assert r1.reason == r2.reason
```

- [ ] **Step 5.4: Run the property tests to confirm they pass**

```bash
cd services/workflow-engine && uv run pytest tests/test_adverse_invariant.py -v
```

Expected:
```
PASSED tests/test_adverse_invariant.py::test_adverse_guard_always_blocks_without_signoff
PASSED tests/test_adverse_invariant.py::test_adverse_guard_always_allows_with_signoff
PASSED tests/test_adverse_invariant.py::test_non_adverse_never_requires_signoff
PASSED tests/test_adverse_invariant.py::test_adverse_states_constant_is_exactly_three
PASSED tests/test_adverse_invariant.py::test_guard_result_is_deterministic
5 passed
```

If any test fails, **do not modify the test** — there is a bug in the guard implementation. Fix the guard.

- [ ] **Step 5.5: Commit**

```bash
git add \
  services/workflow-engine/pyproject.toml \
  services/workflow-engine/tests/test_adverse_invariant.py
git commit -m "test(workflow-engine): Hypothesis property tests — adverse guard invariant exhaustive coverage (100 examples)"
```

---

## Task 6: Triage agent + `POST /assist/triage`

**Files:**
- Create: `services/agent-layer/enstellar_agents/agents/triage.py`
- Create: `services/agent-layer/tests/test_triage_agent.py`
- Modify: `services/agent-layer/enstellar_agents/routers/assist.py` (add `/assist/triage` endpoint)

- [ ] **Step 6.1: Write the failing triage agent tests**

Create `services/agent-layer/tests/test_triage_agent.py`:

```python
"""Tests for the TriageAgent LangGraph graph and POST /assist/triage endpoint.

Agent tests use MockAdapter (defined in tests/conftest.py) to avoid real model
calls. Router tests use ASGI transport and monkeypatch on get_adapter.
"""
from __future__ import annotations

import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

# ---------------------------------------------------------------------------
# Fixtures / shared helpers
# ---------------------------------------------------------------------------

VALID_TRIAGE_RESPONSE = json.dumps(
    {
        "suggested_queue": "expedited",
        "rationale": "Urgency=expedited and procedure 27447 requires specialist review.",
        "confidence": 0.82,
        "citations": ["urgency=expedited", "CPT 27447"],
    }
)

LOW_CONFIDENCE_TRIAGE_RESPONSE = json.dumps(
    {
        "suggested_queue": "standard",
        "rationale": "Insufficient information.",
        "confidence": 0.25,
        "citations": [],
    }
)

ADVERSE_TRIAGE_RESPONSE = json.dumps(
    {
        "suggested_queue": "standard",
        "rationale": "The claim appears denied as not medically necessary.",
        "confidence": 0.85,
        "citations": ["urgency=standard"],
    }
)

INVALID_JSON_TRIAGE_RESPONSE = "not valid json {"


def _make_input(**overrides) -> dict:
    defaults = {
        "tenant_id": "tenant-triage-test",
        "case_id": str(uuid.uuid4()),
        "case_summary": {
            "procedure_code": "27447",
            "diagnosis_codes": ["M17.11"],
            "urgency": "expedited",
            "lob": "commercial",
        },
        "doc_requirements": ["operative_report"],
        "correlation_id": "corr-triage-001",
    }
    defaults.update(overrides)
    return defaults


# ---------------------------------------------------------------------------
# TriageAgent graph tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_triage_agent_valid_json_returns_result() -> None:
    """Valid JSON response → non-abstained AgentOutput with suggested_queue in result."""
    from tests.conftest import MockAdapter
    from enstellar_agents.agents.triage import build_triage_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(VALID_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input())
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    output = final["agent_output"]
    assert output.abstained is False
    assert output.confidence == pytest.approx(0.82)
    assert output.result is not None
    assert output.result["suggested_queue"] == "expedited"
    assert "urgency=expedited" in output.citations


@pytest.mark.asyncio
async def test_triage_agent_adverse_keyword_is_guardrail_blocked() -> None:
    """Result containing adverse keyword → guardrail fires → guardrail_result.passed=False."""
    from tests.conftest import MockAdapter
    from enstellar_agents.agents.triage import build_triage_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(ADVERSE_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input())
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    gr = final["guardrail_result"]
    assert not gr.passed
    assert any("no_autonomous_adverse" in v for v in gr.violations)


@pytest.mark.asyncio
async def test_triage_agent_low_confidence_abstains() -> None:
    """Confidence < 0.4 → agent sets abstained=True, result=None."""
    from tests.conftest import MockAdapter
    from enstellar_agents.agents.triage import build_triage_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(LOW_CONFIDENCE_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input())
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    output = final["agent_output"]
    assert output.abstained is True
    assert output.result is None
    assert output.confidence == pytest.approx(0.25)


@pytest.mark.asyncio
async def test_triage_agent_invalid_json_abstains_with_parse_error() -> None:
    """Unparseable model output → abstained=True, abstention_reason contains 'parse_error'."""
    from tests.conftest import MockAdapter
    from enstellar_agents.agents.triage import build_triage_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(INVALID_JSON_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input())
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    output = final["agent_output"]
    assert output.abstained is True
    assert output.result is None
    assert "parse_error" in (output.abstention_reason or "")


@pytest.mark.asyncio
async def test_triage_agent_provenance_has_model_name_and_hash() -> None:
    """AgentOutput.provenance must include model_name and input_hash."""
    from tests.conftest import MockAdapter
    from enstellar_agents.agents.triage import build_triage_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(VALID_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input())
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    prov = final["agent_output"].provenance
    assert "model_name" in prov
    assert "input_hash" in prov
    assert "timestamp" in prov


# ---------------------------------------------------------------------------
# POST /assist/triage router tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_assist_triage_happy_path_returns_200(monkeypatch) -> None:
    """POST /assist/triage with valid JSON model response → 200 with non-abstained AgentOutput."""
    from tests.conftest import MockAdapter
    from enstellar_agents.main import app

    monkeypatch.setattr("enstellar_agents.routers.assist.get_adapter", lambda _: MockAdapter(VALID_TRIAGE_RESPONSE))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/assist/triage", json=_make_input())

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["abstained"] is False
    assert body["result"]["suggested_queue"] == "expedited"


@pytest.mark.asyncio
async def test_assist_triage_guardrail_block_returns_abstained(monkeypatch) -> None:
    """POST /assist/triage with adverse keyword in model output → 200 with abstained=True.

    The guardrail must fire and the endpoint must scrub the result. The caller
    receives abstained=True rather than an error — advisory-safe degraded mode.
    """
    from tests.conftest import MockAdapter
    from enstellar_agents.main import app

    monkeypatch.setattr("enstellar_agents.routers.assist.get_adapter", lambda _: MockAdapter(ADVERSE_TRIAGE_RESPONSE))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/assist/triage", json=_make_input())

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["abstained"] is True
    assert body["result"] is None
    assert "no_autonomous_adverse" in (body.get("abstention_reason") or "")


@pytest.mark.asyncio
async def test_assist_triage_missing_tenant_id_returns_422() -> None:
    """POST /assist/triage without tenant_id → 422 Unprocessable Entity."""
    from enstellar_agents.main import app

    payload = _make_input()
    payload["tenant_id"] = ""  # blank → fails AgentInput validator

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/assist/triage", json=payload)

    assert r.status_code == 422
```

- [ ] **Step 6.2: Run to confirm the tests fail (module not found)**

```bash
cd services/agent-layer && uv run pytest tests/test_triage_agent.py -v
```

Expected: `ModuleNotFoundError: No module named 'enstellar_agents.agents.triage'`

- [ ] **Step 6.3: Create `agents/triage.py`**

Create `services/agent-layer/enstellar_agents/agents/triage.py`:

```python
"""TriageAgent — LangGraph typed graph for triage and routing advisory.

Graph topology:
  call_model → parse_output → run_guardrails → END

This agent is advisory only:
  - It produces AgentOutput (confidence, citations, abstained flag, provenance).
  - It NEVER writes to the workflow-engine or emits state-transition events.
  - GuardrailEngine runs unconditionally on every output.
  - The guardrail blocks adverse language (denied/adverse/not medically necessary).

PHI contract:
  - Only AgentInput.case_summary reaches the model — a pre-minimized dict.
  - Raw Case fields (member name, DOB, SSN, address) must not appear in case_summary.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import TypedDict

from langgraph.graph import END, StateGraph

from enstellar_agents.guardrails.engine import GuardrailEngine
from enstellar_agents.model_access.base import ModelAdapter
from enstellar_agents.models import AgentInput, AgentOutput, GuardrailResult

SYSTEM_PROMPT = (
    "You are a triage coordinator for prior authorization requests. "
    "Based on the case details, suggest: (1) the appropriate review queue "
    "(standard/expedited/md_review), (2) a rationale for your suggestion. "
    "You MUST NOT render any coverage determination or use denial/adverse language. "
    "You MUST cite specific case attributes (urgency, service codes, diagnosis codes) "
    "as evidence for your routing suggestion. "
    "Respond ONLY as valid JSON with this exact structure:\n"
    '{"suggested_queue": "standard|expedited|md_review", '
    '"rationale": "...", "confidence": 0.0, "citations": ["..."]}\n'
    "confidence must be a float between 0.0 and 1.0."
)


class TriageState(TypedDict):
    inp: AgentInput
    raw_output: str
    agent_output: AgentOutput | None
    guardrail_result: GuardrailResult | None


def build_triage_graph(adapter: ModelAdapter):
    """Compile a LangGraph StateGraph for the triage agent.

    Args:
        adapter: The ModelAdapter to use for inference. Created by get_adapter(settings).

    Returns:
        A compiled LangGraph graph — call ``await graph.ainvoke(state)`` to run it.
    """

    async def _call_model(state: TriageState) -> TriageState:
        inp = state["inp"]
        user_msg = f"Case summary: {json.dumps(inp.case_summary)}"
        raw = await adapter.complete(SYSTEM_PROMPT, user_msg)
        return {**state, "raw_output": raw}

    def _parse_output(state: TriageState) -> TriageState:
        inp = state["inp"]
        try:
            parsed = json.loads(state["raw_output"])
            confidence = float(parsed.get("confidence", 0.0))
            citations = list(parsed.get("citations", []))
            abstained = confidence < 0.4
            output = AgentOutput(
                agent_id="triage-v1",
                tenant_id=inp.tenant_id,
                case_id=inp.case_id,
                confidence=confidence,
                citations=citations,
                abstained=abstained,
                abstention_reason="low confidence" if abstained else None,
                result=parsed if not abstained else None,
                provenance={
                    "model_name": adapter.model_name(),
                    "input_hash": hashlib.sha256(
                        json.dumps(inp.case_summary, sort_keys=True).encode()
                    ).hexdigest()[:16],
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception as exc:  # noqa: BLE001
            output = AgentOutput(
                agent_id="triage-v1",
                tenant_id=inp.tenant_id,
                case_id=inp.case_id,
                confidence=0.0,
                citations=[],
                abstained=True,
                abstention_reason=f"parse_error: {exc}",
                result=None,
                provenance={
                    "model_name": adapter.model_name(),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        return {**state, "agent_output": output}

    def _run_guardrails(state: TriageState) -> TriageState:
        engine = GuardrailEngine()
        result = engine.check(state["agent_output"], state["inp"].tenant_id)
        return {**state, "guardrail_result": result}

    g = StateGraph(TriageState)
    g.add_node("call_model", _call_model)
    g.add_node("parse_output", _parse_output)
    g.add_node("run_guardrails", _run_guardrails)
    g.set_entry_point("call_model")
    g.add_edge("call_model", "parse_output")
    g.add_edge("parse_output", "run_guardrails")
    g.add_edge("run_guardrails", END)
    return g.compile()
```

- [ ] **Step 6.4: Run triage agent tests (not router tests yet) to confirm they pass**

```bash
cd services/agent-layer && uv run pytest tests/test_triage_agent.py -v -k "not assist_triage"
```

Expected: All 5 agent-only tests pass.

- [ ] **Step 6.5: Add `POST /assist/triage` to `routers/assist.py`**

Open `services/agent-layer/enstellar_agents/routers/assist.py` and add the triage import and endpoint. The existing file has `POST /assist/completeness` and `router = APIRouter()`. Add these additions:

Add import at the top (after existing imports):
```python
from enstellar_agents.agents.triage import build_triage_graph
```

Add the endpoint after the existing `completeness_assist` function:
```python
@router.post("/assist/triage")
async def triage_assist(body: AgentInput) -> AgentOutput:
    """Run the TriageAgent and return a guardrail-checked AgentOutput.

    The caller (BFF) must treat the response as advisory. The suggested_queue
    value is a routing recommendation only — it does not commit a transition.
    If ``abstained=True``, the agent could not produce a usable recommendation.
    The caller must not use ``result`` to make a coverage determination.
    """
    adapter = get_adapter(get_settings())
    graph = build_triage_graph(adapter)
    final = await graph.ainvoke(
        {"inp": body, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )
    gr: GuardrailResult = final["guardrail_result"]
    output: AgentOutput = final["agent_output"]

    if not gr.passed:
        # Guardrail fired — scrub the result and surface the violation reasons.
        output = output.model_copy(
            update={
                "abstained": True,
                "abstention_reason": "; ".join(gr.violations),
                "result": None,
            }
        )
    return output
```

- [ ] **Step 6.6: Run all agent-layer tests to confirm everything passes**

```bash
cd services/agent-layer && uv run pytest -v
```

Expected: All tests pass, including the 3 new router tests:
```
PASSED tests/test_triage_agent.py::test_triage_agent_valid_json_returns_result
PASSED tests/test_triage_agent.py::test_triage_agent_adverse_keyword_is_guardrail_blocked
PASSED tests/test_triage_agent.py::test_triage_agent_low_confidence_abstains
PASSED tests/test_triage_agent.py::test_triage_agent_invalid_json_abstains_with_parse_error
PASSED tests/test_triage_agent.py::test_triage_agent_provenance_has_model_name_and_hash
PASSED tests/test_triage_agent.py::test_assist_triage_happy_path_returns_200
PASSED tests/test_triage_agent.py::test_assist_triage_guardrail_block_returns_abstained
PASSED tests/test_triage_agent.py::test_assist_triage_missing_tenant_id_returns_422
```

- [ ] **Step 6.7: Commit**

```bash
git add \
  services/agent-layer/enstellar_agents/agents/triage.py \
  services/agent-layer/enstellar_agents/routers/assist.py \
  services/agent-layer/tests/test_triage_agent.py
git commit -m "feat(agent-layer): TriageAgent (LangGraph) + POST /assist/triage — advisory routing, guardrail-gated"
```

---

## Task 7: BFF adverse-decision endpoint + Makefile/CI

**Files:**
- Modify: `services/portal-bff/enstellar_bff/clients/workflow.py` (add `record_signoff()`)
- Modify: `services/portal-bff/enstellar_bff/routers/cases.py` (add model + endpoint)
- Create: `services/portal-bff/tests/test_adverse_decision.py`
- Modify: `Makefile` (add `test-agents`, `test-bff` targets, update `test`)
- Modify: `.claude/task-graph.md` (mark T16 `[x]`)

- [ ] **Step 7.1: Write the failing BFF tests**

Create `services/portal-bff/tests/test_adverse_decision.py`:

```python
"""Tests for POST /bff/cases/{id}/adverse-decision.

Uses respx to mock the workflow-engine HTTP calls and the shared conftest
fixtures (client, reviewer_token) from tests/conftest.py (T12).
"""
from __future__ import annotations

import json
import uuid

import httpx
import pytest
import respx

# The conftest.py (T12) provides: app, client, reviewer_token, mock_jwks
# fixtures. Import them implicitly via pytest fixture discovery.

CASE_ID = str(uuid.uuid4())
WF_BASE = "http://workflow-engine:8000"


@pytest.mark.asyncio
@respx.mock
async def test_adverse_decision_sign_off_false_returns_400(client, reviewer_token):
    """sign_off_confirmed=False must return 400 immediately without calling workflow-engine."""
    signoff_route = respx.post(f"{WF_BASE}/cases/{CASE_ID}/human-signoff").mock(
        return_value=httpx.Response(201, json={})
    )

    r = await client.post(
        f"/bff/cases/{CASE_ID}/adverse-decision",
        json={
            "outcome": "denied",
            "reason": "Not medically necessary per review criteria.",
            "clinician_id": "dr-jones",
            "sign_off_confirmed": False,
        },
        headers={"Authorization": f"Bearer {reviewer_token}"},
    )

    assert r.status_code == 400, r.text
    assert "sign_off_confirmed" in r.json().get("detail", "")
    # workflow-engine must NOT be called
    assert not signoff_route.called


@pytest.mark.asyncio
@respx.mock
async def test_adverse_decision_calls_signoff_then_transition(client, reviewer_token):
    """sign_off_confirmed=True → record_signoff called then transition with human_signoff_recorded=True."""
    signoff_route = respx.post(f"{WF_BASE}/cases/{CASE_ID}/human-signoff").mock(
        return_value=httpx.Response(
            201,
            json={
                "signoff_id": str(uuid.uuid4()),
                "case_id": CASE_ID,
                "tenant_id": "test-tenant",
                "actor_id": "dr-jones",
                "actor_type": "clinician",
                "outcome_context": "denied",
            },
        )
    )
    transition_route = respx.post(f"{WF_BASE}/cases/{CASE_ID}/transitions").mock(
        return_value=httpx.Response(
            200,
            json={"case_id": CASE_ID, "status": "denied"},
        )
    )

    r = await client.post(
        f"/bff/cases/{CASE_ID}/adverse-decision",
        json={
            "outcome": "denied",
            "reason": "Not medically necessary per criteria.",
            "clinician_id": "dr-jones",
            "sign_off_confirmed": True,
        },
        headers={"Authorization": f"Bearer {reviewer_token}"},
    )

    assert r.status_code == 200, r.text

    # Both endpoints were called
    assert signoff_route.called, "record_signoff was not called"
    assert transition_route.called, "transition was not called"

    # Signoff was called before transition (the only ordering guarantee we can test)
    assert signoff_route.calls[0].response is not None

    # Transition body must carry human_signoff_recorded=True and the correct outcome
    tx_body = json.loads(transition_route.calls[0].request.content)
    assert tx_body["human_signoff_recorded"] is True
    assert tx_body["to_state"] == "denied"


@pytest.mark.asyncio
@respx.mock
async def test_adverse_decision_partially_denied_outcome(client, reviewer_token):
    """All three adverse states must be accepted: test partially_denied."""
    respx.post(f"{WF_BASE}/cases/{CASE_ID}/human-signoff").mock(
        return_value=httpx.Response(201, json={"signoff_id": str(uuid.uuid4())})
    )
    respx.post(f"{WF_BASE}/cases/{CASE_ID}/transitions").mock(
        return_value=httpx.Response(200, json={"status": "partially_denied"})
    )

    r = await client.post(
        f"/bff/cases/{CASE_ID}/adverse-decision",
        json={
            "outcome": "partially_denied",
            "reason": "Partial coverage approved.",
            "clinician_id": "dr-smith",
            "sign_off_confirmed": True,
        },
        headers={"Authorization": f"Bearer {reviewer_token}"},
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_adverse_decision_no_auth_returns_401(client):
    """Without Authorization header → 401."""
    r = await client.post(
        f"/bff/cases/{CASE_ID}/adverse-decision",
        json={
            "outcome": "denied",
            "reason": "Test",
            "clinician_id": "dr-jones",
            "sign_off_confirmed": True,
        },
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_adverse_decision_invalid_outcome_returns_422(client, reviewer_token):
    """outcome not in the three adverse states → 422 from Pydantic Literal validation."""
    r = await client.post(
        f"/bff/cases/{CASE_ID}/adverse-decision",
        json={
            "outcome": "approved",   # not an adverse state
            "reason": "Test",
            "clinician_id": "dr-jones",
            "sign_off_confirmed": True,
        },
        headers={"Authorization": f"Bearer {reviewer_token}"},
    )
    assert r.status_code == 422
```

- [ ] **Step 7.2: Run to confirm the tests fail (route not yet wired)**

```bash
cd services/portal-bff && uv run pytest tests/test_adverse_decision.py -v
```

Expected: All tests fail — either `ModuleNotFoundError` for the endpoint or 404/422 responses.

- [ ] **Step 7.3: Add `record_signoff()` to `WorkflowClient`**

Open `services/portal-bff/enstellar_bff/clients/workflow.py` and add the `record_signoff` method to the `WorkflowClient` class (after the existing `transition` method):

```python
    async def record_signoff(
        self,
        case_id: str,
        tenant_id: str,
        actor_id: str,
        actor_type: str,
        outcome_context: str,
    ) -> dict:
        """POST /cases/{case_id}/human-signoff on the workflow-engine.

        Records clinician sign-off for an adverse determination.
        Must be called before calling transition() with human_signoff_recorded=True.
        """
        r = await self._http.post(
            f"/cases/{case_id}/human-signoff",
            json={
                "tenant_id": tenant_id,
                "actor_id": actor_id,
                "actor_type": actor_type,
                "outcome_context": outcome_context,
            },
            headers={"X-Tenant-Id": tenant_id},
        )
        r.raise_for_status()
        return r.json()
```

- [ ] **Step 7.4: Add `AdverseDecisionRequest` and the endpoint to `cases.py`**

Open `services/portal-bff/enstellar_bff/routers/cases.py` and apply these additions:

Add imports at the top (after existing imports):
```python
import uuid
from typing import Literal
```

Add the request model after the existing models in the file:
```python
class AdverseDecisionRequest(BaseModel):
    """Request body for POST /bff/cases/{id}/adverse-decision.

    outcome must be one of the three adverse states defined by ADVERSE_STATES
    in the workflow-engine. sign_off_confirmed must be True — this is a UI
    contract: the reviewer must explicitly confirm sign-off in the form.
    """

    outcome: Literal["denied", "partially_denied", "adverse_modification"]
    reason: str
    clinician_id: str
    sign_off_confirmed: bool  # must be True; validated below
```

Add the endpoint at the bottom of the router (after the existing `submit_decision` or `get_case` handlers):
```python
@router.post("/cases/{case_id}/adverse-decision")
async def submit_adverse_decision(
    case_id: uuid.UUID,
    body: AdverseDecisionRequest,
    auth: dict = Depends(require_reviewer),
) -> dict:
    """Record clinician sign-off and apply an adverse state transition.

    Two-step atomic sequence from the UI's perspective:
      1. POST /cases/{id}/human-signoff  (workflow-engine records the sign-off row)
      2. POST /cases/{id}/transitions with human_signoff_recorded=True

    Returns 400 if sign_off_confirmed is not True — the UI must force the
    reviewer to explicitly tick the confirmation checkbox.
    """
    if not body.sign_off_confirmed:
        raise HTTPException(
            status_code=400,
            detail="sign_off_confirmed must be True for adverse decisions",
        )

    # Step 1: Record the clinician sign-off row in the workflow-engine
    await workflow_client.record_signoff(
        case_id=str(case_id),
        tenant_id=auth["tenant_id"],
        actor_id=body.clinician_id,
        actor_type="clinician",
        outcome_context=body.outcome,
    )

    # Step 2: Apply the adverse transition with human_signoff_recorded=True
    # The workflow-engine's adverse_transition_guard will verify the signoff.
    return await workflow_client.transition(
        case_id=str(case_id),
        tenant_id=auth["tenant_id"],
        to_state=body.outcome,
        actor_id=auth["sub"],
        actor_type="user",
        correlation_id=str(uuid.uuid4()),
        payload={"reason": body.reason},
        human_signoff_recorded=True,
    )
```

- [ ] **Step 7.5: Run the BFF tests to confirm they pass**

```bash
cd services/portal-bff && uv run pytest tests/test_adverse_decision.py -v
```

Expected:
```
PASSED tests/test_adverse_decision.py::test_adverse_decision_sign_off_false_returns_400
PASSED tests/test_adverse_decision.py::test_adverse_decision_calls_signoff_then_transition
PASSED tests/test_adverse_decision.py::test_adverse_decision_partially_denied_outcome
PASSED tests/test_adverse_decision.py::test_adverse_decision_no_auth_returns_401
PASSED tests/test_adverse_decision.py::test_adverse_decision_invalid_outcome_returns_422
5 passed
```

Then run the full BFF suite to ensure nothing regressed:

```bash
cd services/portal-bff && uv run pytest -v
```

Expected: All tests pass.

- [ ] **Step 7.6: Update the Makefile**

Open `Makefile` and apply the following additions:

After the existing `test-workflow` target, add:

```makefile
## Run agent-layer tests only.
test-agents:
	cd services/agent-layer && uv run pytest -v

## Run portal-bff tests only.
test-bff:
	cd services/portal-bff && uv run pytest -v
```

Update the `test` target to include the new services:

```makefile
## Run unit, contract, and integration tests across all services.
test:
	cd packages/canonical-model && uv run pytest tests/python/ -v
	cd packages/canonical-model && npm test
	cd packages/canonical-model && ./gradlew test
	cd services/workflow-engine && uv run pytest -v
	cd services/agent-layer && uv run pytest -v
	cd services/portal-bff && uv run pytest -v
```

- [ ] **Step 7.7: Mark T16 complete in the task graph**

Open `.claude/task-graph.md`, find the T16 entry (should be `[ ] T16` or similar), and change it to `[x] T16`.

- [ ] **Step 7.8: Commit**

```bash
git add \
  services/portal-bff/enstellar_bff/clients/workflow.py \
  services/portal-bff/enstellar_bff/routers/cases.py \
  services/portal-bff/tests/test_adverse_decision.py \
  Makefile \
  .claude/task-graph.md
git commit -m "feat(bff): POST /bff/cases/{id}/adverse-decision — sign-off + adverse transition; update Makefile; T16 complete"
```

---

## Self-Review Checklist

### Spec coverage

| Requirement | Task |
|---|---|
| Triage agent `POST /assist/triage` returns routing suggestion (queue, rationale, confidence) | Task 6 |
| Guardrail engine blocks adverse language in triage output | Task 6 |
| Escalation `POST /cases/{id}/escalate` → assigns md_review queue + emits `case.assigned` | Task 3 + 4 |
| 409 if case not in `clinical_review` for escalation | Task 3 + 4 |
| Human sign-off `POST /cases/{id}/human-signoff` records actor + timestamp | Task 2 + 4 |
| Adverse transitions allowed only after sign-off recorded | Task 2 + 4 (guard enforced by T08 existing guard) |
| Property tests (Hypothesis, 100 examples): no adverse state without sign-off | Task 5 |
| BFF `POST /bff/cases/{id}/adverse-decision` calls sign-off then transition | Task 7 |
| BFF returns 400 if `sign_off_confirmed != True` | Task 7 |
| Mandatory senior engineer review noted | Plan header |

### Invariant checks

| Invariant | Enforcement |
|---|---|
| No adverse determination without human sign-off | `adverse_transition_guard` (T08) + Hypothesis property tests (Task 5) + API test `test_adverse_transition_blocked_without_signoff` (Task 4) |
| No LLM call on determination path | Triage agent produces `AgentOutput` only; never calls `CaseService.transition()` |
| PHI minimum-necessary | Triage agent receives `AgentInput.case_summary` (minimized dict); GuardrailEngine runs `rule_phi_minimization` |
| `tenant_id` on every call | `SignoffService` validates tenant_id per query; `EscalationService` scopes all queries by tenant_id; BFF passes `auth["tenant_id"]` on every client call |

### Type consistency

- `GuardResult.passed` (NamedTuple, defined in T08) — used consistently in Hypothesis tests (`.passed`, not `.allowed`)
- `EscalationService.escalate(conn, case_id: str, tenant_id: str, actor: Actor, reason: str | None)` — matches the `Actor` type from `enstellar_events`
- `SignoffService.record_signoff(conn, case_id: str, ...) -> dict` — returns plain dict, not Pydantic model; callers work with dict
- `CaseService.escalate(case_id: uuid.UUID, ...)` — takes UUID at the service level, converts to str when calling `EscalationService`
- `CaseService.record_signoff(case_id: uuid.UUID, ...)` — takes UUID, converts to str
- `build_triage_graph(adapter: ModelAdapter)` — matches the `build_graph(adapter: ModelAdapter)` pattern from T14 completeness agent
- `MockAdapter` in `tests/conftest.py` (agent-layer) implements `complete(system_prompt, user_message) -> str` and `model_name() -> str` — matches `ModelAdapter` ABC
- `GuardrailResult.passed` and `GuardrailResult.violations` — used consistently in triage agent and router
- BFF `workflow_client.transition()` signature unchanged — `human_signoff_recorded: bool = False` kwarg is already present from T12
