# UG — Governance Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three hardcoded governance stats values in `WorklistPage.tsx` with live aggregates from a new `/queues/{id}/stats` endpoint in the workflow-engine, proxied through the BFF.

**Architecture:** workflow-engine adds a new `queues` router with three asyncpg SQL queries (ai_determinations, adverse_human_signed_pct, sla_compliance_expedited_pct) over the rolling last-30-day window; BFF adds a `WorkflowClient.queue_stats()` method and a `GET /bff/queues/{id}/stats` route with a 60s cache header; frontend uses `useQuery` to replace the hardcoded numbers.

**Tech Stack:** Python 3.12, FastAPI, asyncpg, respx (BFF tests), TypeScript, React, TanStack Query

**Spec:** `docs/superpowers/specs/2026-06-07-ug-governance-stats-design.md`

---

## File Map

| File | Action |
|------|--------|
| `services/workflow-engine/enstellar_workflow/queues/__init__.py` | Create |
| `services/workflow-engine/enstellar_workflow/queues/router.py` | Create |
| `services/workflow-engine/enstellar_workflow/main.py` | Modify — register router |
| `services/workflow-engine/tests/test_queue_stats.py` | Create |
| `services/portal-bff/enstellar_bff/models.py` | Modify — add `QueueStats` |
| `services/portal-bff/enstellar_bff/clients/workflow.py` | Modify — add `queue_stats()` |
| `services/portal-bff/enstellar_bff/routers/queues.py` | Create |
| `services/portal-bff/enstellar_bff/main.py` | Modify — register router |
| `services/portal-bff/tests/test_queue_stats.py` | Create |
| `apps/web/src/types/index.ts` | Modify — add `QueueStats` |
| `apps/web/src/api/client.ts` | Modify — add `getQueueStats` |
| `apps/web/src/pages/WorklistPage.tsx` | Modify — replace hardcoded values |

---

## Task 1 — UG-WE: workflow-engine stats endpoint

