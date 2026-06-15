# UC + US — Criteria Accordion & AI Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the reviewer UI's hardcoded criteria accordion and AI suggestion cards to real data from the Completeness and Triage agents via `case_criteria` and `case_suggestions` persistence tables.

**Architecture:** A new `ClinicalReviewConsumer` (Kafka consumer) fires on every `case.state.transitioned → clinical_review` event, calls the agent-layer's `/assist/completeness` and `/assist/triage` HTTP endpoints with PHI-minimized payloads, and writes the results into `case_criteria` and `case_suggestions`. The BFF proxies both tables, and the frontend replaces hardcoded stubs with `useQuery` hooks.

**Tech Stack:** Python 3.12 / asyncpg / FastAPI / Pydantic v2 / httpx / aiokafka / pytest-asyncio / testcontainers; TypeScript / React / TanStack Query.

**Spec:** `docs/superpowers/specs/2026-06-07-uc-us-criteria-suggestions-design.md`

---

## File Map

### workflow-engine (create)
- `migrations/versions/0007_case_criteria.py`
- `migrations/versions/0008_case_suggestions.py`
- `enstellar_workflow/criteria/__init__.py`
- `enstellar_workflow/criteria/repository.py`
- `enstellar_workflow/criteria/router.py`
- `enstellar_workflow/suggestions/__init__.py`
- `enstellar_workflow/suggestions/repository.py`
- `enstellar_workflow/suggestions/router.py`
- `enstellar_workflow/consumers/clinical_review_consumer.py`
- `tests/test_criteria_api.py`
- `tests/test_suggestions_api.py`
- `tests/test_clinical_review_consumer.py`

### workflow-engine (modify)
- `enstellar_workflow/config.py` — add `agent_layer_url`
- `enstellar_workflow/consumers/__init__.py` — export `ClinicalReviewConsumer`
- `enstellar_workflow/main.py` — register criteria/suggestions routers + start consumer

### packages/event-contracts (modify)
- `packages/event-contracts/enstellar_events/topics.py` — add `AGENT_ASSIST_FAILED`

### portal-bff (modify)
- `enstellar_bff/clients/workflow.py` — add `criteria()`, `suggestions()`, `suggestion_action()`
- `enstellar_bff/models.py` — add `CriterionItem`, `SuggestionItem`, `SuggestionActionRequest`
- `enstellar_bff/routers/cases.py` — add criteria + suggestions routes

### portal-bff (create)
- `tests/test_criteria.py`
- `tests/test_suggestions.py`

### apps/web (modify)
- `src/types/index.ts` — add `CriterionItem`, `SuggestionItem`
- `src/api/client.ts` — add `getCriteria`, `getSuggestions`, `postSuggestionAction`
- `src/pages/CasePage.tsx` — replace `CRITERIA` and `SUGGESTIONS` stubs

---

## Task 1: UC1 — `case_criteria` Alembic migration

**Files:**
- Create: `services/workflow-engine/migrations/versions/0007_case_criteria.py`

- [ ] **Step 1: Write the migration**

```python
# services/workflow-engine/migrations/versions/0007_case_criteria.py
"""Create case_criteria table for Completeness agent gap list.

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "case_criteria",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "case_id",
            UUID(as_uuid=True),
            sa.ForeignKey("workflow_instances.case_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("criterion_id", sa.Text, nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column(
            "status",
            sa.Text,
            sa.CheckConstraint("status IN ('met', 'gap', 'unknown')", name="ck_case_criteria_status"),
            nullable=False,
            server_default="unknown",
        ),
        sa.Column("evidence", JSONB, nullable=True),
        sa.Column("citations", JSONB, nullable=True, server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("tenant_id != ''", name="ck_case_criteria_tenant_id_not_empty"),
    )
    op.create_index("ix_case_criteria_case_tenant", "case_criteria", ["case_id", "tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_case_criteria_case_tenant")
    op.drop_table("case_criteria")
```

- [ ] **Step 2: Run migration against the test database to verify it applies cleanly**

```bash
cd services/workflow-engine
WORKFLOW_DB_URL="postgresql://workflow:workflow_secret@localhost:5432/workflow" \
  python -m alembic upgrade head
```

Expected: `Running upgrade 0006 -> 0007` with no error.

- [ ] **Step 3: Verify downgrade works**

```bash
cd services/workflow-engine
WORKFLOW_DB_URL="postgresql://workflow:workflow_secret@localhost:5432/workflow" \
  python -m alembic downgrade 0006
```

Expected: no error. Then upgrade again to leave DB at head.

- [ ] **Step 4: Commit**

```bash
git add services/workflow-engine/migrations/versions/0007_case_criteria.py
git commit -m "feat(uc1): add case_criteria migration"
```

---

## Task 2: UC1 — `CriteriaRepository` and `GET /cases/{id}/criteria`

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/criteria/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/criteria/repository.py`
- Create: `services/workflow-engine/enstellar_workflow/criteria/router.py`
- Create: `services/workflow-engine/tests/test_criteria_api.py`

- [ ] **Step 1: Write the failing tests**

```python
# services/workflow-engine/tests/test_criteria_api.py
"""Integration tests for GET /cases/{id}/criteria (UC1)."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app
from tests.conftest import make_case


@pytest_asyncio.fixture
async def ac(db_dsn: str, monkeypatch) -> AsyncClient:
    monkeypatch.setenv(
        "WORKFLOW_DB_URL",
        db_dsn.replace("postgresql://", "postgresql+asyncpg://"),
    )
    import enstellar_workflow.config as cfg_mod
    import enstellar_workflow.db.connection as conn_mod
    cfg_mod._settings = None
    conn_mod._pool = None
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    await close_pool()
    conn_mod._pool = None


@pytest.mark.asyncio
async def test_get_criteria_empty_for_new_case(ac: AsyncClient) -> None:
    """New case has no criteria rows — returns 200 with empty list."""
    case = make_case()
    await ac.post("/cases", content=case.model_dump_json(), headers={"Content-Type": "application/json"})

    r = await ac.get(
        f"/cases/{case.case_id}/criteria",
        headers={"X-Tenant-Id": case.tenant_id},
    )
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_get_criteria_returns_seeded_rows(ac: AsyncClient, pg_pool) -> None:
    """Seeded criteria rows are returned correctly."""
    case = make_case()
    await ac.post("/cases", content=case.model_dump_json(), headers={"Content-Type": "application/json"})

    row_id = uuid.uuid4()
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO case_criteria (id, case_id, tenant_id, criterion_id, text, status, citations)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            """,
            row_id,
            case.case_id,
            case.tenant_id,
            "physician-attestation",
            "Medical necessity attestation from ordering physician",
            "gap",
            '["InterQual 2025 §3.4.1"]',
        )

    r = await ac.get(
        f"/cases/{case.case_id}/criteria",
        headers={"X-Tenant-Id": case.tenant_id},
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["criterion_id"] == "physician-attestation"
    assert body[0]["status"] == "gap"
    assert "InterQual 2025 §3.4.1" in body[0]["citations"]


@pytest.mark.asyncio
async def test_get_criteria_tenant_isolation(ac: AsyncClient, pg_pool) -> None:
    """Criteria from a different tenant are not returned."""
    case = make_case(tenant_id="tenant-A")
    await ac.post("/cases", content=case.model_dump_json(), headers={"Content-Type": "application/json"})

    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO case_criteria (id, case_id, tenant_id, criterion_id, text, status)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            uuid.uuid4(), case.case_id, "tenant-A", "C-01", "Criterion 1", "gap",
        )

    # Request with a different tenant_id — must return empty list, not 404
    r = await ac.get(
        f"/cases/{case.case_id}/criteria",
        headers={"X-Tenant-Id": "tenant-B"},
    )
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_get_criteria_missing_tenant_header_returns_422(ac: AsyncClient) -> None:
    r = await ac.get(f"/cases/{uuid.uuid4()}/criteria")
    assert r.status_code == 422
```

- [ ] **Step 2: Run tests to confirm they all fail (module not found)**

```bash
cd services/workflow-engine
uv run pytest tests/test_criteria_api.py -v
```

Expected: `ImportError` or `404` on the route — tests fail.

- [ ] **Step 3: Create the criteria module**

```python
# services/workflow-engine/enstellar_workflow/criteria/__init__.py
```

```python
# services/workflow-engine/enstellar_workflow/criteria/repository.py
from __future__ import annotations

import uuid
from typing import Any

import asyncpg


