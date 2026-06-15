# Design: UG — Governance Stats (P2)

**Date:** 2026-06-07
**Phase:** P2 (UI Backend Wiring)
**Tasks:** UG1, UG2
**Review classes:** UG1/UG2 = standard

---

## Context

`WorklistPage.tsx` renders a "Governed AI · guardrails" rail with three hardcoded values:
- `0` AI determinations
- `100%` human sign-off
- `96%` SLA compliance (expedited)

UG1 computes live aggregates from the workflow-engine database and exposes them through a BFF route with a 60-second cache header. UG2 wires the frontend to consume them.

`LandingPage.tsx` has its own hardcoded stats — those are marketing copy and stay hardcoded.

---

## Architecture

```
WorklistPage.tsx
  └─> useQuery(['stats', queueId])
       └─> GET /bff/queues/{queueId}/stats
            └─> WorkflowClient.queue_stats(queue_id, tenant_id)
                 └─> GET /queues/{queueId}/stats  (workflow-engine)
                      ├─> workflow_instances (ai_determinations via case_json JSONB)
                      ├─> human_signoffs (adverse_human_signed_pct)
                      └─> clocks (sla_compliance_expedited_pct via breached_at)
```

All queries are tenant-scoped. The period is the rolling last 30 days.

---

## UG1 — workflow-engine stats endpoint

### New module: `enstellar_workflow/queues/`

**`enstellar_workflow/queues/__init__.py`** — empty.

**`enstellar_workflow/queues/router.py`**:

```python
from datetime import date, timedelta
from typing import Any
import uuid
from fastapi import APIRouter, Header
from enstellar_workflow.db import get_pool

router = APIRouter(prefix="/queues", tags=["queues"])

@router.get("/{queue_id}/stats")
async def get_queue_stats(
    queue_id: str,
    tenant_id: str = Header(..., alias="X-Tenant-Id"),
) -> dict[str, Any]:
    pool = await get_pool()
    period_end = date.today()
    period_start = period_end - timedelta(days=30)
    async with pool.acquire() as conn:
        ai_det = await _ai_determinations(conn, tenant_id, queue_id, period_start)
        adverse_pct = await _adverse_human_signed_pct(conn, tenant_id, period_start)
        sla_pct = await _sla_compliance_expedited_pct(conn, tenant_id, period_start)
    return {
        "ai_determinations": ai_det,
        "adverse_human_signed_pct": round(adverse_pct, 1),
        "sla_compliance_expedited_pct": round(sla_pct, 1),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
    }

async def _ai_determinations(conn, tenant_id: str, queue_id: str, since: date) -> int:
    row = await conn.fetchrow(
        """
        SELECT COUNT(*) AS n FROM workflow_instances
        WHERE tenant_id = $1
          AND assignee_queue = $2
          AND created_at >= $3
          AND case_json->'decisions' @> '[{"auto_approved": true}]'::jsonb
        """,
        tenant_id, queue_id, since,
    )
    return int(row["n"])

async def _adverse_human_signed_pct(conn, tenant_id: str, since: date) -> float:
    """% of adverse-outcome cases that have a recorded human sign-off."""
    row = await conn.fetchrow(
        """
        WITH adverse AS (
            SELECT case_id FROM workflow_instances
            WHERE tenant_id = $1
              AND created_at >= $2
              AND status IN ('adverse', 'denied', 'partially_approved')
        )
        SELECT
            COUNT(hs.case_id)::float / NULLIF(COUNT(a.case_id), 0) * 100 AS pct
        FROM adverse a
        LEFT JOIN human_signoffs hs
               ON hs.case_id = a.case_id AND hs.tenant_id = $1
        """,
        tenant_id, since,
    )
    return float(row["pct"] or 0.0)

async def _sla_compliance_expedited_pct(conn, tenant_id: str, since: date) -> float:
    """% of expedited cases whose SLA clock was NOT breached."""
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE breached_at IS NULL)::float
            / NULLIF(COUNT(*), 0) * 100 AS pct
        FROM clocks
        WHERE tenant_id = $1
          AND urgency = 'expedited'
          AND started_at >= $2
        """,
        tenant_id, since,
    )
    return float(row["pct"] or 0.0)
```

**Register in `enstellar_workflow/main.py`:**

```python
from enstellar_workflow.queues.router import router as queues_router
app.include_router(queues_router)
```

**Test:** `services/workflow-engine/tests/test_queue_stats.py`

