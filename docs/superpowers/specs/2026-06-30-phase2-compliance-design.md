# Phase 2 Compliance Sprint — Design Spec

**Date:** 2026-06-30  
**Scope:** 5 code tasks + 1 doc close from the Phase 2 compliance backlog. Skipped: 2.5 (IRO integration) and 2.7 (pin-based appeal replay) — deferred to a later sprint.

---

## Tasks In Scope

| # | Task | Type |
|---|---|---|
| 2.1 | Notification template seed wired into migrations | Alembic migration |
| 2.2 | SMTP dev tooling (Mailhog) + env docs | docker-compose + `.env.example` |
| 2.3 | OPA adverse action Rego — close as already done | Doc only |
| 2.4 | Grievance SLA for Medicaid LOB | Alembic migration |
| 2.6 | AI bypass tracking (`revital_bypassed`) | Migration + Python |
| 2.8 | DLQ admin endpoint | Python (FastAPI router) |

---

## Task 2.1 — Notification Template Seed

### Problem
`db/seeds/notification_templates.sql` exists with 14 templates but is never executed automatically. A fresh deployment has an empty `notification_templates` table — adverse notices, RFI letters, and appeal acknowledgements will not send, which is a CMS compliance violation.

### Design
Create Alembic migration `0033_notification_templates_seed.py`. The migration calls `op.execute()` with:
1. `SET LOCAL sim.tenant_id = 'tenant-dev'` so RLS accepts the inserts (same pattern as `0024_grievances.py` line 46).
2. The full contents of `db/seeds/notification_templates.sql` inlined (or read via `Path(__file__).parent / '../../db/seeds/notification_templates.sql'`).

Use `ON CONFLICT (tenant_id, event_type, channel, lob, version) DO NOTHING` so re-running is idempotent (the unique constraint `uq_notification_templates_tenant_event_channel_version` already exists from migration `0006`).

Downgrade: `DELETE FROM notification_templates WHERE tenant_id = 'tenant-dev'` scoped to the seeded rows.

### Files
- `services/enstellar-workflow/migrations/versions/0033_notification_templates_seed.py` (new)

---

## Task 2.2 — SMTP Dev Tooling

### Problem
The SMTP send path is complete in code (`SmtpEmailSender` → `aiosmtplib` → `starttls` + login). Nothing in local dev captures outbound email, so test emails are silently dropped or fail with connection refused. Production operators have no documented env vars to set.

### Design

**docker-compose.yml** — add `mailhog` service:
```yaml
mailhog:
  image: mailhog/mailhog:v1.0.1
  ports:
    - "8025:8025"   # web UI
    - "1025:1025"   # SMTP
```

Set on the `enstellar-workflow` service env block:
```yaml
WORKFLOW_SMTP_HOST: mailhog
WORKFLOW_SMTP_PORT: "1025"
WORKFLOW_SMTP_FROM_ADDR: noreply@simintero.local
```

**`services/enstellar-workflow/.env.example`** (new file) — documents all `WORKFLOW_SMTP_*` vars with production guidance:
```
# SMTP — required for adverse notice delivery (CMS compliance)
WORKFLOW_SMTP_HOST=smtp.example.com
WORKFLOW_SMTP_PORT=587
WORKFLOW_SMTP_USERNAME=
WORKFLOW_SMTP_PASSWORD=
WORKFLOW_SMTP_FROM_ADDR=noreply@your-domain.com
```

No code changes needed — the sender is already wired end-to-end.

### Files
- `docker-compose.yml` (modified — add mailhog service + workflow SMTP env)
- `services/enstellar-workflow/.env.example` (new)

---

## Task 2.3 — OPA Adverse Action Rego (Close as Done)

### Finding
The audit flagged `enstellar/authz/adverse_action.rego` as absent. Investigation shows the policy exists at `platform/services/opa-policies/sim/guards/adverse_action.rego` (package `sim.guards.adverse_action`, rule `allow`). OPA loads via directory bind-mount at startup. The workflow engine calls `sim/guards/adverse_action/allow` — path matches exactly.

### Action
Update `deferred-tasks.md` to mark 2.3 as resolved. No code change.

---

## Task 2.4 — Grievance SLA for Medicaid LOB

### Problem
`0024_grievances.py` seeds `domain='grievance'` SLA config only for `demo-tenant` + `commercial`/`ma` LOBs. `tenant-dev` has no grievance SLA rows at all. `ConfigService.resolve_grievance_sla()` falls back to a hardcoded default when the row is missing, which silently produces wrong deadlines and will raise once the hardcoded default is removed.

### Design
Create Alembic migration `0034_grievance_sla_medicaid.py` that inserts:
- `tenant-dev` × `commercial` — standard (ack 2d / resolve 30d), expedited (ack 1d / resolve 7d)
- `tenant-dev` × `ma` — same timeframes
- `tenant-dev` × `medicaid` — standard (ack 3d / resolve 90d — representative Medicaid managed care values; **verify with compliance before production**), expedited (ack 1d / resolve 3d)
- `demo-tenant` × `medicaid` — same

Uses `SET LOCAL sim.tenant_id` before each tenant's inserts (same pattern as `0024`). `ON CONFLICT DO NOTHING` for idempotency.