**Review class: standard**

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/queues/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/queues/router.py`
- Modify: `services/workflow-engine/enstellar_workflow/main.py`
- Create: `services/workflow-engine/tests/test_queue_stats.py`

- [ ] **Step 1: Inspect existing schema for exact column names**

  ```bash
  grep -rn "assignee_queue\|auto_approved\|breached_at\|human_signoffs\|urgency" \
    services/workflow-engine/migrations/ services/workflow-engine/enstellar_workflow/ | head -30
  ```
  Note exact column names used in `workflow_instances`, `clocks`, and `human_signoffs`.

- [ ] **Step 2: Write failing tests**

  Create `services/workflow-engine/tests/test_queue_stats.py`:

  ```python
  import pytest

  pytestmark = pytest.mark.asyncio

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

  async def test_queue_stats_counts_ai_auto_approved(client, db_conn, tenant_id):
      await db_conn.execute(
          """INSERT INTO workflow_instances
             (case_id, tenant_id, status, assignee_queue, case_json, created_at)
             VALUES (gen_random_uuid(), $1, 'approved', 'standard',
                     '{"decisions": [{"auto_approved": true}]}'::jsonb, NOW())""",
          tenant_id,
      )
      resp = await client.get("/queues/standard/stats", headers={"X-Tenant-Id": tenant_id})
      assert resp.json()["ai_determinations"] == 1

  async def test_queue_stats_tenant_isolation(client, db_conn, tenant_id):
      other = "other-tenant-uq1"
      await db_conn.execute(
          """INSERT INTO workflow_instances
             (case_id, tenant_id, status, assignee_queue, case_json, created_at)
             VALUES (gen_random_uuid(), $1, 'approved', 'standard',
                     '{"decisions": [{"auto_approved": true}]}'::jsonb, NOW())""",
          other,
      )
      resp = await client.get("/queues/standard/stats", headers={"X-Tenant-Id": tenant_id})
      assert resp.json()["ai_determinations"] == 0

  async def test_queue_stats_sla_compliance_expedited(client, db_conn, tenant_id):
      case_id = "aaaaaaaa-0000-0000-0000-000000000001"
      await db_conn.execute(
          """INSERT INTO clocks (id, case_id, tenant_id, urgency, started_at, breached_at)
             VALUES (gen_random_uuid(), $1, $2, 'expedited', NOW(), NULL)""",
          case_id, tenant_id,
      )
      resp = await client.get("/queues/standard/stats", headers={"X-Tenant-Id": tenant_id})
      assert resp.json()["sla_compliance_expedited_pct"] == 100.0
  ```

- [ ] **Step 3: Run tests — expect failure (router not yet created)**

  ```bash
  cd services/workflow-engine && python -m pytest tests/test_queue_stats.py -v 2>&1 | head -20
  ```
  Expected: 404 or ImportError.

- [ ] **Step 4: Create queues module**

  ```bash
  mkdir -p services/workflow-engine/enstellar_workflow/queues
  touch services/workflow-engine/enstellar_workflow/queues/__init__.py
  ```

- [ ] **Step 5: Write queues/router.py**

  Create `services/workflow-engine/enstellar_workflow/queues/router.py`:

  ```python
  from datetime import date, timedelta
  from typing import Any

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
      row = await conn.fetchrow(
          """
          WITH adverse AS (
              SELECT case_id FROM workflow_instances
              WHERE tenant_id = $1
                AND created_at >= $2
                AND status IN ('adverse', 'denied', 'partially_approved')
          )
          SELECT
              COUNT(hs.case_id)::float
              / NULLIF(COUNT(a.case_id), 0) * 100 AS pct
          FROM adverse a
          LEFT JOIN human_signoffs hs
                 ON hs.case_id = a.case_id AND hs.tenant_id = $1
          """,
          tenant_id, since,
      )
      return float(row["pct"] or 0.0)


  async def _sla_compliance_expedited_pct(conn, tenant_id: str, since: date) -> float:
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

  > **Note on column names:** If the actual `workflow_instances` status values or `clocks` urgency values differ from the above, adjust the `IN (...)` and `=` clauses to match the real schema. Run `\d workflow_instances` in psql against the dev DB to verify.

- [ ] **Step 6: Register router in main.py**

  In `services/workflow-engine/enstellar_workflow/main.py`, add:

  ```python
  from enstellar_workflow.queues.router import router as queues_router
  # ... (after existing router imports)
  app.include_router(queues_router)
  ```

- [ ] **Step 7: Run tests — expect pass**

  ```bash
  python -m pytest tests/test_queue_stats.py -v
  ```
  Expected: all 4 tests PASS.

- [ ] **Step 8: Run full workflow-engine test suite**

  ```bash
  python -m pytest --tb=short -q
  ```
  Expected: no regressions.

- [ ] **Step 9: Commit**

  ```bash
  git add services/workflow-engine/enstellar_workflow/queues/ \
          services/workflow-engine/enstellar_workflow/main.py \
          services/workflow-engine/tests/test_queue_stats.py
  git commit -m "feat(UG-WE): GET /queues/{id}/stats with live aggregates"
  ```

---

## Task 2 — UG1: BFF proxy with cache header

**Review class: standard**

**Files:**
- Modify: `services/portal-bff/enstellar_bff/models.py`
- Modify: `services/portal-bff/enstellar_bff/clients/workflow.py`
- Create: `services/portal-bff/enstellar_bff/routers/queues.py`
- Modify: `services/portal-bff/enstellar_bff/main.py`
- Create: `services/portal-bff/tests/test_queue_stats.py`