```python
async def test_queue_stats_zero_for_fresh_environment(client, tenant_id):
    resp = await client.get(
        "/queues/standard/stats",
        headers={"X-Tenant-Id": tenant_id},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ai_determinations"] == 0
    assert body["adverse_human_signed_pct"] == 0.0
    assert body["sla_compliance_expedited_pct"] == 0.0
    assert "period_start" in body
    assert "period_end" in body

async def test_queue_stats_counts_ai_determinations(client, db_conn, tenant_id):
    # Seed a workflow_instance with an auto-approved decision
    await db_conn.execute(
        """INSERT INTO workflow_instances (case_id, tenant_id, status, assignee_queue, case_json, created_at)
           VALUES (gen_random_uuid(), $1, 'approved', 'standard',
                   '{"decisions": [{"auto_approved": true}]}'::jsonb, NOW())""",
        tenant_id,
    )
    resp = await client.get("/queues/standard/stats", headers={"X-Tenant-Id": tenant_id})
    assert resp.json()["ai_determinations"] == 1

async def test_queue_stats_tenant_isolation(client, db_conn, tenant_id):
    other_tenant = "other-tenant"
    await db_conn.execute(
        """INSERT INTO workflow_instances (case_id, tenant_id, status, assignee_queue, case_json, created_at)
           VALUES (gen_random_uuid(), $1, 'approved', 'standard',
                   '{"decisions": [{"auto_approved": true}]}'::jsonb, NOW())""",
        other_tenant,
    )
    resp = await client.get("/queues/standard/stats", headers={"X-Tenant-Id": tenant_id})
    assert resp.json()["ai_determinations"] == 0
```

**DoD:** zero-values for fresh environment; tenant isolation; all 5 fields present.

---

## UG1 — BFF proxy + cache header

### Model

Add to `services/portal-bff/enstellar_bff/models.py`:

```python
class QueueStats(BaseModel):
    ai_determinations: int
    adverse_human_signed_pct: float
    sla_compliance_expedited_pct: float
    period_start: str
    period_end: str
```

### WorkflowClient

Add to `services/portal-bff/enstellar_bff/clients/workflow.py`:

```python
async def queue_stats(self, queue_id: str, tenant_id: str) -> dict:
    resp = await self._client.get(
        f"/queues/{queue_id}/stats",
        headers={"X-Tenant-Id": tenant_id},
    )
    resp.raise_for_status()
    return resp.json()
```

### New BFF router

**New file:** `services/portal-bff/enstellar_bff/routers/queues.py`

```python
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from enstellar_bff.auth import require_reviewer
from enstellar_bff.clients.workflow import WorkflowClient
from enstellar_bff.models import QueueStats

router = APIRouter(prefix="/bff/queues", tags=["queues"])
workflow_client = WorkflowClient()

@router.get("/{queue_id}/stats", response_model=QueueStats)
async def get_queue_stats(
    queue_id: str,
    auth: dict = Depends(require_reviewer),
) -> JSONResponse:
    tenant_id: str = auth["tenant_id"]
    data = await workflow_client.queue_stats(queue_id, tenant_id)
    return JSONResponse(
        content=data,
        headers={"Cache-Control": "max-age=60, private"},
    )
```

Register in `main.py`:
```python
from enstellar_bff.routers.queues import router as queues_router
app.include_router(queues_router)
```

**Test:** `services/portal-bff/tests/test_queue_stats.py`

```python
async def test_get_queue_stats_returns_data(client, respx_mock, authed_headers):
    respx_mock.get("/queues/standard/stats").mock(return_value=httpx.Response(200, json={
        "ai_determinations": 12,
        "adverse_human_signed_pct": 100.0,
        "sla_compliance_expedited_pct": 94.5,
        "period_start": "2026-05-07",
        "period_end": "2026-06-07",
    }))
    resp = await client.get("/bff/queues/standard/stats", headers=authed_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ai_determinations"] == 12
    assert "Cache-Control" in resp.headers
    assert "max-age=60" in resp.headers["Cache-Control"]

async def test_get_queue_stats_tenant_enforced(client, respx_mock):
    resp = await client.get("/bff/queues/standard/stats")  # no auth header
    assert resp.status_code in (401, 403)
```

**DoD:** cache header present; all 5 fields returned; tenant enforced; zero-values handled.

---

## UG2 — Replace hardcoded governance stats

### Types

Add to `apps/web/src/types/index.ts`:

```ts
export interface QueueStats {
  ai_determinations: number;
  adverse_human_signed_pct: number;
  sla_compliance_expedited_pct: number;
  period_start: string;
  period_end: string;
}
```

### API client

Add to `apps/web/src/api/client.ts`:

```ts
export function getQueueStats(queueId: string): Promise<QueueStats> {
  return api.get(`/bff/queues/${queueId}/stats`).then(r => r.data);
}
```

### WorklistPage.tsx

Locate the three hardcoded governance stats values (lines ≈167, 296, 297).

1. Determine the active queue ID from the current worklist filter state (e.g., `selectedQueue` or `"standard"` as default).
2. Add:
   ```ts
   const { data: stats } = useQuery(
     ['stats', activeQueueId],
     () => getQueueStats(activeQueueId),
     { staleTime: 60_000 }
   );
   ```
3. Replace each hardcoded value:
   - `0` AI determinations → `stats?.ai_determinations ?? 0`
   - `100` % human → `stats?.adverse_human_signed_pct ?? 0`
   - `96` % SLA → `stats?.sla_compliance_expedited_pct ?? 0`
4. Guard against `NaN`: if `stats` is undefined during loading, render `–` or `0`.

**`LandingPage.tsx` hardcoded stats: do not change** — those are marketing copy, not live data.

**DoD:** worklist rail shows live values; zero-values render without NaN; values refresh when query is invalidated.