class CriteriaRepository:
    async def insert_many(
        self,
        conn: asyncpg.Connection,
        rows: list[dict[str, Any]],
    ) -> None:
        """Insert multiple criteria rows inside the caller's transaction."""
        for row in rows:
            await conn.execute(
                """
                INSERT INTO case_criteria
                    (id, case_id, tenant_id, criterion_id, text, status, evidence, citations)
                VALUES
                    ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
                """,
                uuid.uuid4(),
                row["case_id"],
                row["tenant_id"],
                row["criterion_id"],
                row["text"],
                row["status"],
                __import__("json").dumps(row.get("evidence")) if row.get("evidence") else None,
                __import__("json").dumps(row.get("citations", [])),
            )

    async def list_by_case(
        self,
        conn: asyncpg.Connection,
        case_id: uuid.UUID,
        tenant_id: str,
    ) -> list[dict[str, Any]]:
        """Return all criteria for a case, scoped to tenant_id."""
        rows = await conn.fetch(
            """
            SELECT id, criterion_id, text, status, evidence, citations, created_at
            FROM case_criteria
            WHERE case_id = $1 AND tenant_id = $2
            ORDER BY created_at ASC
            """,
            case_id,
            tenant_id,
        )
        return [
            {
                "id": str(r["id"]),
                "criterion_id": r["criterion_id"],
                "text": r["text"],
                "status": r["status"],
                "evidence": r["evidence"],
                "citations": r["citations"] if r["citations"] is not None else [],
            }
            for r in rows
        ]
```

```python
# services/workflow-engine/enstellar_workflow/criteria/router.py
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Header, HTTPException

from ..db.connection import get_pool
from .repository import CriteriaRepository

router = APIRouter(prefix="/cases", tags=["criteria"])


@router.get("/{case_id}/criteria", response_model=None)
async def get_criteria(
    case_id: uuid.UUID,
    tenant_id: str = Header(..., alias="X-Tenant-Id"),
) -> Any:
    """Return all criteria for a case, tenant-scoped."""
    pool = await get_pool()
    repo = CriteriaRepository()
    async with pool.acquire() as conn:
        return await repo.list_by_case(conn, case_id, tenant_id)
```

- [ ] **Step 4: Register the router in `main.py`**

Open `services/workflow-engine/enstellar_workflow/main.py` and add these lines:

```python
# Add this import alongside existing router imports:
from enstellar_workflow.criteria.router import router as criteria_router
from enstellar_workflow.suggestions.router import router as suggestions_router
```

And add after the existing `app.include_router(cases_router)` line:

```python
app.include_router(criteria_router)
app.include_router(suggestions_router)
```

(Leave `suggestions_router` registration in place — the file will be created in Task 6. The import will fail until then, so add both imports together in Task 6 if you prefer. Alternatively, add only the criteria import and registration here, and add suggestions in Task 6.)

**For this task, add only the criteria router:**

```python
# In main.py, add import:
from enstellar_workflow.criteria.router import router as criteria_router

# Add after existing include_router calls:
app.include_router(criteria_router)
```

- [ ] **Step 5: Run the tests**

```bash
cd services/workflow-engine
uv run pytest tests/test_criteria_api.py -v
```

Expected: All 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add \
  services/workflow-engine/enstellar_workflow/criteria/__init__.py \
  services/workflow-engine/enstellar_workflow/criteria/repository.py \
  services/workflow-engine/enstellar_workflow/criteria/router.py \
  services/workflow-engine/enstellar_workflow/main.py \
  services/workflow-engine/tests/test_criteria_api.py
git commit -m "feat(uc1): case_criteria repository and GET /cases/{id}/criteria"
```

---

## Task 3: US1 — `case_suggestions` Alembic migration

**Files:**
- Create: `services/workflow-engine/migrations/versions/0008_case_suggestions.py`

- [ ] **Step 1: Write the migration**

```python
# services/workflow-engine/migrations/versions/0008_case_suggestions.py
"""Create case_suggestions table for Triage agent suggestion output.

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "case_suggestions",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "case_id",
            UUID(as_uuid=True),
            sa.ForeignKey("workflow_instances.case_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("agent_id", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("confidence", sa.Numeric(precision=4, scale=3), nullable=False, server_default="0"),
        sa.Column("citations", JSONB, nullable=True, server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "status",
            sa.Text,
            sa.CheckConstraint(
                "status IN ('pending', 'accepted', 'rejected')",
                name="ck_case_suggestions_status",
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("reviewer_id", sa.Text, nullable=True),
        sa.Column("reviewed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("tenant_id != ''", name="ck_case_suggestions_tenant_id_not_empty"),
    )
    op.create_index("ix_case_suggestions_case_tenant", "case_suggestions", ["case_id", "tenant_id"])
    op.create_index("ix_case_suggestions_status", "case_suggestions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_case_suggestions_status")
    op.drop_index("ix_case_suggestions_case_tenant")
    op.drop_table("case_suggestions")
```

- [ ] **Step 2: Run migration to verify**

```bash
cd services/workflow-engine
WORKFLOW_DB_URL="postgresql://workflow:workflow_secret@localhost:5432/workflow" \
  python -m alembic upgrade head
```

Expected: `Running upgrade 0007 -> 0008` with no error.

- [ ] **Step 3: Commit**

```bash
git add services/workflow-engine/migrations/versions/0008_case_suggestions.py
git commit -m "feat(us1): add case_suggestions migration"
```

---

## Task 4: US1 — `SuggestionsRepository` and endpoints

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/suggestions/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/suggestions/repository.py`
- Create: `services/workflow-engine/enstellar_workflow/suggestions/router.py`
- Create: `services/workflow-engine/tests/test_suggestions_api.py`

- [ ] **Step 1: Write the failing tests**

```python
# services/workflow-engine/tests/test_suggestions_api.py
"""Integration tests for GET /cases/{id}/suggestions and POST action (US1)."""
from __future__ import annotations

import json
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app
from tests.conftest import make_case


@pytest_asyncio.fixture
async def ac(db_dsn: str, monkeypatch) -> AsyncClient:
    monkeypatch.setenv(
        "WORKFLOW_DB_URL",
        db_dsn.replace("postgresql://", "postgresql+asyncpg://"),
    )
    import enstellar_workflow.config as cfg_mod
    import enstellar_workflow.db.connection as conn_mod
    cfg_mod._settings = None
    conn_mod._pool = None
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    await close_pool()
    conn_mod._pool = None


def _seed_suggestion(case_id: uuid.UUID, tenant_id: str, suggestion_id: uuid.UUID | None = None) -> dict:
    return {
        "id": suggestion_id or uuid.uuid4(),
        "case_id": case_id,
        "tenant_id": tenant_id,
        "agent_id": "triage-v1",
        "title": "Suggested queue: expedited",
        "body": "Case is expedited urgency — route to expedited review queue.",
        "confidence": "0.88",
        "citations": json.dumps(["urgency=expedited", "lob=commercial"]),
    }


@pytest.mark.asyncio
async def test_get_suggestions_empty_for_new_case(ac: AsyncClient) -> None:
    case = make_case()
    await ac.post("/cases", content=case.model_dump_json(), headers={"Content-Type": "application/json"})
    r = await ac.get(f"/cases/{case.case_id}/suggestions", headers={"X-Tenant-Id": case.tenant_id})
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_get_suggestions_returns_seeded_rows(ac: AsyncClient, pg_pool) -> None:
    case = make_case()
    await ac.post("/cases", content=case.model_dump_json(), headers={"Content-Type": "application/json"})

    seed = _seed_suggestion(case.case_id, case.tenant_id)
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO case_suggestions
                (id, case_id, tenant_id, agent_id, title, body, confidence, citations)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            seed["id"], seed["case_id"], seed["tenant_id"],
            seed["agent_id"], seed["title"], seed["body"],
            seed["confidence"], seed["citations"],
        )

    r = await ac.get(f"/cases/{case.case_id}/suggestions", headers={"X-Tenant-Id": case.tenant_id})
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["title"] == "Suggested queue: expedited"
    assert body[0]["status"] == "pending"


@pytest.mark.asyncio
async def test_accept_suggestion_records_provenance(ac: AsyncClient, pg_pool) -> None:
    """POST action=accepted writes reviewer_id/reviewed_at and emits event."""
    case = make_case()
    await ac.post("/cases", content=case.model_dump_json(), headers={"Content-Type": "application/json"})

    sid = uuid.uuid4()
    seed = _seed_suggestion(case.case_id, case.tenant_id, suggestion_id=sid)
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO case_suggestions
                (id, case_id, tenant_id, agent_id, title, body, confidence, citations)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            seed["id"], seed["case_id"], seed["tenant_id"],
            seed["agent_id"], seed["title"], seed["body"],
            seed["confidence"], seed["citations"],
        )

    r = await ac.post(
        f"/cases/{case.case_id}/suggestions/{sid}/action",
        json={"action": "accepted", "reviewer_id": "reviewer-42"},
        headers={"X-Tenant-Id": case.tenant_id},
    )
    assert r.status_code == 200

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, reviewer_id, reviewed_at FROM case_suggestions WHERE id = $1", sid
        )
    assert row["status"] == "accepted"
    assert row["reviewer_id"] == "reviewer-42"
    assert row["reviewed_at"] is not None