Downgrade: `DELETE FROM workflow_config WHERE domain='grievance' AND lob='medicaid'` + delete `tenant-dev` commercial/ma rows.

### Files
- `services/enstellar-workflow/migrations/versions/0034_grievance_sla_medicaid.py` (new)

---

## Task 2.6 — AI Bypass Tracking

### Problem
When Revital is unavailable, `ClinicalReviewConsumer._emit_failed()` fires an `AGENT_ASSIST_FAILED` outbox event and the case proceeds. There is no persisted record on the case row that AI was bypassed. NCQA AI governance attestation requires tracking how often the AI advisory is bypassed.

### Design

**Migration `0035_revital_bypassed.py`:**
```sql
ALTER TABLE cases ADD COLUMN revital_bypassed BOOLEAN NOT NULL DEFAULT FALSE;
```
No RLS change needed — column inherits the existing `tenant_isolation` policy on `cases`.

**`ClinicalReviewConsumer` update** (`consumers/clinical_review_consumer.py`):
`_emit_failed_event` (line 275) opens its own `tenant_transaction` block at line 298 and calls `self._outbox.publish(conn, event)` on that connection. Add the UPDATE on the **same `conn`**, after the publish, inside the same `async with tenant_transaction(...)` block:
```python
async with tenant_transaction(self._pool, case.tenant_id) as conn:
    await self._outbox.publish(conn, event)
    await conn.execute(
        "UPDATE cases SET revital_bypassed = TRUE WHERE case_id = $1",
        case.case_id,
    )
```
Both writes are atomic — if either fails, neither commits.

No changes to the canonical `Case` Pydantic model — this is a workflow-internal DB field only.

### Files
- `services/enstellar-workflow/migrations/versions/0035_revital_bypassed.py` (new)
- `services/enstellar-workflow/enstellar_workflow/consumers/clinical_review_consumer.py` (modified)

---

## Task 2.8 — DLQ Admin Endpoint

### Problem
`shared.outbox` has `dlq_at` / `dlq_reason` columns (added in `0030_outbox_retry_count.py`) and `shared.consumer_dlq` exists (from `0028_consumer_dlq.py`), but there is no API to inspect or reprocess dead-lettered events. Silent event loss after 5 retries has no visibility.

### Design

New FastAPI router `enstellar_workflow/admin/dlq_router.py`, mounted at `/admin/dlq` in `main.py`. Auth: Bearer JWT required (reuse the existing `require_auth` dependency pattern from the BFF). Role gate: `saas_admin` checked via OPA `sim/rbac/roles` before any write operation.

**Endpoints:**

`GET /admin/dlq/outbox`
- Query: `SELECT event_id, topic, tenant_id, dlq_at, dlq_reason, retry_count FROM shared.outbox WHERE dlq_at IS NOT NULL ORDER BY dlq_at DESC LIMIT 100`
- Uses `sim_relay` role (BYPASSRLS) via `SET LOCAL ROLE sim_relay` — same pattern as `relay.py` — because admin must see across all tenants
- Returns: `{ events: [{event_id, topic, tenant_id, dlq_at, dlq_reason, retry_count}] }`

`GET /admin/dlq/consumers`
- Query: `SELECT event_id, consumer_group, topic, error, failed_at, replayed_at FROM shared.consumer_dlq ORDER BY failed_at DESC LIMIT 100`
- Same relay role

`POST /admin/dlq/outbox/{event_id}/reprocess`
- OPA role check: requires `saas_admin`
- Resets the event: `UPDATE shared.outbox SET dlq_at = NULL, dlq_reason = NULL, retry_count = 0, published_at = NULL WHERE event_id = $1`
- Setting `published_at = NULL` re-enters the relay pickup loop (`WHERE published_at IS NULL AND dlq_at IS NULL`)
- Returns: `{ requeued: true, event_id }`

No Prometheus metrics this sprint — `prometheus_client` is not installed and adding it is out of scope.

### Files
- `services/enstellar-workflow/enstellar_workflow/admin/dlq_router.py` (new)
- `services/enstellar-workflow/enstellar_workflow/admin/__init__.py` (new, empty)
- `services/enstellar-workflow/enstellar_workflow/main.py` (modified — mount router)

---

## What Is Not In Scope

- **2.5** IRO integration — deferred (multi-week feature)
- **2.7** Pin-based appeal replay — deferred (multi-week feature)
- Prometheus alerting rules — prometheus_client not installed; separate sprint
- Any changes to `contracts/` or the canonical `Case` Pydantic model

---

## Testing

Each task gets the minimum test that fails if the logic breaks:

| Task | Test |
|---|---|
| 2.1 | Assert `notification_templates` count > 0 after running the migration against a test DB (or assert the migration SQL is idempotent via double-run) |
| 2.2 | No test needed — docker-compose config; verify SMTP vars flow into the service |
| 2.4 | Assert `workflow_config` has a `medicaid` row after migration |
| 2.6 | Unit test: `_emit_failed()` sets `revital_bypassed = TRUE` on the case row |
| 2.8 | Unit tests: list endpoint returns DLQ rows; reprocess endpoint resets columns; non-admin JWT returns 403 |