- [ ] **Step 1: Write failing BFF tests**

  Create `services/portal-bff/tests/test_queue_stats.py`:

  ```python
  import httpx
  import pytest

  pytestmark = pytest.mark.asyncio

  STATS_PAYLOAD = {
      "ai_determinations": 12,
      "adverse_human_signed_pct": 100.0,
      "sla_compliance_expedited_pct": 94.5,
      "period_start": "2026-05-07",
      "period_end": "2026-06-07",
  }

  async def test_get_queue_stats_returns_data_with_cache_header(
      client, respx_mock, authed_headers
  ):
      respx_mock.get("/queues/standard/stats").mock(
          return_value=httpx.Response(200, json=STATS_PAYLOAD)
      )
      resp = await client.get("/bff/queues/standard/stats", headers=authed_headers)
      assert resp.status_code == 200
      body = resp.json()
      assert body["ai_determinations"] == 12
      assert body["adverse_human_signed_pct"] == 100.0
      assert body["sla_compliance_expedited_pct"] == 94.5
      assert "Cache-Control" in resp.headers
      assert "max-age=60" in resp.headers["Cache-Control"]

  async def test_get_queue_stats_tenant_enforced(client):
      resp = await client.get("/bff/queues/standard/stats")  # no auth
      assert resp.status_code in (401, 403)

  async def test_get_queue_stats_all_fields_present(client, respx_mock, authed_headers):
      respx_mock.get("/queues/standard/stats").mock(
          return_value=httpx.Response(200, json=STATS_PAYLOAD)
      )
      resp = await client.get("/bff/queues/standard/stats", headers=authed_headers)
      body = resp.json()
      for field in ("ai_determinations", "adverse_human_signed_pct",
                    "sla_compliance_expedited_pct", "period_start", "period_end"):
          assert field in body, f"Missing field: {field}"
  ```

- [ ] **Step 2: Run tests — expect failure**

  ```bash
  cd services/portal-bff && python -m pytest tests/test_queue_stats.py -v 2>&1 | head -20
  ```
  Expected: 404 — route doesn't exist.

- [ ] **Step 3: Add QueueStats model**

  In `services/portal-bff/enstellar_bff/models.py`, add:

  ```python
  class QueueStats(BaseModel):
      ai_determinations: int
      adverse_human_signed_pct: float
      sla_compliance_expedited_pct: float
      period_start: str
      period_end: str
  ```

- [ ] **Step 4: Add queue_stats() to WorkflowClient**

  In `services/portal-bff/enstellar_bff/clients/workflow.py`, add:

  ```python
  async def queue_stats(self, queue_id: str, tenant_id: str) -> dict:
      resp = await self._client.get(
          f"/queues/{queue_id}/stats",
          headers={"X-Tenant-Id": tenant_id},
      )
      resp.raise_for_status()
      return resp.json()
  ```

- [ ] **Step 5: Create routers/queues.py**

  Create `services/portal-bff/enstellar_bff/routers/queues.py`:

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

  > If `WorkflowClient` is a singleton instantiated in a `deps.py` file (pattern used in existing routers), import it from there instead of instantiating locally. Follow the existing pattern in `routers/cases.py`.

- [ ] **Step 6: Register router in BFF main.py**

  In `services/portal-bff/enstellar_bff/main.py`, add:

  ```python
  from enstellar_bff.routers.queues import router as queues_router
  app.include_router(queues_router)
  ```

- [ ] **Step 7: Run tests — expect pass**

  ```bash
  python -m pytest tests/test_queue_stats.py -v
  ```
  Expected: all 3 tests PASS.

- [ ] **Step 8: Run full BFF test suite**

  ```bash
  python -m pytest --tb=short -q
  ```
  Expected: no regressions.

- [ ] **Step 9: Commit**

  ```bash
  git add services/portal-bff/enstellar_bff/models.py \
          services/portal-bff/enstellar_bff/clients/workflow.py \
          services/portal-bff/enstellar_bff/routers/queues.py \
          services/portal-bff/enstellar_bff/main.py \
          services/portal-bff/tests/test_queue_stats.py
  git commit -m "feat(UG1): BFF GET /bff/queues/{id}/stats with 60s cache"
  ```

---

## Task 3 — UG2: Replace hardcoded governance stats in frontend