@pytest.mark.asyncio
async def test_reject_suggestion_updates_status(ac: AsyncClient, pg_pool) -> None:
    case = make_case()
    await ac.post("/cases", content=case.model_dump_json(), headers={"Content-Type": "application/json"})

    sid = uuid.uuid4()
    seed = _seed_suggestion(case.case_id, case.tenant_id, suggestion_id=sid)
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO case_suggestions
                (id, case_id, tenant_id, agent_id, title, body, confidence, citations)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            seed["id"], seed["case_id"], seed["tenant_id"],
            seed["agent_id"], seed["title"], seed["body"],
            seed["confidence"], seed["citations"],
        )

    r = await ac.post(
        f"/cases/{case.case_id}/suggestions/{sid}/action",
        json={"action": "rejected", "reviewer_id": "reviewer-42"},
        headers={"X-Tenant-Id": case.tenant_id},
    )
    assert r.status_code == 200

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT status FROM case_suggestions WHERE id = $1", sid)
    assert row["status"] == "rejected"


@pytest.mark.asyncio
async def test_suggestion_action_404_for_unknown_id(ac: AsyncClient) -> None:
    case = make_case()
    await ac.post("/cases", content=case.model_dump_json(), headers={"Content-Type": "application/json"})
    r = await ac.post(
        f"/cases/{case.case_id}/suggestions/{uuid.uuid4()}/action",
        json={"action": "accepted", "reviewer_id": "r-1"},
        headers={"X-Tenant-Id": case.tenant_id},
    )
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd services/workflow-engine
uv run pytest tests/test_suggestions_api.py -v
```

Expected: All tests fail (module/route not found).

- [ ] **Step 3: Create the suggestions module**

```python
# services/workflow-engine/enstellar_workflow/suggestions/__init__.py
```

```python
# services/workflow-engine/enstellar_workflow/suggestions/repository.py
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg


class SuggestionsRepository:
    async def insert_many(
        self,
        conn: asyncpg.Connection,
        rows: list[dict[str, Any]],
    ) -> None:
        for row in rows:
            await conn.execute(
                """
                INSERT INTO case_suggestions
                    (id, case_id, tenant_id, agent_id, title, body, confidence, citations)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                """,
                uuid.uuid4(),
                row["case_id"],
                row["tenant_id"],
                row["agent_id"],
                row["title"],
                row["body"],
                row["confidence"],
                json.dumps(row.get("citations", [])),
            )

    async def list_by_case(
        self,
        conn: asyncpg.Connection,
        case_id: uuid.UUID,
        tenant_id: str,
    ) -> list[dict[str, Any]]:
        rows = await conn.fetch(
            """
            SELECT id, agent_id, title, body, confidence, citations,
                   status, reviewer_id, reviewed_at, created_at
            FROM case_suggestions
            WHERE case_id = $1 AND tenant_id = $2
            ORDER BY created_at ASC
            """,
            case_id,
            tenant_id,
        )
        return [
            {
                "id": str(r["id"]),
                "agent_id": r["agent_id"],
                "title": r["title"],
                "body": r["body"],
                "confidence": float(r["confidence"]),
                "citations": r["citations"] if r["citations"] is not None else [],
                "status": r["status"],
                "reviewer_id": r["reviewer_id"],
                "reviewed_at": r["reviewed_at"].isoformat() if r["reviewed_at"] else None,
            }
            for r in rows
        ]

    async def record_action(
        self,
        conn: asyncpg.Connection,
        suggestion_id: uuid.UUID,
        tenant_id: str,
        action: str,
        reviewer_id: str,
    ) -> bool:
        """Update status/reviewer_id/reviewed_at. Returns True if row was found."""
        now = datetime.now(timezone.utc)
        result = await conn.fetchrow(
            """
            UPDATE case_suggestions
            SET status = $1, reviewer_id = $2, reviewed_at = $3
            WHERE id = $4 AND tenant_id = $5
            RETURNING id
            """,
            action,
            reviewer_id,
            now,
            suggestion_id,
            tenant_id,
        )
        return result is not None
```

```python
# services/workflow-engine/enstellar_workflow/suggestions/router.py
from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..db.connection import get_pool
from ..outbox.publisher import OutboxPublisher
from ..outbox.models import OutboxEvent
from .repository import SuggestionsRepository

router = APIRouter(prefix="/cases", tags=["suggestions"])


class SuggestionActionBody(BaseModel):
    action: Literal["accepted", "rejected"]
    reviewer_id: str


@router.get("/{case_id}/suggestions", response_model=None)
async def get_suggestions(
    case_id: uuid.UUID,
    tenant_id: str = Header(..., alias="X-Tenant-Id"),
) -> Any:
    pool = await get_pool()
    repo = SuggestionsRepository()
    async with pool.acquire() as conn:
        return await repo.list_by_case(conn, case_id, tenant_id)


@router.post("/{case_id}/suggestions/{suggestion_id}/action", response_model=None)
async def suggestion_action(
    case_id: uuid.UUID,
    suggestion_id: uuid.UUID,
    body: SuggestionActionBody,
    tenant_id: str = Header(..., alias="X-Tenant-Id"),
) -> Any:
    pool = await get_pool()
    repo = SuggestionsRepository()
    async with pool.acquire() as conn:
        async with conn.transaction():
            found = await repo.record_action(
                conn,
                suggestion_id=suggestion_id,
                tenant_id=tenant_id,
                action=body.action,
                reviewer_id=body.reviewer_id,
            )
            if not found:
                raise HTTPException(status_code=404, detail="Suggestion not found")

            from enstellar_events import Actor, ActorType, EventEnvelope, Topics
            import uuid as _uuid
            from datetime import datetime, timezone

            event = EventEnvelope(
                event_id=_uuid.uuid4(),
                tenant_id=tenant_id,
                case_id=case_id,
                correlation_id=str(_uuid.uuid4()),
                type=Topics.AGENT_ASSIST_PRODUCED,
                occurred_at=datetime.now(timezone.utc),
                actor=Actor(id=body.reviewer_id, type=ActorType.USER),
                payload={
                    "suggestion_id": str(suggestion_id),
                    "action": body.action,
                    "reviewer_id": body.reviewer_id,
                    "event_subtype": "agent.suggestion.reviewed",
                },
                schema_version="1.0.0",
            )
            publisher = OutboxPublisher()
            await publisher.publish(conn, event)

    return {"suggestion_id": str(suggestion_id), "status": body.action}
```

- [ ] **Step 4: Register the suggestions router in `main.py`**

Add alongside the criteria import added in Task 2:

```python
# In main.py, add import:
from enstellar_workflow.suggestions.router import router as suggestions_router

# Add after criteria_router include:
app.include_router(suggestions_router)
```

- [ ] **Step 5: Run the tests**

```bash
cd services/workflow-engine
uv run pytest tests/test_suggestions_api.py -v
```

Expected: All 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add \
  services/workflow-engine/enstellar_workflow/suggestions/__init__.py \
  services/workflow-engine/enstellar_workflow/suggestions/repository.py \
  services/workflow-engine/enstellar_workflow/suggestions/router.py \
  services/workflow-engine/enstellar_workflow/main.py \
  services/workflow-engine/tests/test_suggestions_api.py
git commit -m "feat(us1): case_suggestions repository and GET/POST /cases/{id}/suggestions"
```

---

## Task 5: UC2/US2 — Config and `AGENT_ASSIST_FAILED` topic

**Files:**
- Modify: `packages/event-contracts/enstellar_events/topics.py`
- Modify: `services/workflow-engine/enstellar_workflow/config.py`

- [ ] **Step 1: Add `AGENT_ASSIST_FAILED` to Topics**

Open `packages/event-contracts/enstellar_events/topics.py`. Add at the end:

```python
    AGENT_ASSIST_FAILED = "agent.assist.failed"
```

After this the file ends with:
```python
    AGENT_ASSIST_PRODUCED = "agent.assist.produced"
    AGENT_ASSIST_FAILED = "agent.assist.failed"
```

