# Phase 2 Compliance Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six Phase 2 compliance gaps in the enstellar-workflow service: wire the notification template seed into migrations, add Mailhog for local SMTP dev, add Medicaid grievance SLA config, track AI advisor bypasses in the DB, expose a DLQ admin API, and close the OPA policy tracking item.

**Architecture:** All code changes are in `services/enstellar-workflow/`. Three Alembic migrations (0033, 0034, 0035) add data and one DDL column. One Python consumer function is extended. One new FastAPI router is added and mounted. One docker-compose change adds Mailhog.

**Tech Stack:** Python 3.12, FastAPI, asyncpg, Alembic, asyncpg-based transactional outbox (`simintero_outbox`), `simintero_authz` for JWT/role deps, PostgreSQL 16, Docker Compose.

## Global Constraints

- All DB queries MUST go through `tenant_transaction(pool, tenant_id)` from `simintero_tenant_context` — never pass `tenant_id` as a plain SQL param or open a raw connection.
- NEVER log request bodies or objects that might contain PHI. Use structured fields only.
- Cross-tenant admin reads (DLQ listing) use `SET LOCAL ROLE "sim_relay"` inside a transaction — exactly as `OutboxRelay._relay_batch()` does in `enstellar_workflow/outbox/relay.py`.
- All state changes emit via `outbox.publish()`. No direct Kafka calls.
- `revital_bypassed` MUST NOT appear on the canonical `Case` Pydantic model (`contracts/generated/python/canonical_model/case.py` — `extra='forbid'`). DB column only.
- New auth dependencies in `auth.py` MUST follow the `_authed_with_role()` pattern already in that file (lines 83–107).
- Migration filenames: `NNNN_<slug>.py`. Next unused: `0033`, `0034`, `0035`.
- `down_revision` of each new migration must chain correctly: 0033 → 0032, 0034 → 0033, 0035 → 0034.
- No new pip dependencies this sprint.
- Commit message format: `fix(enstellar): <description>` or `feat(enstellar): <description>`.

---

## File Structure

| Path | Action | What it does |
|---|---|---|
| `migrations/versions/0033_notification_templates_seed.py` | Create | Seeds 14 notification templates for `tenant-dev` |
| `migrations/versions/0034_grievance_sla_medicaid.py` | Create | Seeds grievance SLA rows for `tenant-dev` (all 3 LOBs) and `demo-tenant` medicaid |
| `migrations/versions/0035_revital_bypassed.py` | Create | Adds `revital_bypassed BOOLEAN NOT NULL DEFAULT FALSE` to `cases` table |
| `enstellar_workflow/consumers/clinical_review_consumer.py` | Modify | Sets `revital_bypassed = TRUE` inside `_emit_failed_event`'s existing transaction |
| `enstellar_workflow/auth.py` | Modify | Adds `SAAS_ADMIN_ROLE`, `require_saas_admin`, `AdminRequest` |
| `enstellar_workflow/admin/__init__.py` | Create | Empty package marker |
| `enstellar_workflow/admin/dlq_router.py` | Create | Three DLQ admin endpoints (list outbox DLQ, list consumer DLQ, reprocess) |
| `enstellar_workflow/main.py` | Modify | Import and mount DLQ router at `/admin/dlq` |
| `tests/test_dlq_admin.py` | Create | Tests for the three DLQ endpoints |
| `tests/test_revital_bypassed.py` | Create | Test that `_emit_failed_event` sets `revital_bypassed = TRUE` |
| `docker-compose.yml` | Modify | Add Mailhog service; add SMTP env vars to enstellar-workflow |
| `services/enstellar-workflow/.env.example` | Create | Documents SMTP env vars for production operators |
| `Payer_Platform/docs/superpowers/plans/deferred-tasks.md` | Modify | Mark 2.1/2.2/2.3/2.4/2.6/2.8 done; update counts |

All paths below are relative to `services/enstellar-workflow/` unless otherwise stated from the repo root.

---

### Task 1: Notification Template Seed Migration (2.1)

**Files:**
- Create: `services/enstellar-workflow/migrations/versions/0033_notification_templates_seed.py`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: `notification_templates` table has 15 rows for `tenant-dev` after `alembic upgrade head`

- [ ] **Step 1: Write the migration**

Create `services/enstellar-workflow/migrations/versions/0033_notification_templates_seed.py`:

```python
"""notification_templates_seed — wire seed file into migrations (P2.1)"""
from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # RLS requires sim.tenant_id to be set before the INSERT; SET LOCAL is
    # transaction-scoped so it auto-reverts at COMMIT and never leaks to the pool.
    op.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
    op.execute("""
        INSERT INTO notification_templates (tenant_id, lob, event_type, channel, subject_template, body_template)
        VALUES
          ('tenant-dev', NULL, 'approved',  'portal',
           'Prior Authorization Approved — Case {{ case_id }}',
           'Your prior authorization request (Case {{ case_id }}) has been approved on {{ decided_at }}.'),
          ('tenant-dev', NULL, 'denied',    'portal',
           'Determination on your request',
           'Your request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to appeal this determination. To file an appeal, contact your plan within {{ appeal_deadline_days }} days.'),
          ('tenant-dev', 'ma', 'denied',    'portal',
           'Medicare Advantage — Determination on your request',
           'Your Medicare Advantage request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to request a reconsideration. You must file your appeal within {{ appeal_deadline_days }} days of this notice.'),
          ('tenant-dev', NULL, 'approved',  'email',
           'PA Approved: {{ case_id }}',
           'Authorization approved. Reference: {{ case_id }}. Date: {{ decided_at }}.'),
          ('tenant-dev', NULL, 'partially_denied', 'portal',
           'Determination on your request',
           'Your request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to appeal this determination. To file an appeal, contact your plan within {{ appeal_deadline_days }} days.'),
          ('tenant-dev', NULL, 'adverse_modification', 'portal',
           'Determination on your request',
           'Your request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to appeal this determination. To file an appeal, contact your plan within {{ appeal_deadline_days }} days.'),
          ('tenant-dev', NULL, 'appeal_filed', 'portal',
           'Appeal update',
           'Your appeal (level {{ level }}) has been received and is under review.{% if reason %} Reason on file: {{ reason }}.{% endif %}'),
          ('tenant-dev', NULL, 'appeal_overturned', 'portal',
           'Appeal update',
           'Your appeal (level {{ level }}) was overturned — the prior determination is reversed.'),
          ('tenant-dev', NULL, 'appeal_upheld', 'portal',
           'Appeal update',
           'Your appeal (level {{ level }}) was upheld.'),
          ('tenant-dev', NULL, 'grievance_filed', 'portal',
           'Grievance received',
           'We received your grievance and will respond within {{ resolution_days }} days.'),
          ('tenant-dev', NULL, 'grievance_acknowledged', 'portal',
           'Grievance acknowledged',
           'Your grievance has been acknowledged and is being reviewed.'),
          ('tenant-dev', NULL, 'grievance_resolved', 'portal',
           'Grievance resolved',
           'Your grievance has been resolved.'),
          ('tenant-dev', NULL, 'grievance_acknowledgement_overdue', 'internal',
           'Grievance acknowledgement overdue',
           'Internal alert: grievance {{ grievance_id }} has passed its acknowledgement deadline.'),
          ('tenant-dev', NULL, 'grievance_resolution_overdue', 'internal',
           'Grievance resolution overdue',
           'Internal alert: grievance {{ grievance_id }} has passed its resolution deadline.')
        ON CONFLICT (tenant_id, COALESCE(lob,''), event_type, channel, version) DO NOTHING
    """)
    # PHI-permitted member letter template (channel='mail', member_phi=TRUE)
    op.execute("""
        INSERT INTO notification_templates (tenant_id, lob, event_type, channel, subject_template, body_template, member_phi)
        VALUES
          ('tenant-dev', NULL, 'denied', 'mail',
           'Notice of Adverse Determination',
           'Dear {{ member_name }} (DOB {{ dob }}, Member ID {{ member_id }}): your request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to appeal within {{ appeal_deadline_days }} days.',
           true)
        ON CONFLICT (tenant_id, COALESCE(lob,''), event_type, channel, version) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
    op.execute("DELETE FROM notification_templates WHERE tenant_id = 'tenant-dev'")
```

- [ ] **Step 2: Run the migration and verify row count**

```bash
cd services/enstellar-workflow
uv run alembic upgrade head
```

Expected: no errors. Then verify:

```bash
uv run python -c "
import asyncio, asyncpg
async def check():
    conn = await asyncpg.connect('postgresql://postgres:postgres@localhost:5432/enstellar')
    await conn.execute(\"SET LOCAL sim.tenant_id = 'tenant-dev'\")
    n = await conn.fetchval('SELECT COUNT(*) FROM notification_templates')
    print(f'rows: {n}')
    await conn.close()
asyncio.run(check())
"
```

Expected: `rows: 15`

If you don't have a local Postgres, skip this and use the test in Step 3.

- [ ] **Step 3: Write and run the migration idempotency test**

The test verifies that running the migration twice (via double-insert with `ON CONFLICT DO NOTHING`) doesn't raise. It runs against testcontainers Postgres with full migrations, so it exercises the real schema.

Create `services/enstellar-workflow/tests/test_notification_seed_migration.py`:

```python
"""Verify that migration 0033 seeds notification_templates idempotently."""
import pytest
import asyncpg


@pytest.mark.asyncio
async def test_notification_templates_seeded(db_dsn):
    """Alembic runs 0033; notification_templates must have ≥14 rows for tenant-dev."""
    conn = await asyncpg.connect(db_dsn)
    try:
        await conn.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_templates WHERE tenant_id = 'tenant-dev'"
        )
        assert count >= 14, f"Expected ≥14 templates, got {count}"
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_notification_seed_idempotent(db_dsn):
    """Running the seed INSERT again must not raise (ON CONFLICT DO NOTHING)."""
    conn = await asyncpg.connect(db_dsn)
    try:
        await conn.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
        # If ON CONFLICT is missing or wrong, this raises UniqueViolationError
        await conn.execute("""
            INSERT INTO notification_templates
              (tenant_id, lob, event_type, channel, subject_template, body_template)
            VALUES
              ('tenant-dev', NULL, 'approved', 'portal',
               'Prior Authorization Approved — Case {{ case_id }}',
               'Your prior authorization request (Case {{ case_id }}) has been approved on {{ decided_at }}.')
            ON CONFLICT (tenant_id, COALESCE(lob,''), event_type, channel, version) DO NOTHING
        """)
    finally:
        await conn.close()
```

Run:
```bash
cd services/enstellar-workflow
uv run pytest tests/test_notification_seed_migration.py -v
```

Expected:
```
tests/test_notification_seed_migration.py::test_notification_templates_seeded PASSED
tests/test_notification_seed_migration.py::test_notification_seed_idempotent PASSED
```

- [ ] **Step 4: Commit**