**Review class: standard**

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/WorklistPage.tsx`

- [ ] **Step 1: Locate hardcoded values in WorklistPage.tsx**

  ```bash
  grep -n "hardcoded\|96\|100\|\bstats\b\|governance\|SLA\|ai_det" \
    apps/web/src/pages/WorklistPage.tsx | head -20
  ```
  Note the exact lines (≈167, 296, 297) and the variable/literal values.

- [ ] **Step 2: Add QueueStats type**

  In `apps/web/src/types/index.ts`, add:

  ```ts
  export interface QueueStats {
    ai_determinations: number;
    adverse_human_signed_pct: number;
    sla_compliance_expedited_pct: number;
    period_start: string;
    period_end: string;
  }
  ```

- [ ] **Step 3: Add getQueueStats to API client**

  In `apps/web/src/api/client.ts`, add:

  ```ts
  import type { QueueStats } from '../types';

  export function getQueueStats(queueId: string): Promise<QueueStats> {
    return api.get(`/bff/queues/${queueId}/stats`).then(r => r.data);
  }
  ```

- [ ] **Step 4: Write failing test (if applicable)**

  If the project has Vitest/Jest unit tests for components, add:

  ```bash
  grep -rn "WorklistPage\|worklist" apps/web/src/__tests__/ 2>/dev/null | head -10
  ```
  If tests exist, add a test asserting `getQueueStats` is called. If no unit test framework is used for this file, skip to Step 5 and rely on the dev-server manual check.

- [ ] **Step 5: Wire useQuery in WorklistPage.tsx**

  1. Determine the active queue ID. Check existing state or props:
     ```bash
     grep -n "queue\|selectedQueue\|activeQueue" apps/web/src/pages/WorklistPage.tsx | head -15
     ```
     Use the existing queue variable name. If none exists, default to `"standard"`.

  2. Add the query hook near the top of the component:
     ```ts
     import { getQueueStats } from '../api/client';
     import type { QueueStats } from '../types';

     const { data: stats } = useQuery<QueueStats>(
       ['stats', activeQueueId],
       () => getQueueStats(activeQueueId),
       { staleTime: 60_000 }
     );
     ```

  3. Replace the three hardcoded values:
     - `0` (AI determinations) → `stats?.ai_determinations ?? 0`
     - `100` (% human) → `stats?.adverse_human_signed_pct ?? 0`
     - `96` (% SLA) → `stats?.sla_compliance_expedited_pct ?? 0`

  4. If any values are displayed as percentages with formatting (e.g., `toFixed(1)`), apply the same formatting to the live values.

- [ ] **Step 6: Guard NaN display**

  If any value is rendered with template strings or math operations, guard:
  ```ts
  const aiDet = stats?.ai_determinations ?? 0;
  const adversePct = isFinite(stats?.adverse_human_signed_pct ?? 0)
    ? (stats?.adverse_human_signed_pct ?? 0)
    : 0;
  const slaPct = isFinite(stats?.sla_compliance_expedited_pct ?? 0)
    ? (stats?.sla_compliance_expedited_pct ?? 0)
    : 0;
  ```

- [ ] **Step 7: Type-check**

  ```bash
  cd apps/web && npx tsc --noEmit 2>&1
  ```
  Expected: no type errors.

- [ ] **Step 8: Start dev server and manually verify**

  ```bash
  make up
  cd apps/web && npm run dev
  ```
  Open the worklist page. Verify:
  1. Governance rail renders without NaN or undefined.
  2. For a fresh environment: 0 AI determinations, 0% adverse, 0% SLA (not stale hardcoded values).
  3. `LandingPage.tsx` stats are unchanged.

- [ ] **Step 9: Commit**

  ```bash
  git add apps/web/src/types/index.ts \
          apps/web/src/api/client.ts \
          apps/web/src/pages/WorklistPage.tsx
  git commit -m "feat(UG2): worklist governance stats from live API"
  ```