- [ ] **Step 2: Add `agent_layer_url` to workflow-engine Settings**

Open `services/workflow-engine/enstellar_workflow/config.py`. Add the field:

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WORKFLOW_", case_sensitive=False)

    db_url: str = "postgresql+asyncpg://workflow:workflow_secret@localhost:5432/workflow"

    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_consumer_group: str = "workflow-engine"

    outbox_poll_interval_seconds: float = 1.0
    outbox_batch_size: int = 100

    agent_layer_url: str = "http://agent-layer:8000"

    jwks_uri: str | None = None
    oidc_issuer: str | None = None
    expected_audience: str | None = None
```

- [ ] **Step 3: Verify the import works**

```bash
cd services/workflow-engine
uv run python -c "from enstellar_workflow.config import get_settings; s = get_settings(); print(s.agent_layer_url)"
```

Expected: `http://agent-layer:8000`

- [ ] **Step 4: Commit**

```bash
git add \
  packages/event-contracts/enstellar_events/topics.py \
  services/workflow-engine/enstellar_workflow/config.py
git commit -m "feat(uc2): add agent_layer_url config and AGENT_ASSIST_FAILED topic"
```

---

## Task 6: UC2/US2 — `ClinicalReviewConsumer`

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/consumers/clinical_review_consumer.py`
- Modify: `services/workflow-engine/enstellar_workflow/consumers/__init__.py`
- Create: `services/workflow-engine/tests/test_clinical_review_consumer.py`

- [ ] **Step 1: Write the failing tests**

```python
# services/workflow-engine/tests/test_clinical_review_consumer.py
"""Tests for ClinicalReviewConsumer (UC2 + US2).

Covers:
- PHI minimization: AgentInput.case_summary must not contain PHI fields
- Criteria written on completeness agent success
- Suggestions written on triage agent success
- abstained=True: no rows written, agent.assist.failed event emitted
- Non-clinical_review transitions: no calls made
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

from enstellar_events import EventEnvelope, Topics
from tests.conftest import make_case


def _make_transition_event(case, to_state: str = "clinical_review") -> EventEnvelope:
    return EventEnvelope(
        event_id=uuid.uuid4(),
        tenant_id=case.tenant_id,
        case_id=case.case_id,
        correlation_id=f"corr-{uuid.uuid4()}",
        type=Topics.CASE_STATE_TRANSITIONED,
        occurred_at=datetime.now(timezone.utc),
        actor=MagicMock(id="system", type="system"),
        payload={"from_state": "completeness_check", "to_state": to_state},
        schema_version="1.0.0",
    )


def _completeness_output(abstained: bool = False) -> dict:
    if abstained:
        return {
            "agent_id": "completeness-v1",
            "tenant_id": "tenant-t08",
            "case_id": str(uuid.uuid4()),
            "confidence": 0.0,
            "citations": [],
            "abstained": True,
            "abstention_reason": "confidence_threshold: 0.30 < 0.40",
            "result": None,
            "provenance": {"model_name": "ollama/phi3", "input_hash": "abc", "timestamp": "2026-06-07T00:00:00Z"},
        }
    return {
        "agent_id": "completeness-v1",
        "tenant_id": "tenant-t08",
        "case_id": str(uuid.uuid4()),
        "confidence": 0.87,
        "citations": ["InterQual 2025 §3.4.1"],
        "abstained": False,
        "abstention_reason": None,
        "result": {
            "gaps": [
                {
                    "description": "Physician attestation letter missing",
                    "required_document_type": "physician-attestation",
                    "citation": "InterQual 2025 §3.4.1",
                }
            ],
            "rfi_draft": {"subject": "Missing docs", "body": "Please submit...", "required_documents": ["attestation"], "due_date_days": 14},
        },
        "provenance": {"model_name": "claude-sonnet-4-6", "input_hash": "abc", "timestamp": "2026-06-07T00:00:00Z"},
    }


def _triage_output(abstained: bool = False) -> dict:
    if abstained:
        return {
            "agent_id": "triage-v1",
            "tenant_id": "tenant-t08",
            "case_id": str(uuid.uuid4()),
            "confidence": 0.0,
            "citations": [],
            "abstained": True,
            "abstention_reason": "guardrail: adverse language detected",
            "result": None,
            "provenance": {"model_name": "ollama/phi3", "input_hash": "xyz", "timestamp": "2026-06-07T00:00:00Z"},
        }
    return {
        "agent_id": "triage-v1",
        "tenant_id": "tenant-t08",
        "case_id": str(uuid.uuid4()),
        "confidence": 0.88,
        "citations": ["urgency=standard", "lob=commercial"],
        "abstained": False,
        "abstention_reason": None,
        "result": {
            "suggested_queue": "expedited",
            "rationale": "Standard urgency commercial case — route to expedited queue per protocol.",
            "confidence": 0.88,
            "citations": ["urgency=standard", "lob=commercial"],
        },
        "provenance": {"model_name": "claude-sonnet-4-6", "input_hash": "xyz", "timestamp": "2026-06-07T00:00:00Z"},
    }


@pytest.mark.asyncio
async def test_phi_not_in_agent_input(pg_pool) -> None:
    """AgentInput.case_summary must not contain member_name, date_of_birth, or mrn."""
    from enstellar_workflow.consumers.clinical_review_consumer import _build_agent_input

    case = make_case()
    inp = _build_agent_input(case)

    summary_str = json.dumps(inp.case_summary)
    # PHI fields that must NOT appear
    assert case.member.first_name not in summary_str
    assert case.member.last_name not in summary_str
    assert str(case.member.date_of_birth) not in summary_str
    # Safe fields that MUST appear
    assert any(sl.procedure_code in summary_str for sl in case.service_lines)


@pytest.mark.asyncio
async def test_non_clinical_review_transition_is_ignored(pg_pool) -> None:
    """Events with to_state != clinical_review must not call the agent layer."""
    from enstellar_workflow.consumers.clinical_review_consumer import ClinicalReviewConsumer

    consumer = ClinicalReviewConsumer(pool=pg_pool)
    event = _make_transition_event(make_case(), to_state="md_review")

    with patch.object(consumer, "_call_completeness", new_callable=AsyncMock) as mock_comp:
        await consumer.handle(event)
        mock_comp.assert_not_called()


@pytest.mark.asyncio
async def test_criteria_written_on_completeness_success(pg_pool) -> None:
    """Completeness agent returning abstained=False writes criteria rows."""
    from enstellar_workflow.consumers.clinical_review_consumer import ClinicalReviewConsumer
    import httpx

    case = make_case()
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO workflow_instances
                (case_id, tenant_id, correlation_id, lob, status, urgency, workflow_def_version, case_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            case.case_id, case.tenant_id, case.correlation_id, case.lob,
            "clinical_review", case.urgency.value, "v1",
            case.model_dump_json(),
        )

    consumer = ClinicalReviewConsumer(pool=pg_pool)
    event = _make_transition_event(case)

    comp_output = _completeness_output(abstained=False)
    comp_output["case_id"] = str(case.case_id)
    comp_output["tenant_id"] = case.tenant_id

    triage_output = _triage_output(abstained=False)
    triage_output["case_id"] = str(case.case_id)
    triage_output["tenant_id"] = case.tenant_id

    async def mock_post(url, json=None, **kwargs):
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        if "completeness" in url:
            resp.json.return_value = comp_output
        else:
            resp.json.return_value = triage_output
        return resp

    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=mock_post)):
        await consumer.handle(event)

    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT criterion_id, status FROM case_criteria WHERE case_id = $1 AND tenant_id = $2",
            case.case_id, case.tenant_id,
        )
    assert len(rows) == 1
    assert rows[0]["criterion_id"] == "physician-attestation"
    assert rows[0]["status"] == "gap"


@pytest.mark.asyncio
async def test_no_rows_written_when_completeness_abstained(pg_pool) -> None:
    """abstained=True from completeness agent → zero criteria rows written."""
    from enstellar_workflow.consumers.clinical_review_consumer import ClinicalReviewConsumer

    case = make_case(tenant_id="tenant-abst")
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO workflow_instances
                (case_id, tenant_id, correlation_id, lob, status, urgency, workflow_def_version, case_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            case.case_id, case.tenant_id, case.correlation_id, case.lob,
            "clinical_review", case.urgency.value, "v1",
            case.model_dump_json(),
        )

    consumer = ClinicalReviewConsumer(pool=pg_pool)
    event = _make_transition_event(case)

    comp_output = _completeness_output(abstained=True)
    comp_output["case_id"] = str(case.case_id)
    comp_output["tenant_id"] = case.tenant_id

    triage_output = _triage_output(abstained=True)
    triage_output["case_id"] = str(case.case_id)
    triage_output["tenant_id"] = case.tenant_id

    async def mock_post(url, json=None, **kwargs):
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        if "completeness" in url:
            resp.json.return_value = comp_output
        else:
            resp.json.return_value = triage_output
        return resp

    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=mock_post)):
        await consumer.handle(event)

    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM case_criteria WHERE case_id = $1", case.case_id
        )
    assert count == 0
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd services/workflow-engine
uv run pytest tests/test_clinical_review_consumer.py -v
```

Expected: `ImportError` — module not found.

- [ ] **Step 3: Write the consumer**

```python
# services/workflow-engine/enstellar_workflow/consumers/clinical_review_consumer.py
"""ClinicalReviewConsumer — triggers Completeness and Triage agents on clinical_review entry.