```bash
git add services/enstellar-workflow/migrations/versions/0033_notification_templates_seed.py \
        services/enstellar-workflow/tests/test_notification_seed_migration.py
git commit -m "fix(enstellar): seed notification_templates via migration 0033 (CMS P2.1)"
```

---

### Task 2: Mailhog + SMTP Env Docs (2.2)

**Files:**
- Modify: `docker-compose.yml` (repo root)
- Create: `services/enstellar-workflow/.env.example`

**Interfaces:**
- Consumes: nothing
- Produces: `mailhog` service in docker-compose; `WORKFLOW_SMTP_HOST`, `WORKFLOW_SMTP_PORT`, `WORKFLOW_SMTP_FROM_ADDR` env vars on the workflow service

- [ ] **Step 1: Add Mailhog to docker-compose**

Open `docker-compose.yml` at the repo root. Find the `services:` block. Add `mailhog` as a new service (add it after the last existing service definition, before any `volumes:` or `networks:` top-level keys):

```yaml
  mailhog:
    image: mailhog/mailhog:v1.0.1
    ports:
      - "8025:8025"
      - "1025:1025"
    healthcheck:
      test: ["CMD", "nc", "-z", "localhost", "1025"]
      interval: 10s
      timeout: 5s
      retries: 3
```

- [ ] **Step 2: Add SMTP env vars to the workflow service**

In the same `docker-compose.yml`, find the `enstellar-workflow:` service's `environment:` block. Add these three lines (keep alphabetical with existing vars):

```yaml
      WORKFLOW_SMTP_FROM_ADDR: noreply@simintero.local
      WORKFLOW_SMTP_HOST: mailhog
      WORKFLOW_SMTP_PORT: "1025"
```

Also add `mailhog` to the workflow service's `depends_on:` list so it doesn't start before Mailhog is healthy.

- [ ] **Step 3: Create the .env.example**

Create `services/enstellar-workflow/.env.example`:

```bash
# Enstellar Workflow — environment variable reference for production deployments.
# Copy this file to .env and fill in real values. Never commit .env.
# In docker-compose dev, these are set inline in docker-compose.yml.

# ── Database ────────────────────────────────────────────────────────────────
WORKFLOW_DB_URL=postgresql://sim_app:changeme@postgres:5432/enstellar

# ── Keycloak / OIDC ─────────────────────────────────────────────────────────
WORKFLOW_OIDC_ISSUER=http://keycloak:8080/realms/simintero
WORKFLOW_OIDC_AUDIENCE=enstellar-workflow
KEYCLOAK_JWKS_URL=http://keycloak:8080/realms/simintero/protocol/openid-connect/certs

# ── SMTP — required for adverse notice delivery (CMS compliance) ─────────────
# In local dev, Mailhog captures outbound mail (UI at http://localhost:8025).
WORKFLOW_SMTP_HOST=smtp.example.com
WORKFLOW_SMTP_PORT=587
WORKFLOW_SMTP_USERNAME=
WORKFLOW_SMTP_PASSWORD=
WORKFLOW_SMTP_FROM_ADDR=noreply@your-domain.com

# ── Kafka / Redpanda ─────────────────────────────────────────────────────────
KAFKA_BOOTSTRAP_SERVERS=redpanda:9092

# ── OPA ─────────────────────────────────────────────────────────────────────
OPA_URL=http://opa:8181
```

- [ ] **Step 4: Verify compose parses**

```bash
docker compose config --quiet
```

Expected: exits 0 with no output (config is valid). If you see an error about yaml indentation or unknown keys, fix it.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml services/enstellar-workflow/.env.example
git commit -m "fix(enstellar): add Mailhog for local SMTP dev; document SMTP env vars (P2.2)"
```

---

### Task 3: Close OPA Tracking Item (2.3)

**Files:**
- Modify: `Payer_Platform/docs/superpowers/plans/deferred-tasks.md`

**Interfaces:**
- Consumes: nothing
- Produces: deferred-tasks.md correctly shows 2.3 as resolved

- [ ] **Step 1: Update deferred-tasks.md**

Open `Payer_Platform/docs/superpowers/plans/deferred-tasks.md`. Find the Phase 2 table. Change the 2.3 row:

Before:
```
| 2.3 🔜 | Add OPA Rego bundle to repo (`opa-policies/enstellar/authz/adverse_action.rego`); configure OPA bundle load | Enstellar | Adverse gate is broken without this |
```

After:
```
| 2.3 ✅ | OPA adverse action Rego exists at `platform/services/opa-policies/sim/guards/adverse_action.rego`; loaded via directory bind-mount; path matches `sim/guards/adverse_action/allow` that the workflow engine calls — already done | Enstellar | — |
```

Also update the "Phase 2" header to reflect progress:

Before:
```
**Not started.** All 8 tasks deferred.
```

After:
```
**In progress.** 2.3 resolved (pre-existing); 2.1, 2.2, 2.4, 2.6, 2.8 targeted in 2026-06-30 sprint; 2.5, 2.7 deferred.
```

- [ ] **Step 2: Commit**

```bash
git add Payer_Platform/docs/superpowers/plans/deferred-tasks.md
git commit -m "docs: close P2.3 tracking — OPA adverse action Rego already exists and wired"
```

---

### Task 4: Grievance SLA for Medicaid (2.4)

**Files:**
- Create: `services/enstellar-workflow/migrations/versions/0034_grievance_sla_medicaid.py`

**Interfaces:**
- Consumes: migration 0033 (chained via `down_revision`)
- Produces: `workflow_config` has `domain='grievance'` rows for `tenant-dev` (all three LOBs) and `demo-tenant` medicaid

- [ ] **Step 1: Write the migration**

Create `services/enstellar-workflow/migrations/versions/0034_grievance_sla_medicaid.py`:

```python
"""grievance_sla_medicaid — seed grievance SLA config for tenant-dev and medicaid LOB (P2.4)"""
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None