Fires when case.state.transitioned events have to_state == 'clinical_review'.
Calls agent-layer /assist/completeness and /assist/triage with PHI-minimized payloads.
Writes results into case_criteria and case_suggestions tables.
Agent failure (abstained or HTTP error) never raises — the transition is not rolled back.

INVARIANT #2: No LLM call on the decision path.
INVARIANT #3: PHI minimized before agent call; case_summary contains only codes/urgency/lob.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg
import httpx

from canonical_model import Case
from enstellar_events import Actor, ActorType, EventEnvelope, Topics

from ..cases.repository import CaseRepository
from ..config import get_settings
from ..criteria.repository import CriteriaRepository
from ..kafka.consumer import IdempotentKafkaConsumer
from ..outbox.publisher import OutboxPublisher
from ..suggestions.repository import SuggestionsRepository

logger = logging.getLogger(__name__)

_CLINICAL_REVIEW_STATE = "clinical_review"


def _build_agent_input(case: Case) -> Any:
    """Build a PHI-minimized AgentInput dict for the agent-layer.

    Only procedure codes, diagnosis codes, urgency, and lob reach the model.
    Member name, DOB, MRN, and coverage identifiers are excluded.
    """
    from enstellar_agents.models import AgentInput  # type: ignore[import]

    case_summary = {
        "procedure_codes": [sl.procedure_code for sl in case.service_lines],
        "diagnosis_codes": [
            code for sl in case.service_lines for code in (sl.diagnosis_codes or [])
        ],
        "urgency": case.urgency.value,
        "lob": case.lob,
    }
    decisions = []
    if hasattr(case, "case_json") and isinstance(getattr(case, "case_json", None), dict):
        decisions = case.case_json.get("decisions", [])  # type: ignore[union-attr]

    doc_requirements: list[str] = []
    for d in decisions:
        reqs = (d.get("structured_trace") or {}).get("requirements", [])
        doc_requirements.extend(reqs)

    return AgentInput(
        tenant_id=case.tenant_id,
        case_id=case.case_id,
        case_summary=case_summary,
        doc_requirements=doc_requirements,
        correlation_id=str(uuid.uuid4()),
    )