# Medicaid managed care grievance timeframes (42 CFR 438.408):
# standard: acknowledgement within 3 business days, resolution within 90 days.
# expedited: acknowledgement within 24 hours, resolution within 3 days.
# VERIFY THESE VALUES WITH YOUR COMPLIANCE TEAM BEFORE PRODUCTION USE.
_MEDICAID_SLA = (
    '{"standard": {"acknowledgement_days": 3, "resolution_days": 90},'
    ' "expedited": {"acknowledgement_days": 1, "resolution_days": 3}}'
)
_COMMERCIAL_MA_SLA = (
    '{"standard": {"acknowledgement_days": 2, "resolution_days": 30},'
    ' "expedited": {"acknowledgement_days": 1, "resolution_days": 7}}'
)


def upgrade() -> None:
    # tenant-dev rows — commercial and ma (mirrors demo-tenant rows from 0024).
    op.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
    op.execute(f"""
        INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES
          ('tenant-dev', 'commercial', 'grievance', '{_COMMERCIAL_MA_SLA}'::jsonb),
          ('tenant-dev', 'ma',         'grievance', '{_COMMERCIAL_MA_SLA}'::jsonb),
          ('tenant-dev', 'medicaid',   'grievance', '{_MEDICAID_SLA}'::jsonb)
        ON CONFLICT (tenant_id, lob, domain) DO NOTHING
    """)

    # demo-tenant — add medicaid (commercial + ma already exist from 0024).
    op.execute("SET LOCAL sim.tenant_id = 'demo-tenant'")
    op.execute(f"""
        INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES
          ('demo-tenant', 'medicaid', 'grievance', '{_MEDICAID_SLA}'::jsonb)
        ON CONFLICT (tenant_id, lob, domain) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
    op.execute(
        "DELETE FROM workflow_config WHERE domain='grievance' AND tenant_id='tenant-dev'"
    )
    op.execute("SET LOCAL sim.tenant_id = 'demo-tenant'")
    op.execute(
        "DELETE FROM workflow_config WHERE domain='grievance' AND lob='medicaid' AND tenant_id='demo-tenant'"
    )
```

- [ ] **Step 2: Write and run the test**

Create `services/enstellar-workflow/tests/test_grievance_sla_medicaid.py`:

```python
"""Verify migration 0034 seeds medicaid grievance SLA config."""
import json
import pytest
import asyncpg


@pytest.mark.asyncio
async def test_tenant_dev_has_medicaid_grievance_sla(db_dsn):
    conn = await asyncpg.connect(db_dsn)
    try:
        await conn.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
        row = await conn.fetchrow(
            "SELECT config FROM workflow_config "
            "WHERE tenant_id='tenant-dev' AND lob='medicaid' AND domain='grievance'"
        )
        assert row is not None, "medicaid grievance SLA row missing for tenant-dev"
        cfg = json.loads(row["config"])
        assert cfg["standard"]["resolution_days"] == 90
        assert cfg["expedited"]["resolution_days"] == 3
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_tenant_dev_has_all_three_lobs(db_dsn):
    conn = await asyncpg.connect(db_dsn)
    try:
        await conn.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
        rows = await conn.fetch(
            "SELECT lob FROM workflow_config "
            "WHERE tenant_id='tenant-dev' AND domain='grievance' ORDER BY lob"
        )
        lobs = {r["lob"] for r in rows}
        assert lobs == {"commercial", "ma", "medicaid"}, f"Missing LOBs: {lobs}"
    finally:
        await conn.close()
```

Run:
```bash
cd services/enstellar-workflow
uv run pytest tests/test_grievance_sla_medicaid.py -v
```

Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add services/enstellar-workflow/migrations/versions/0034_grievance_sla_medicaid.py \
        services/enstellar-workflow/tests/test_grievance_sla_medicaid.py
git commit -m "fix(enstellar): seed grievance SLA for tenant-dev and Medicaid LOB (P2.4)"
```

---

### Task 5: AI Bypass Tracking — `revital_bypassed` (2.6)

**Files:**
- Create: `services/enstellar-workflow/migrations/versions/0035_revital_bypassed.py`
- Modify: `services/enstellar-workflow/enstellar_workflow/consumers/clinical_review_consumer.py`
- Create: `services/enstellar-workflow/tests/test_revital_bypassed.py`

**Interfaces:**
- Consumes: migration 0034 (chained via `down_revision`)
- Produces: `cases.revital_bypassed` column; `_emit_failed_event()` sets it to `TRUE` atomically with the outbox event

- [ ] **Step 1: Write the migration**

Create `services/enstellar-workflow/migrations/versions/0035_revital_bypassed.py`:

```python
"""revital_bypassed — track AI advisor bypass on case row (P2.6)"""
from alembic import op
import sqlalchemy as sa

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cases",
        sa.Column("revital_bypassed", sa.Boolean, nullable=False, server_default=sa.text("FALSE")),
    )


def downgrade() -> None:
    op.drop_column("cases", "revital_bypassed")
```

- [ ] **Step 2: Write the failing test**

Create `services/enstellar-workflow/tests/test_revital_bypassed.py`:

```python
"""Verify _emit_failed_event sets revital_bypassed=TRUE on the case row (P2.6)."""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch, call
import pytest
import asyncpg

from canonical_model import Case, Status
from tests.conftest import make_case
from enstellar_workflow.consumers.clinical_review_consumer import ClinicalReviewConsumer


@pytest.mark.asyncio
async def test_emit_failed_event_sets_revital_bypassed(db_dsn):
    """After _emit_failed_event(), cases.revital_bypassed must be TRUE for that case."""
    pool = await asyncpg.create_pool(db_dsn, min_size=1, max_size=2)

    # Insert a real case row so we can check revital_bypassed after.
    case = make_case(tenant_id="tenant-dev", status=Status.clinical_review)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
            await conn.execute(
                """
                INSERT INTO cases (case_id, tenant_id, correlation_id, status, lob,
                                   member_ref, procedure_code, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
                """,
                case.case_id,
                case.tenant_id,
                case.correlation_id,
                case.status.value,
                case.lob,
                case.member_ref,
                case.procedure_code,
            )

    # ClinicalReviewConsumer needs a pool and an outbox publisher.
    mock_outbox = AsyncMock()
    consumer = ClinicalReviewConsumer(pool=pool)
    consumer._outbox = mock_outbox

    await consumer._emit_failed_event(
        case=case,
        agent_id="revital",
        reason="RevitalUnavailableError: connection refused",
        correlation_id=str(uuid.uuid4()),
    )

    # Check the DB — revital_bypassed must be TRUE.
    async with pool.acquire() as conn:
        await conn.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
        row = await conn.fetchrow(
            "SELECT revital_bypassed FROM cases WHERE case_id = $1",
            case.case_id,
        )
    assert row is not None
    assert row["revital_bypassed"] is True, "revital_bypassed was not set to TRUE"

    # And the outbox event must have been published.
    mock_outbox.publish.assert_called_once()

    await pool.close()
```

Run to confirm it fails:
```bash
cd services/enstellar-workflow
uv run pytest tests/test_revital_bypassed.py -v
```

Expected: FAIL (either `revital_bypassed` column doesn't exist yet if migration hasn't run, or `revital_bypassed` is `False` after `_emit_failed_event`). After migration runs, it will be `False` — which is the failing assertion we want.

- [ ] **Step 3: Run the migration**

```bash
cd services/enstellar-workflow
uv run alembic upgrade head
```

Re-run test — it should still fail because the consumer doesn't set the flag yet.

- [ ] **Step 4: Update `_emit_failed_event` in the consumer**

Open `services/enstellar-workflow/enstellar_workflow/consumers/clinical_review_consumer.py`. Find `_emit_failed_event` (around line 275). The current body (lines 298–299) is:

```python
        async with tenant_transaction(self._pool, case.tenant_id) as conn:
            await self._outbox.publish(conn, event)
```

Change it to:

```python
        async with tenant_transaction(self._pool, case.tenant_id) as conn:
            await self._outbox.publish(conn, event)
            await conn.execute(
                "UPDATE cases SET revital_bypassed = TRUE WHERE case_id = $1",
                case.case_id,
            )
```

The two writes are in the same transaction — both commit or both roll back.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd services/enstellar-workflow
uv run pytest tests/test_revital_bypassed.py -v
```

Expected:
```
tests/test_revital_bypassed.py::test_emit_failed_event_sets_revital_bypassed PASSED
```

- [ ] **Step 6: Run the existing clinical review consumer tests to check for regressions**

```bash
cd services/enstellar-workflow
uv run pytest tests/test_clinical_review_consumer.py -v
```

Expected: all tests PASS. If any fail, check whether they mock the DB connection — any mock that doesn't have a `.execute()` method will now raise. Fix by adding `conn.execute = AsyncMock()` to the relevant mocks.

- [ ] **Step 7: Commit**

```bash
git add services/enstellar-workflow/migrations/versions/0035_revital_bypassed.py \
        services/enstellar-workflow/enstellar_workflow/consumers/clinical_review_consumer.py \
        services/enstellar-workflow/tests/test_revital_bypassed.py
git commit -m "feat(enstellar): track revital_bypassed on case row for NCQA AI governance (P2.6)"
```

---

### Task 6: DLQ Admin Endpoint (2.8)

**Files:**
- Modify: `services/enstellar-workflow/enstellar_workflow/auth.py`
- Create: `services/enstellar-workflow/enstellar_workflow/admin/__init__.py`
- Create: `services/enstellar-workflow/enstellar_workflow/admin/dlq_router.py`
- Modify: `services/enstellar-workflow/enstellar_workflow/main.py`
- Create: `services/enstellar-workflow/tests/test_dlq_admin.py`

**Interfaces:**
- Consumes: `auth.py` → `_authed_with_role`, `_bearer`, `ReviewerContext`, `jwt_validator` (all already defined in that file)
- Produces:
  - `auth.SAAS_ADMIN_ROLE: str = "saas_admin"`
  - `auth.require_saas_admin` — async dep, same signature as `require_reviewer`
  - `auth.AdminRequest` — `Annotated[ReviewerContext, Depends(require_saas_admin)]`
  - `GET /admin/dlq/outbox` → `{"events": [{"event_id", "topic", "tenant_id", "dlq_at", "dlq_reason", "retry_count"}]}`
  - `GET /admin/dlq/consumers` → `{"events": [{"event_id", "consumer_group", "topic", "error", "failed_at", "replayed_at"}]}`
  - `POST /admin/dlq/outbox/{event_id}/reprocess` → `{"requeued": true, "event_id": "..."}`

- [ ] **Step 1: Add `saas_admin` role dependency to `auth.py`**

Open `services/enstellar-workflow/enstellar_workflow/auth.py`. After the existing `GRIEVANCE_COORDINATOR_ROLE` constant (around line 68) and after the `require_grievance_coordinator` function and `GrievanceCoordinatorRequest` annotation (around line 148), append:

```python
# ---------------------------------------------------------------------------
# Saas admin role — platform-wide admin operations (DLQ, etc.)
# ---------------------------------------------------------------------------
SAAS_ADMIN_ROLE = "saas_admin"


async def require_saas_admin(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AsyncIterator[ReviewerContext]:
    """Enforce the ``saas_admin`` role; yield a scoped ``ReviewerContext``."""
    ctx = await _authed_with_role(creds, SAAS_ADMIN_ROLE)
    request.state.tenant_context = ctx
    with tenant_context(ctx):
        yield ctx


AdminRequest = Annotated[ReviewerContext, Depends(require_saas_admin)]
```

- [ ] **Step 2: Create the admin package**

Create `services/enstellar-workflow/enstellar_workflow/admin/__init__.py` — empty file:

```python
```

- [ ] **Step 3: Write the failing tests**

Create `services/enstellar-workflow/tests/test_dlq_admin.py`:

```python
"""Tests for the DLQ admin endpoints (P2.8)."""
from __future__ import annotations

import uuid
import pytest
import asyncpg
from httpx import AsyncClient, ASGITransport

from enstellar_workflow.main import app
from enstellar_workflow.auth import require_saas_admin
from simintero_authz import ForbiddenError
from simintero_tenant_context import TenantContext, set_context


# ---------------------------------------------------------------------------
# Fake auth overrides
# ---------------------------------------------------------------------------

async def _fake_saas_admin(request):
    ctx = TenantContext(tenant_id="tenant-dev", roles=["saas_admin"], principal_type="human")
    set_context(ctx)
    return ctx


async def _fake_non_admin(request):
    raise ForbiddenError("saas_admin role required")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dlq_client(admin: bool = True) -> AsyncClient:
    override = _fake_saas_admin if admin else _fake_non_admin
    app.dependency_overrides[require_saas_admin] = override
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed_dlq_row(db_dsn: str) -> str:
    """Insert a DLQ row into shared.outbox and return the event_id."""
    event_id = str(uuid.uuid4())
    conn = await asyncpg.connect(db_dsn)
    try:
        async with conn.transaction():
            await conn.execute('SET LOCAL ROLE "sim_relay"')
            await conn.execute(
                """
                INSERT INTO shared.outbox
                  (event_id, topic, key, envelope, tenant_id, dlq_at, dlq_reason, retry_count)
                VALUES ($1, 'test.topic', $1, '{}'::jsonb, 'tenant-dev',
                        now(), 'test error', 5)
                ON CONFLICT DO NOTHING
                """,
                event_id,
            )
    finally:
        await conn.close()
    return event_id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_outbox_dlq_returns_events(db_dsn):
    """GET /admin/dlq/outbox returns DLQ rows."""
    event_id = await _seed_dlq_row(db_dsn)
    async with _dlq_client(admin=True) as client:
        r = await client.get(
            "/admin/dlq/outbox",
            headers={"Authorization": "Bearer tenant-dev"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    ids = [e["event_id"] for e in body["events"]]
    assert event_id in ids


@pytest.mark.asyncio
async def test_list_outbox_dlq_requires_admin():
    """GET /admin/dlq/outbox returns 403 for non-admin JWT."""
    async with _dlq_client(admin=False) as client:
        r = await client.get(
            "/admin/dlq/outbox",
            headers={"Authorization": "Bearer tenant-dev"},
        )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_list_consumer_dlq_returns_events(db_dsn):
    """GET /admin/dlq/consumers returns rows from shared.consumer_dlq."""
    event_id = str(uuid.uuid4())
    conn = await asyncpg.connect(db_dsn)
    try:
        async with conn.transaction():
            await conn.execute('SET LOCAL ROLE "sim_relay"')
            await conn.execute(
                """
                INSERT INTO shared.consumer_dlq
                  (event_id, consumer_group, topic, error)
                VALUES ($1, 'test-group', 'test.topic', 'boom')
                ON CONFLICT DO NOTHING
                """,
                event_id,
            )
    finally:
        await conn.close()

    async with _dlq_client(admin=True) as client:
        r = await client.get(
            "/admin/dlq/consumers",
            headers={"Authorization": "Bearer tenant-dev"},
        )
    assert r.status_code == 200, r.text
    ids = [e["event_id"] for e in r.json()["events"]]
    assert event_id in ids


@pytest.mark.asyncio
async def test_reprocess_resets_dlq_columns(db_dsn):
    """POST /admin/dlq/outbox/{event_id}/reprocess clears dlq_at and published_at."""
    event_id = await _seed_dlq_row(db_dsn)
    async with _dlq_client(admin=True) as client:
        r = await client.post(
            f"/admin/dlq/outbox/{event_id}/reprocess",
            headers={"Authorization": "Bearer tenant-dev"},
        )
    assert r.status_code == 200, r.text
    assert r.json() == {"requeued": True, "event_id": event_id}

    # Confirm the row is back in the pickup queue (dlq_at NULL, published_at NULL).
    conn = await asyncpg.connect(db_dsn)
    try:
        async with conn.transaction():
            await conn.execute('SET LOCAL ROLE "sim_relay"')
            row = await conn.fetchrow(
                "SELECT dlq_at, published_at, retry_count FROM shared.outbox WHERE event_id = $1",
                event_id,
            )
        assert row["dlq_at"] is None
        assert row["published_at"] is None
        assert row["retry_count"] == 0
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_reprocess_nonexistent_returns_404():
    """POST /admin/dlq/outbox/{event_id}/reprocess on unknown event_id returns 404."""
    fake_id = str(uuid.uuid4())
    async with _dlq_client(admin=True) as client:
        r = await client.post(
            f"/admin/dlq/outbox/{fake_id}/reprocess",
            headers={"Authorization": "Bearer tenant-dev"},
        )
    assert r.status_code == 404
```

Run to confirm they fail:
```bash
cd services/enstellar-workflow
uv run pytest tests/test_dlq_admin.py -v
```

Expected: ImportError or 404 because the router doesn't exist yet.

- [ ] **Step 4: Create `dlq_router.py`**

Create `services/enstellar-workflow/enstellar_workflow/admin/dlq_router.py`:

```python
"""DLQ admin endpoints — list and reprocess dead-lettered outbox events (P2.8).

These endpoints bypass RLS (SET LOCAL ROLE sim_relay) because they must list
events across all tenants. They are gated by the `saas_admin` JWT role.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import AdminRequest
from ..config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/dlq", tags=["admin"])

# The BYPASSRLS role that can read shared.outbox across all tenants.
_RELAY_ROLE = "sim_relay"


async def _get_pool(request: Request):
    return request.app.state.pool


@router.get("/outbox")
async def list_outbox_dlq(
    auth: AdminRequest,
    pool=Depends(_get_pool),
) -> dict[str, Any]:
    """List up to 100 dead-lettered outbox events (all tenants)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(f'SET LOCAL ROLE "{_RELAY_ROLE}"')
            rows = await conn.fetch(
                """
                SELECT event_id, topic, tenant_id,
                       dlq_at, dlq_reason, retry_count
                FROM shared.outbox
                WHERE dlq_at IS NOT NULL
                ORDER BY dlq_at DESC
                LIMIT 100
                """
            )
    return {
        "events": [
            {
                "event_id": str(r["event_id"]),
                "topic": r["topic"],
                "tenant_id": r["tenant_id"],
                "dlq_at": r["dlq_at"].isoformat() if r["dlq_at"] else None,
                "dlq_reason": r["dlq_reason"],
                "retry_count": r["retry_count"],
            }
            for r in rows
        ]
    }


@router.get("/consumers")
async def list_consumer_dlq(
    auth: AdminRequest,
    pool=Depends(_get_pool),
) -> dict[str, Any]:
    """List up to 100 entries from shared.consumer_dlq (all tenants)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(f'SET LOCAL ROLE "{_RELAY_ROLE}"')
            rows = await conn.fetch(
                """
                SELECT event_id, consumer_group, topic,
                       error, failed_at, replayed_at
                FROM shared.consumer_dlq
                ORDER BY failed_at DESC
                LIMIT 100
                """
            )
    return {
        "events": [
            {
                "event_id": str(r["event_id"]),
                "consumer_group": r["consumer_group"],
                "topic": r["topic"],
                "error": r["error"],
                "failed_at": r["failed_at"].isoformat() if r["failed_at"] else None,
                "replayed_at": r["replayed_at"].isoformat() if r["replayed_at"] else None,
            }
            for r in rows
        ]
    }


@router.post("/outbox/{event_id}/reprocess")
async def reprocess_outbox_event(
    event_id: str,
    auth: AdminRequest,
    pool=Depends(_get_pool),
) -> dict[str, Any]:
    """Reset a DLQ'd outbox event so the relay picks it up again.

    Sets dlq_at=NULL, dlq_reason=NULL, retry_count=0, published_at=NULL.
    The relay's pickup query (WHERE published_at IS NULL AND dlq_at IS NULL)
    will then re-attempt delivery.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(f'SET LOCAL ROLE "{_RELAY_ROLE}"')
            result = await conn.execute(
                """
                UPDATE shared.outbox
                SET dlq_at = NULL,
                    dlq_reason = NULL,
                    retry_count = 0,
                    published_at = NULL
                WHERE event_id = $1
                  AND dlq_at IS NOT NULL
                """,
                event_id,
            )
    # asyncpg returns "UPDATE N" as a string; N=0 means not found or not in DLQ.
    updated = int(result.split()[-1])
    if updated == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Event {event_id} not found in outbox DLQ",
        )
    logger.info("dlq_reprocess event_id=%s actor=%s", event_id, auth.tenant_id)
    return {"requeued": True, "event_id": event_id}
```

- [ ] **Step 5: Mount the router in `main.py`**

Open `services/enstellar-workflow/enstellar_workflow/main.py`. After the existing router imports (around line 28–55), add:

```python
from enstellar_workflow.admin.dlq_router import router as dlq_admin_router
```

Then find where the other routers are included in the app (search for `app.include_router`). Add:

```python
app.include_router(dlq_admin_router)
```

alongside the other `app.include_router(...)` calls.

- [ ] **Step 6: Update conftest.py to add fake `require_saas_admin`**

Open `services/enstellar-workflow/tests/conftest.py`. After the existing `_fake_require_grievance_coordinator` function (around line 81), add:

```python
async def _fake_require_saas_admin(request: Request):
    """Test replacement for require_saas_admin."""
    token = request.headers.get("Authorization", "")[len("Bearer "):]
    ctx = ReviewerContext(
        tenant_id=token,
        sub="test-admin",
        roles=["saas_admin"],
        principal_type="human",
    )
    set_context(ctx)
    return ctx
```

In the `_install_fake_auth` fixture imports at the top of the file, add `require_saas_admin` to the import:

```python
from enstellar_workflow.auth import (
    ReviewerContext,
    require_appeals_assigner,
    require_auth,
    require_grievance_coordinator,
    require_reviewer,
    require_saas_admin,
)
```

In the `_install_fake_auth` fixture body, add:
```python
    app.dependency_overrides[require_saas_admin] = _fake_require_saas_admin
```

And in the `yield` cleanup:
```python
    app.dependency_overrides.pop(require_saas_admin, None)
```

- [ ] **Step 7: Run the tests**

```bash
cd services/enstellar-workflow
uv run pytest tests/test_dlq_admin.py -v
```

Expected:
```
tests/test_dlq_admin.py::test_list_outbox_dlq_returns_events PASSED
tests/test_dlq_admin.py::test_list_outbox_dlq_requires_admin PASSED
tests/test_dlq_admin.py::test_list_consumer_dlq_returns_events PASSED
tests/test_dlq_admin.py::test_reprocess_resets_dlq_columns PASSED
tests/test_dlq_admin.py::test_reprocess_nonexistent_returns_404 PASSED
```

If `test_list_outbox_dlq_requires_admin` fails with 200 instead of 403: the `_fake_non_admin` dependency isn't raising `ForbiddenError` correctly. Check that `from simintero_authz import ForbiddenError` is importable; it might be `HTTPException(status_code=403)` in your codebase — look at how other 403s are raised in tests.

- [ ] **Step 8: Run the full test suite to check for regressions**

```bash
cd services/enstellar-workflow
uv run pytest tests/ -v --tb=short -q
```

Expected: all previously-passing tests still PASS.

- [ ] **Step 9: Commit**

```bash
git add services/enstellar-workflow/enstellar_workflow/auth.py \
        services/enstellar-workflow/enstellar_workflow/admin/__init__.py \
        services/enstellar-workflow/enstellar_workflow/admin/dlq_router.py \
        services/enstellar-workflow/enstellar_workflow/main.py \
        services/enstellar-workflow/tests/conftest.py \
        services/enstellar-workflow/tests/test_dlq_admin.py
git commit -m "feat(enstellar): add DLQ admin list/reprocess endpoints (P2.8)"
```

---

### Task 7: Update Deferred Tasks Log

**Files:**
- Modify: `Payer_Platform/docs/superpowers/plans/deferred-tasks.md`

**Interfaces:**
- Consumes: all prior tasks complete
- Produces: deferred-tasks.md accurately reflects the state of Phase 2

- [ ] **Step 1: Update Phase 2 table rows**

Open `Payer_Platform/docs/superpowers/plans/deferred-tasks.md`. Remove the completed tasks from the Phase 2 deferred table — 2.1, 2.2, 2.4, 2.6, 2.8 are done. Leave 2.5 and 2.7 as ⏳.

Replace the entire Phase 2 section with:

```markdown
## Phase 2 — Compliance & Regulatory Blockers (partial ✅)

**Completed in 2026-06-30 sprint:** 2.1 (notification seed migration), 2.2 (Mailhog + env docs), 2.3 (OPA already existed), 2.4 (Medicaid SLA migration), 2.6 (revital_bypassed), 2.8 (DLQ admin endpoint)

| # | Task | Component | Why Deferred |
|---|---|---|---|
| 2.5 | Build IRO integration for L≥2 appeals: external IRO API stub + assignment flow + decision tracking | Enstellar | Multi-week feature; requires IRO vendor API contract |
| 2.7 | Pin-based appeal replay in Digicore: store `pins[]` at decision time, add VKAS `allow_non_active` path | Digicore | Multi-week feature; requires VKAS version pinning design |
```

- [ ] **Step 2: Update the quick-counts table**

Find the `## Quick counts` table at the bottom of the file. Update Phase 2 row:

Before:
```
| 2 — Compliance | 8 | 0 | 8 |
```

After:
```
| 2 — Compliance | 8 | 6 | 2 |
```

Update the **Total** row's Done column from `6` to `12`.

- [ ] **Step 3: Commit**

```bash
git add Payer_Platform/docs/superpowers/plans/deferred-tasks.md
git commit -m "docs: update deferred-tasks.md — Phase 2 sprint complete (6/8 tasks done)"
```

---

## Self-Review

**Spec coverage:**
- 2.1 notification seed → Task 1 ✅
- 2.2 SMTP / Mailhog → Task 2 ✅
- 2.3 OPA close → Task 3 ✅ (and Task 7 doc update)
- 2.4 Medicaid SLA → Task 4 ✅
- 2.6 revital_bypassed → Task 5 ✅
- 2.8 DLQ admin → Task 6 ✅
- deferred-tasks.md update → Task 7 ✅
- 2.5 / 2.7 out of scope — confirmed ✅

**Placeholder check:** No "TBD" or "TODO" in any step. All code blocks are complete.

**Type consistency:**
- `AdminRequest` defined in Task 6 Step 1 (`auth.py`), consumed in `dlq_router.py` Step 4 — consistent.
- `require_saas_admin` defined in `auth.py`, imported in `conftest.py` Step 6 — consistent.
- `_RELAY_ROLE = "sim_relay"` in `dlq_router.py` matches the actual PostgreSQL role name from `relay.py` — consistent.
- `revital_bypassed` column name used in migration (Task 5 Step 1), consumer (Task 5 Step 4), and test (Task 5 Step 2) — consistent.
- Migration chain: 0032 → 0033 → 0034 → 0035 — consistent with `down_revision` fields.