class ClinicalReviewConsumer(IdempotentKafkaConsumer):
    """Triggers Completeness + Triage agents when a case enters clinical_review."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        super().__init__(
            pool,
            [Topics.CASE_STATE_TRANSITIONED],
            group_id="workflow-engine-clinical-review",
        )
        self._case_repo = CaseRepository()
        self._criteria_repo = CriteriaRepository()
        self._suggestions_repo = SuggestionsRepository()
        self._publisher = OutboxPublisher()

    async def handle(self, event: EventEnvelope) -> None:
        to_state = (event.payload or {}).get("to_state", "")
        if to_state != _CLINICAL_REVIEW_STATE:
            return

        if event.case_id is None:
            logger.error(
                "clinical_review_consumer_missing_case_id",
                extra={"tenant_id": event.tenant_id, "event_id": str(event.event_id)},
            )
            return

        async with self._pool.acquire() as conn:
            case = await self._case_repo.fetch_by_id(conn, event.case_id, event.tenant_id)

        if case is None:
            logger.error(
                "clinical_review_consumer_case_not_found",
                extra={"tenant_id": event.tenant_id, "case_id": str(event.case_id)},
            )
            return

        logger.info(
            "clinical_review_consumer_starting",
            extra={"tenant_id": case.tenant_id, "case_id": str(case.case_id)},
        )

        agent_input = _build_agent_input(case)
        settings = get_settings()

        await self._run_completeness(case, agent_input, settings.agent_layer_url, event.correlation_id)
        await self._run_triage(case, agent_input, settings.agent_layer_url, event.correlation_id)

    async def _run_completeness(
        self,
        case: Case,
        agent_input: Any,
        agent_layer_url: str,
        correlation_id: str,
    ) -> None:
        try:
            async with httpx.AsyncClient(timeout=30.0) as http:
                resp = await http.post(
                    f"{agent_layer_url}/assist/completeness",
                    json=agent_input.model_dump(mode="json"),
                )
                resp.raise_for_status()
                output = resp.json()
        except Exception as exc:
            logger.error(
                "clinical_review_consumer_completeness_error",
                extra={"tenant_id": case.tenant_id, "case_id": str(case.case_id), "error": str(exc)},
            )
            await self._emit_failed_event(case, "completeness-v1", str(exc), correlation_id)
            return

        if output.get("abstained"):
            logger.warning(
                "clinical_review_consumer_completeness_abstained",
                extra={
                    "tenant_id": case.tenant_id,
                    "case_id": str(case.case_id),
                    "reason": output.get("abstention_reason"),
                },
            )
            await self._emit_failed_event(
                case, output.get("agent_id", "completeness-v1"),
                output.get("abstention_reason", "abstained"), correlation_id,
            )
            return

        gaps = (output.get("result") or {}).get("gaps", [])
        rows = [
            {
                "case_id": case.case_id,
                "tenant_id": case.tenant_id,
                "criterion_id": g["required_document_type"],
                "text": g["description"],
                "status": "gap",
                "evidence": None,
                "citations": [g["citation"]] if g.get("citation") else [],
            }
            for g in gaps
        ]

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await self._criteria_repo.insert_many(conn, rows)
                await self._emit_produced_event(
                    conn, case, output, len(rows), "completeness", correlation_id
                )

        logger.info(
            "clinical_review_consumer_completeness_done",
            extra={"tenant_id": case.tenant_id, "case_id": str(case.case_id), "gap_count": len(rows)},
        )

    async def _run_triage(
        self,
        case: Case,
        agent_input: Any,
        agent_layer_url: str,
        correlation_id: str,
    ) -> None:
        try:
            async with httpx.AsyncClient(timeout=30.0) as http:
                resp = await http.post(
                    f"{agent_layer_url}/assist/triage",
                    json=agent_input.model_dump(mode="json"),
                )
                resp.raise_for_status()
                output = resp.json()
        except Exception as exc:
            logger.error(
                "clinical_review_consumer_triage_error",
                extra={"tenant_id": case.tenant_id, "case_id": str(case.case_id), "error": str(exc)},
            )
            await self._emit_failed_event(case, "triage-v1", str(exc), correlation_id)
            return

        if output.get("abstained"):
            logger.warning(
                "clinical_review_consumer_triage_abstained",
                extra={
                    "tenant_id": case.tenant_id,
                    "case_id": str(case.case_id),
                    "reason": output.get("abstention_reason"),
                },
            )
            await self._emit_failed_event(
                case, output.get("agent_id", "triage-v1"),
                output.get("abstention_reason", "abstained"), correlation_id,
            )
            return

        result = output.get("result") or {}
        suggested_queue = result.get("suggested_queue", "unknown")
        rationale = result.get("rationale", "")

        row = {
            "case_id": case.case_id,
            "tenant_id": case.tenant_id,
            "agent_id": output.get("agent_id", "triage-v1"),
            "title": f"Suggested queue: {suggested_queue}",
            "body": rationale,
            "confidence": float(output.get("confidence", 0.0)),
            "citations": output.get("citations", []),
        }

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await self._suggestions_repo.insert_many(conn, [row])
                await self._emit_produced_event(
                    conn, case, output, 1, "triage", correlation_id
                )

        logger.info(
            "clinical_review_consumer_triage_done",
            extra={"tenant_id": case.tenant_id, "case_id": str(case.case_id), "queue": suggested_queue},
        )

    async def _emit_produced_event(
        self,
        conn: asyncpg.Connection,
        case: Case,
        output: dict,
        output_count: int,
        agent_type: str,
        correlation_id: str,
    ) -> None:
        provenance = output.get("provenance", {})
        event = EventEnvelope(
            event_id=uuid.uuid4(),
            tenant_id=case.tenant_id,
            case_id=case.case_id,
            correlation_id=correlation_id,
            type=Topics.AGENT_ASSIST_PRODUCED,
            occurred_at=datetime.now(timezone.utc),
            actor=Actor(id=output.get("agent_id", f"{agent_type}-v1"), type=ActorType.SERVICE),
            payload={
                "agent_id": output.get("agent_id"),
                "agent_type": agent_type,
                "output_count": output_count,
                **provenance,
            },
            schema_version="1.0.0",
        )
        await self._publisher.publish(conn, event)

    async def _emit_failed_event(
        self,
        case: Case,
        agent_id: str,
        reason: str,
        correlation_id: str,
    ) -> None:
        try:
            async with self._pool.acquire() as conn:
                async with conn.transaction():
                    event = EventEnvelope(
                        event_id=uuid.uuid4(),
                        tenant_id=case.tenant_id,
                        case_id=case.case_id,
                        correlation_id=correlation_id,
                        type=Topics.AGENT_ASSIST_FAILED,
                        occurred_at=datetime.now(timezone.utc),
                        actor=Actor(id=agent_id, type=ActorType.SERVICE),
                        payload={"agent_id": agent_id, "reason": reason},
                        schema_version="1.0.0",
                    )
                    await self._publisher.publish(conn, event)
        except Exception as exc:
            logger.error("failed to emit agent.assist.failed event: %s", exc)
```

- [ ] **Step 4: Update `consumers/__init__.py`**

```python
# services/workflow-engine/enstellar_workflow/consumers/__init__.py
"""Kafka consumers for the workflow engine."""
from .auto_determination_consumer import AutoDeterminationConsumer
from .clinical_review_consumer import ClinicalReviewConsumer
from .intake_consumer import IntakeConsumer
from .rfi_response_consumer import RfiResponseConsumer

__all__ = [
    "AutoDeterminationConsumer",
    "ClinicalReviewConsumer",
    "IntakeConsumer",
    "RfiResponseConsumer",
]
```

- [ ] **Step 5: Run the tests**

```bash
cd services/workflow-engine
uv run pytest tests/test_clinical_review_consumer.py -v
```

Expected: All 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add \
  services/workflow-engine/enstellar_workflow/consumers/clinical_review_consumer.py \
  services/workflow-engine/enstellar_workflow/consumers/__init__.py \
  services/workflow-engine/tests/test_clinical_review_consumer.py
git commit -m "feat(uc2/us2): ClinicalReviewConsumer triggers Completeness and Triage agents"
```

---

## Task 7: Wire `ClinicalReviewConsumer` into `main.py` lifespan

**Files:**
- Modify: `services/workflow-engine/enstellar_workflow/main.py`

- [ ] **Step 1: Update the lifespan to start the clinical_review consumer**

Replace the `lifespan` function in `main.py` with:

```python
from enstellar_workflow.consumers import AutoDeterminationConsumer, ClinicalReviewConsumer

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    if settings.jwks_uri and settings.oidc_issuer:
        jwt_validator = JWTValidator(
            jwks_uri=settings.jwks_uri,
            issuer=settings.oidc_issuer,
            audience=settings.expected_audience,
        )
        validate_jwt_config(jwt_validator)
        app.state.jwt_validator = jwt_validator
        logger.info("JWT validator configured (issuer=%s)", settings.oidc_issuer)
    else:
        logger.warning(
            "WORKFLOW_JWKS_URI / WORKFLOW_OIDC_ISSUER not set — "
            "JWT validation is disabled; set these in production"
        )

    db_url = settings.db_url.replace("postgresql+asyncpg://", "postgresql://")
    pool = await asyncpg.create_pool(db_url, min_size=2, max_size=10)
    digicore = DigiCoreClient()

    auto_consumer = AutoDeterminationConsumer(pool=pool, digicore=digicore)
    clinical_review_consumer = ClinicalReviewConsumer(pool=pool)

    auto_task = asyncio.create_task(auto_consumer.run(), name="auto-determination-consumer")
    cr_task = asyncio.create_task(clinical_review_consumer.run(), name="clinical-review-consumer")
    logger.info("AutoDeterminationConsumer and ClinicalReviewConsumer started")

    try:
        yield
    finally:
        auto_task.cancel()
        cr_task.cancel()
        for task in [auto_task, cr_task]:
            try:
                await task
            except asyncio.CancelledError:
                pass
        await pool.close()
```

- [ ] **Step 2: Run the full test suite to check nothing regressed**

```bash
cd services/workflow-engine
uv run pytest tests/ -v --ignore=tests/test_clinical_review_consumer.py -x
```

Expected: All existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add services/workflow-engine/enstellar_workflow/main.py
git commit -m "feat: register ClinicalReviewConsumer in lifespan"
```

---

## Task 8: BFF — `WorkflowClient` methods, models, and UC3/US3 routes

**Files:**
- Modify: `services/portal-bff/enstellar_bff/clients/workflow.py`
- Modify: `services/portal-bff/enstellar_bff/models.py`
- Modify: `services/portal-bff/enstellar_bff/routers/cases.py`
- Create: `services/portal-bff/tests/test_criteria.py`
- Create: `services/portal-bff/tests/test_suggestions.py`

- [ ] **Step 1: Write the failing BFF tests**

```python
# services/portal-bff/tests/test_criteria.py
"""Tests for GET /bff/cases/{id}/criteria (UC3)."""
from __future__ import annotations

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

import enstellar_bff.auth as auth_module
from enstellar_bff.main import app

CASE_ID = "00000000-0000-0000-0000-000000000088"
FIXED_PRINCIPAL = {"tenant_id": "tenant-abc", "roles": ["reviewer"], "sub": "user-001"}
WF_CRITERIA_URL = f"http://workflow-engine:8000/cases/{CASE_ID}/criteria"


@pytest.fixture(autouse=True)
def bypass_auth(monkeypatch):
    app.dependency_overrides[auth_module.require_reviewer] = lambda: FIXED_PRINCIPAL
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
@respx.mock
async def test_get_criteria_proxies_workflow_response() -> None:
    criteria_data = [
        {"id": "crit-1", "criterion_id": "physician-attestation",
         "text": "Attestation required", "status": "gap",
         "evidence": None, "citations": ["InterQual 2025 §3.4.1"]}
    ]
    respx.get(WF_CRITERIA_URL).mock(return_value=Response(200, json=criteria_data))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/bff/cases/{CASE_ID}/criteria")

    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["criterion_id"] == "physician-attestation"
    assert body[0]["status"] == "gap"


@pytest.mark.asyncio
@respx.mock
async def test_get_criteria_empty_list() -> None:
    respx.get(WF_CRITERIA_URL).mock(return_value=Response(200, json=[]))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/bff/cases/{CASE_ID}/criteria")

    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
@respx.mock
async def test_get_criteria_forwards_404() -> None:
    respx.get(WF_CRITERIA_URL).mock(return_value=Response(404, json={"detail": "not found"}))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/bff/cases/{CASE_ID}/criteria")

    assert r.status_code == 404
```

```python
# services/portal-bff/tests/test_suggestions.py
"""Tests for GET/POST /bff/cases/{id}/suggestions (US3)."""
from __future__ import annotations

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

import enstellar_bff.auth as auth_module
from enstellar_bff.main import app

CASE_ID = "00000000-0000-0000-0000-000000000077"
SID = "00000000-0000-0000-0000-000000000055"
FIXED_PRINCIPAL = {"tenant_id": "tenant-abc", "roles": ["reviewer"], "sub": "user-001"}
WF_SUGGESTIONS_URL = f"http://workflow-engine:8000/cases/{CASE_ID}/suggestions"
WF_ACTION_URL = f"http://workflow-engine:8000/cases/{CASE_ID}/suggestions/{SID}/action"


@pytest.fixture(autouse=True)
def bypass_auth(monkeypatch):
    app.dependency_overrides[auth_module.require_reviewer] = lambda: FIXED_PRINCIPAL
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
@respx.mock
async def test_get_suggestions_proxies_workflow_response() -> None:
    data = [{"id": SID, "agent_id": "triage-v1", "title": "Suggested queue: expedited",
             "body": "Route to expedited.", "confidence": 0.88,
             "citations": ["urgency=standard"], "status": "pending",
             "reviewer_id": None, "reviewed_at": None}]
    respx.get(WF_SUGGESTIONS_URL).mock(return_value=Response(200, json=data))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/bff/cases/{CASE_ID}/suggestions")

    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["status"] == "pending"


@pytest.mark.asyncio
@respx.mock
async def test_post_suggestion_action_accept() -> None:
    respx.post(WF_ACTION_URL).mock(
        return_value=Response(200, json={"suggestion_id": SID, "status": "accepted"})
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/suggestions/{SID}/action",
            json={"action": "accepted"},
        )

    assert r.status_code == 200
    sent = respx.calls[-1].request
    import json
    body = json.loads(sent.content)
    assert body["action"] == "accepted"
    assert body["reviewer_id"] == "user-001"  # taken from auth token sub


@pytest.mark.asyncio
@respx.mock
async def test_get_suggestions_forwards_404() -> None:
    respx.get(WF_SUGGESTIONS_URL).mock(return_value=Response(404))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/bff/cases/{CASE_ID}/suggestions")

    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd services/portal-bff
uv run pytest tests/test_criteria.py tests/test_suggestions.py -v
```

Expected: 404 on routes — tests fail.

- [ ] **Step 3: Add models to `models.py`**

Open `services/portal-bff/enstellar_bff/models.py` and add at the end:

```python
class CriterionItem(BaseModel):
    id: str
    criterion_id: str
    text: str
    status: Literal["met", "gap", "unknown"]
    evidence: dict | None = None
    citations: list[str] = []


class SuggestionItem(BaseModel):
    id: str
    agent_id: str
    title: str
    body: str
    confidence: float
    citations: list[str] = []
    status: Literal["pending", "accepted", "rejected"]
    reviewer_id: str | None = None
    reviewed_at: str | None = None


class SuggestionActionRequest(BaseModel):
    action: Literal["accepted", "rejected"]
```

- [ ] **Step 4: Add methods to `WorkflowClient`**

Open `services/portal-bff/enstellar_bff/clients/workflow.py` and add:

```python
    async def criteria(self, case_id: str, tenant_id: str) -> list[dict]:
        r = await self._http.get(
            f"/cases/{case_id}/criteria",
            headers={"X-Tenant-Id": tenant_id},
        )
        r.raise_for_status()
        return r.json()

    async def suggestions(self, case_id: str, tenant_id: str) -> list[dict]:
        r = await self._http.get(
            f"/cases/{case_id}/suggestions",
            headers={"X-Tenant-Id": tenant_id},
        )
        r.raise_for_status()
        return r.json()

    async def suggestion_action(
        self,
        case_id: str,
        suggestion_id: str,
        tenant_id: str,
        action: str,
        reviewer_id: str,
    ) -> dict:
        r = await self._http.post(
            f"/cases/{case_id}/suggestions/{suggestion_id}/action",
            json={"action": action, "reviewer_id": reviewer_id},
            headers={"X-Tenant-Id": tenant_id},
        )
        r.raise_for_status()
        return r.json()
```

- [ ] **Step 5: Add routes to `routers/cases.py`**

Open `services/portal-bff/enstellar_bff/routers/cases.py` and add these routes:

```python
from enstellar_bff.models import (
    AdverseDecisionRequest,
    CaseDetail,
    CriterionItem,
    DecisionSubmission,
    SuggestionActionRequest,
    SuggestionItem,
)
```

(update the existing import from `enstellar_bff.models`)

Then add at the end of the file:

```python
@router.get("/cases/{case_id}/criteria", response_model=list[CriterionItem])
async def get_case_criteria(
    case_id: UUID,
    auth: dict = Depends(require_reviewer),
) -> list[CriterionItem]:
    try:
        data = await workflow_client.criteria(str(case_id), auth["tenant_id"])
    except Exception as exc:
        import httpx as _httpx
        if isinstance(exc, _httpx.HTTPStatusError) and exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Case not found")
        raise HTTPException(status_code=502, detail="Upstream error")
    return [CriterionItem(**item) for item in data]


@router.get("/cases/{case_id}/suggestions", response_model=list[SuggestionItem])
async def get_case_suggestions(
    case_id: UUID,
    auth: dict = Depends(require_reviewer),
) -> list[SuggestionItem]:
    try:
        data = await workflow_client.suggestions(str(case_id), auth["tenant_id"])
    except Exception as exc:
        import httpx as _httpx
        if isinstance(exc, _httpx.HTTPStatusError) and exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Case not found")
        raise HTTPException(status_code=502, detail="Upstream error")
    return [SuggestionItem(**item) for item in data]


@router.post("/cases/{case_id}/suggestions/{suggestion_id}/action")
async def post_suggestion_action(
    case_id: UUID,
    suggestion_id: UUID,
    body: SuggestionActionRequest,
    auth: dict = Depends(require_reviewer),
) -> dict:
    try:
        return await workflow_client.suggestion_action(
            case_id=str(case_id),
            suggestion_id=str(suggestion_id),
            tenant_id=auth["tenant_id"],
            action=body.action,
            reviewer_id=auth["sub"],
        )
    except Exception as exc:
        import httpx as _httpx
        if isinstance(exc, _httpx.HTTPStatusError) and exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Suggestion not found")
        raise HTTPException(status_code=502, detail="Upstream error")
```

- [ ] **Step 6: Run the tests**

```bash
cd services/portal-bff
uv run pytest tests/test_criteria.py tests/test_suggestions.py -v
```

Expected: All 7 tests pass.

- [ ] **Step 7: Run the full BFF test suite**

```bash
cd services/portal-bff
uv run pytest tests/ -v
```

Expected: All existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add \
  services/portal-bff/enstellar_bff/clients/workflow.py \
  services/portal-bff/enstellar_bff/models.py \
  services/portal-bff/enstellar_bff/routers/cases.py \
  services/portal-bff/tests/test_criteria.py \
  services/portal-bff/tests/test_suggestions.py
git commit -m "feat(uc3/us3): BFF criteria and suggestions proxy endpoints"
```

---

## Task 9: Frontend — types and API client (UC4/US4)

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/api/client.ts`

- [ ] **Step 1: Read the current types file**

Open `apps/web/src/types/index.ts` and append:

```typescript
export interface CriterionItem {
  id: string
  criterion_id: string
  text: string
  status: 'met' | 'gap' | 'unknown'
  evidence: { title: string; meta: string } | null
  citations: string[]
}

export interface SuggestionItem {
  id: string
  agent_id: string
  title: string
  body: string
  confidence: number
  citations: string[]
  status: 'pending' | 'accepted' | 'rejected'
  reviewer_id: string | null
  reviewed_at: string | null
}
```

- [ ] **Step 2: Add API functions to `client.ts`**

Open `apps/web/src/api/client.ts`. Add the import at the top:

```typescript
import type { AdverseOutcome, CaseDetail, CriterionItem, SuggestionItem, WorklistPage } from '../types'
```

Then add at the end of the file:

```typescript
export function getCriteria(caseId: string): Promise<CriterionItem[]> {
  return apiFetch<CriterionItem[]>(`/cases/${caseId}/criteria`)
}

export function getSuggestions(caseId: string): Promise<SuggestionItem[]> {
  return apiFetch<SuggestionItem[]>(`/cases/${caseId}/suggestions`)
}

export function postSuggestionAction(
  caseId: string,
  suggestionId: string,
  action: 'accepted' | 'rejected',
): Promise<unknown> {
  return apiFetch(`/cases/${caseId}/suggestions/${suggestionId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}
```

- [ ] **Step 3: Run TypeScript type check**

```bash
cd apps/web
npm run build -- --noEmit 2>/dev/null || npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/api/client.ts
git commit -m "feat(uc4/us4): add CriterionItem/SuggestionItem types and API client functions"
```

---

## Task 10: Frontend — CasePage criteria accordion (UC4)

**Files:**
- Modify: `apps/web/src/pages/CasePage.tsx`

- [ ] **Step 1: Update imports at the top of `CasePage.tsx`**

Find the existing import line:
```typescript
import { getCase, getWorklist } from '../api/client'
```

Replace with:
```typescript
import { getCase, getCriteria, getSuggestions, postSuggestionAction, getWorklist } from '../api/client'
import type { CriterionItem, SuggestionItem } from '../types'
```

- [ ] **Step 2: Replace the hardcoded `CRITERIA` constant**

Find the block starting with:
```typescript
// ── Static criteria data ──────────────────────────────────────────────────────

const CRITERIA = [
```

Delete everything from `// ── Static criteria data` down to and including the closing `]` of the `CRITERIA` array (lines 342–377 approximately), replacing it with nothing (the array is removed entirely — the `WorkColumn` will use a query hook instead).

- [ ] **Step 3: Update `WorkColumn` to use real criteria data**

Find the `WorkColumn` function signature:
```typescript
function WorkColumn({
  caseData,
  caseId,
  onDecisionComplete,
}: {
  caseData: CaseDetail
  caseId: string
  onDecisionComplete: () => void
}) {
  const [openCrit, setOpenCrit] = useState<Set<number>>(new Set())
```

Add the criteria query immediately after the `useState`:
```typescript
  const { data: criteria, isLoading: criteriaLoading } = useQuery({
    queryKey: ['criteria', caseId],
    queryFn: () => getCriteria(caseId),
    staleTime: 30_000,
  })
  const criteriaItems = criteria ?? []
```

- [ ] **Step 4: Replace the `{CRITERIA.map(...)}` render block**

Find the `{/* Criteria accordion cards */}` comment and the `{CRITERIA.map((c, idx) => {` call. Replace the entire map block (from `{CRITERIA.map(` to its closing `})}`) with:

```typescript
      {/* Criteria accordion cards */}
      {criteriaLoading && (
        <div style={{ color: 'var(--ink-mut)', fontSize: 13, padding: '12px 0' }}>
          Loading criteria…
        </div>
      )}
      {!criteriaLoading && criteriaItems.length === 0 && (
        <div style={{ color: 'var(--ink-mut)', fontSize: 13, padding: '12px 0' }}>
          No criteria data yet.
        </div>
      )}
      {criteriaItems.map((c: CriterionItem, idx: number) => {
        const isOpen = openCrit.has(idx)
        return (
          <div key={c.id} className={`en-crit${isOpen ? ' open' : ''}`}>
            <button
              className="en-crit-h"
              onClick={() => toggleCrit(idx)}
              aria-expanded={isOpen}
            >
              <span className={`en-stat-ic ${c.status}`}>
                {c.status === 'met' ? (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M4 8.5l2.5 2.5L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M8 5v4M8 11v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                )}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cnum">{c.criterion_id}</div>
                <div className="ctext">{c.text}</div>
              </div>
              <span className={`cstat ${c.status}`}>
                {c.status === 'met' ? 'Met' : c.status === 'gap' ? 'Gap' : 'Unknown'}
              </span>
              <svg className="chev" width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="en-crit-b">
              {c.citations.length > 0 && (
                <div className="en-ev-link">
                  <div>
                    <div className="el-t">Citations</div>
                    <div className="el-m">{c.citations.join(' · ')}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}
```

- [ ] **Step 5: TypeScript check**

```bash
cd apps/web
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/CasePage.tsx
git commit -m "feat(uc4): replace hardcoded CRITERIA stub with real criteria from API"
```

---

## Task 11: Frontend — AI suggestions column (US4)

**Files:**
- Modify: `apps/web/src/pages/CasePage.tsx`

- [ ] **Step 1: Add `useMutation` to imports**

Find the existing React/TanStack import:
```typescript
import { useQuery } from '@tanstack/react-query'
```

Replace with:
```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
```

- [ ] **Step 2: Remove the hardcoded `SUGGESTIONS` constant**

Find the block:
```typescript
// ── AI suggestions data ───────────────────────────────────────────────────────

const SUGGESTIONS = [
```

Delete everything from `// ── AI suggestions data` down to and including the closing `]` of the `SUGGESTIONS` array.

- [ ] **Step 3: Update `AiColumn` to use real suggestions**

Find the `AiColumn` function:
```typescript
function AiColumn() {
  const [doneSugs, setDoneSugs] = useState<Set<number>>(new Set())

  function markDone(i: number) {
    setDoneSugs((prev) => new Set([...prev, i]))
  }
```

Replace the entire `AiColumn` function with:

```typescript
function AiColumn({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient()

  const { data: suggestions, isLoading: sugsLoading } = useQuery({
    queryKey: ['suggestions', caseId],
    queryFn: () => getSuggestions(caseId),
    staleTime: 30_000,
  })

  const { mutate: recordAction, variables: pendingAction } = useMutation({
    mutationFn: ({ sid, action }: { sid: string; action: 'accepted' | 'rejected' }) =>
      postSuggestionAction(caseId, sid, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suggestions', caseId] })
    },
  })

  const sugItems = suggestions ?? []

  return (
    <aside className="en-col ai" aria-label="Governed AI advisory">
      <div className="en-ai-card">
        <div className="en-ai-card-h">
          <span className="at">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 5v3l2 1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            Governed AI · Advisory
          </span>
          <span className="en-advisory-chip">Advisory only</span>
        </div>
        <div className="en-ai-card-b">
          <div className="en-ai-sug">
            {sugsLoading && (
              <div style={{ color: 'var(--ink-mut)', fontSize: 13, padding: '8px 0' }}>
                Loading suggestions…
              </div>
            )}
            {!sugsLoading && sugItems.length === 0 && (
              <div style={{ color: 'var(--ink-mut)', fontSize: 13, padding: '8px 0' }}>
                No suggestions yet.
              </div>
            )}
            {sugItems.map((s: SuggestionItem) => {
              const isDone =
                s.status !== 'pending' ||
                pendingAction?.sid === s.id
              return (
                <div key={s.id} className={`en-sg${isDone ? ' done' : ''}`}>
                  <span className="sgi">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 2L14 13H2L8 2z" stroke="var(--amber)" strokeWidth="1.4" strokeLinejoin="round" />
                      <line x1="8" y1="7" x2="8" y2="9.5" stroke="var(--amber)" strokeWidth="1.4" strokeLinecap="round" />
                      <circle cx="8" cy="11.5" r=".7" fill="var(--amber)" />
                    </svg>
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="sgt">{s.title}</div>
                    <div className="sgm">{s.body}</div>
                    <div className="conf">Confidence {(s.confidence * 100).toFixed(0)}% · {s.citations.join(', ')}</div>
                    <div className="en-sg-acts">
                      <button
                        className="go"
                        disabled={isDone}
                        onClick={() => recordAction({ sid: s.id, action: 'accepted' })}
                      >
                        Accept
                      </button>
                      <button
                        disabled={isDone}
                        onClick={() => recordAction({ sid: s.id, action: 'rejected' })}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="en-ai-foot">
          <span className="en-boundary">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
              <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            Cannot issue a determination
          </span>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Update `AiColumn` usage in `CasePage` render**

Find where `AiColumn` is rendered:
```typescript
              <AiColumn />
```

Replace with:
```typescript
              <AiColumn caseId={caseId} />
```

- [ ] **Step 5: TypeScript check**

```bash
cd apps/web
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Run the dev server and manually verify**

```bash
cd apps/web
npm run dev
```

Open `http://localhost:5173` in a browser. Navigate to a case in `clinical_review`. Verify:
- Criteria section shows "Loading criteria…" then either real data or "No criteria data yet."
- AI suggestions section shows "Loading suggestions…" then real data or "No suggestions yet."
- Accept/Reject buttons on suggestion cards call the API and show the card as `done`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/CasePage.tsx
git commit -m "feat(us4): replace hardcoded SUGGESTIONS stub with real suggestions from API"
```

---

## Self-Review Checklist

Before finalising, verify:

- [ ] UC1 DoD: `GET /cases/{id}/criteria` returns `[]` for new case — covered by `test_get_criteria_empty_for_new_case`
- [ ] UC1 DoD: tenant isolation enforced — covered by `test_get_criteria_tenant_isolation`
- [ ] UC2 DoD: PHI not in model payload — covered by `test_phi_not_in_agent_input`
- [ ] UC2 DoD: `abstained=True` → no rows written — covered by `test_no_rows_written_when_completeness_abstained`
- [ ] UC2 DoD: rows written within 5s — covered by `test_criteria_written_on_completeness_success` (synchronous mock, not time-bounded, but integration stack tests would verify timing)
- [ ] UC3 DoD: 404 forwarded cleanly — covered by `test_get_criteria_forwards_404`
- [ ] US1 DoD: round-trip accept emits provenance event + updates `reviewed_at` — covered by `test_accept_suggestion_records_provenance`
- [ ] US1 DoD: 404 for unknown suggestion — covered by `test_suggestion_action_404_for_unknown_id`
- [ ] US2 DoD: `abstained=True` triage → no suggestion rows — covered by `test_no_rows_written_when_completeness_abstained` (both agents are mocked abstained)
- [ ] US3 DoD: reviewer_id from auth token, not request body — covered by `test_post_suggestion_action_accept` assertion on `body["reviewer_id"] == "user-001"`
- [ ] UC4/US4: TypeScript passes — verified by `npx tsc --noEmit` in Tasks 10 and 11

---

## Execution Options

Plan saved. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks

**2. Inline Execution** — execute tasks in this session using `executing-plans`, batch execution with checkpoints

Which approach?
