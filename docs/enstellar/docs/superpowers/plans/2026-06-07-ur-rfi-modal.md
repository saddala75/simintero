# UR — RFI Modal + Pend Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the no-op "Request info" button to a modal that calls `POST /bff/cases/{id}/rfi`, which proxies to the existing workflow-engine pend-rfi endpoint to transition the case to `pend_rfi` and pause the SLA clock.

**Architecture:** workflow-engine already has `POST /cases/{id}/pend-rfi` (T13); BFF adds a proxy route that fetches provider_npi from the case so reviewers only supply question + doc types; React modal uses useMutation and invalidates the case and worklist queries on success.

**Tech Stack:** Python 3.12, FastAPI, asyncpg, respx (BFF tests), TypeScript, React, TanStack Query, httpx

**Spec:** `docs/superpowers/specs/2026-06-07-ur-rfi-modal-design.md`

---

## File Map

| File | Action |
|------|--------|
| `services/workflow-engine/tests/test_pend_rfi_integration.py` | Create |
| `services/workflow-engine/enstellar_workflow/cases/router.py` | Verify / patch if needed |
| `services/portal-bff/enstellar_bff/models.py` | Modify — add `RfiRequest` |
| `services/portal-bff/enstellar_bff/clients/workflow.py` | Modify — add `rfi()` |
| `services/portal-bff/enstellar_bff/routers/cases.py` | Modify — add `POST /cases/{id}/rfi` |
| `services/portal-bff/tests/test_rfi.py` | Create |
| `apps/web/src/api/client.ts` | Modify — add `postRfi` |
| `apps/web/src/pages/CasePage.tsx` | Modify — RfiModal + state |

---

## Task 1 — UR1: integration test for pend-rfi + clock pause

**Review class: sensitive (clocks) — senior engineer review required before merge.**

**Files:**
- Create: `services/workflow-engine/tests/test_pend_rfi_integration.py`
- Verify: `services/workflow-engine/enstellar_workflow/cases/router.py` (lines ~145-176)

- [ ] **Step 1: Read the existing endpoint**

  ```bash
  grep -n "pend.rfi\|pend_rfi" services/workflow-engine/enstellar_workflow/cases/router.py
  ```
  Note: the endpoint at `POST /cases/{case_id}/pend-rfi`. Confirm it accepts `{provider_npi, document_types, free_text}` and calls into the transition engine.

- [ ] **Step 2: Verify clock pause in the transition**

  Search for the clock pause call:
  ```bash
  grep -rn "pause\|paused_at" services/workflow-engine/enstellar_workflow/cases/
  ```
  Confirm `paused_at` is set on the `clocks` row in the same transaction as the state change. If it is not atomic (separate commits), patch the handler to use a single `async with conn.transaction()` block.

- [ ] **Step 3: Write failing integration tests**

  Create `services/workflow-engine/tests/test_pend_rfi_integration.py`:

  ```python
  import pytest
  import uuid

  pytestmark = pytest.mark.asyncio

  async def test_pend_rfi_transitions_and_pauses_clock(client, seeded_case, db_conn):
      resp = await client.post(
          f"/cases/{seeded_case.case_id}/pend-rfi",
          json={
              "provider_npi": "1234567890",
              "document_types": ["lab"],
              "free_text": "Please send recent CBC.",
          },
          headers={"X-Tenant-Id": seeded_case.tenant_id},
      )
      assert resp.status_code == 200

      row = await db_conn.fetchrow(
          "SELECT status FROM workflow_instances WHERE case_id = $1 AND tenant_id = $2",
          seeded_case.case_id, seeded_case.tenant_id,
      )
      assert row["status"] == "pend_rfi"

      clock = await db_conn.fetchrow(
          "SELECT paused_at FROM clocks WHERE case_id = $1 AND tenant_id = $2",
          seeded_case.case_id, seeded_case.tenant_id,
      )
      assert clock is not None
      assert clock["paused_at"] is not None

      event = await db_conn.fetchrow(
          """SELECT payload FROM outbox
             WHERE tenant_id = $1 AND event_type = 'case.rfi.sent'
             ORDER BY created_at DESC LIMIT 1""",
          seeded_case.tenant_id,
      )
      assert event is not None

  async def test_pend_rfi_requires_active_case(client, seeded_case_in_pend_rfi, db_conn):
      """Second pend-rfi on an already-pended case must not create a second paused clock."""
      await client.post(
          f"/cases/{seeded_case_in_pend_rfi.case_id}/pend-rfi",
          json={"provider_npi": "1234567890", "document_types": [], "free_text": None},
          headers={"X-Tenant-Id": seeded_case_in_pend_rfi.tenant_id},
      )
      clocks = await db_conn.fetch(
          "SELECT id FROM clocks WHERE case_id = $1 AND tenant_id = $2 AND paused_at IS NOT NULL",
          seeded_case_in_pend_rfi.case_id, seeded_case_in_pend_rfi.tenant_id,
      )
      assert len(clocks) == 1
  ```

- [ ] **Step 4: Run tests — expect failure**

  ```bash
  cd services/workflow-engine && python -m pytest tests/test_pend_rfi_integration.py -v 2>&1 | head -40
  ```
  Expected: tests fail (endpoint missing test infra or clock not asserted yet).

- [ ] **Step 5: Patch endpoint if clock pause is not atomic**

  If `paused_at` is set outside the state-transition transaction, move it inside. Pattern from existing code:
  ```python
  async with conn.transaction():
      await transition_engine.apply(conn, case_id, tenant_id, "pend_rfi")
      await clock_service.pause(conn, case_id, tenant_id)
      await outbox.publish(conn, tenant_id, "case.rfi.sent", {...})
  ```

- [ ] **Step 6: Run tests — expect pass**

  ```bash
  python -m pytest tests/test_pend_rfi_integration.py -v
  ```
  Expected: both tests PASS.

- [ ] **Step 7: Run full workflow-engine test suite**

  ```bash
  python -m pytest --tb=short -q
  ```
  Expected: no regressions.

- [ ] **Step 8: Commit**

  ```bash
  git add services/workflow-engine/tests/test_pend_rfi_integration.py \
          services/workflow-engine/enstellar_workflow/cases/router.py
  git commit -m "test(UR1): integration test for pend-rfi clock pause atomicity"
  ```

---

## Task 2 — UR2: BFF proxy for RFI

**Review class: sensitive (clocks) — senior engineer review required before merge.**

**Files:**
- Modify: `services/portal-bff/enstellar_bff/models.py`
- Modify: `services/portal-bff/enstellar_bff/clients/workflow.py`
- Modify: `services/portal-bff/enstellar_bff/routers/cases.py`
- Create: `services/portal-bff/tests/test_rfi.py`

- [ ] **Step 1: Write failing BFF tests**

  Create `services/portal-bff/tests/test_rfi.py`:

  ```python
  import json
  import httpx
  import pytest
  import respx

  pytestmark = pytest.mark.asyncio
  CASE_ID = "00000000-0000-0000-0000-000000000001"

  async def test_post_rfi_proxies_and_returns_status(client, respx_mock, authed_headers):
      respx_mock.get(f"/cases/{CASE_ID}").mock(
          return_value=httpx.Response(200, json={"practitioner_npi": "9876543210"})
      )
      respx_mock.post(f"/cases/{CASE_ID}/pend-rfi").mock(
          return_value=httpx.Response(200, json={"status": "pend_rfi"})
      )
      resp = await client.post(
          f"/bff/cases/{CASE_ID}/rfi",
          json={"question": "Please send recent labs.", "requested_docs": ["lab"]},
          headers=authed_headers,
      )
      assert resp.status_code == 200
      assert resp.json()["status"] == "pend_rfi"

  async def test_post_rfi_provider_npi_from_case_not_body(client, respx_mock, authed_headers):
      """BFF must fetch provider_npi from case, not accept it from the request body."""
      captured: dict = {}

      def capture(request):
          captured["body"] = json.loads(request.content)
          return httpx.Response(200, json={"status": "pend_rfi"})

      respx_mock.get(f"/cases/{CASE_ID}").mock(
          return_value=httpx.Response(200, json={"practitioner_npi": "CORRECT_NPI"})
      )
      respx_mock.post(f"/cases/{CASE_ID}/pend-rfi").mock(side_effect=capture)

      await client.post(
          f"/bff/cases/{CASE_ID}/rfi",
          json={"question": "Q", "requested_docs": []},
          headers=authed_headers,
      )
      assert captured["body"]["provider_npi"] == "CORRECT_NPI"

  async def test_post_rfi_actor_id_from_auth(client, respx_mock, authed_headers):
      """actor_id must come from auth["sub"], not be injectable via request body."""
      captured: dict = {}

      def capture(request):
          captured["body"] = json.loads(request.content)
          return httpx.Response(200, json={"status": "pend_rfi"})

      respx_mock.get(f"/cases/{CASE_ID}").mock(
          return_value=httpx.Response(200, json={"practitioner_npi": "NPI"})
      )
      respx_mock.post(f"/cases/{CASE_ID}/pend-rfi").mock(side_effect=capture)

      await client.post(
          f"/bff/cases/{CASE_ID}/rfi",
          json={"question": "Q", "requested_docs": []},
          headers=authed_headers,
      )
      # actor_id in downstream call must match auth["sub"] (set in authed_headers fixture)
      assert captured["body"].get("actor_id") == authed_headers.get("X-User-Sub", "test-sub")

  async def test_post_rfi_requires_auth(client):
      resp = await client.post(f"/bff/cases/{CASE_ID}/rfi", json={"question": "Q"})
      assert resp.status_code in (401, 403)
  ```

- [ ] **Step 2: Run tests — expect failure**

  ```bash
  cd services/portal-bff && python -m pytest tests/test_rfi.py -v 2>&1 | head -30
  ```
  Expected: ImportError or 404 — `RfiRequest` and route don't exist yet.

- [ ] **Step 3: Add RfiRequest model**

  In `services/portal-bff/enstellar_bff/models.py`, add after existing models:

  ```python
  class RfiRequest(BaseModel):
      question: str
      requested_docs: list[str] = []
  ```

- [ ] **Step 4: Add rfi() to WorkflowClient**

  In `services/portal-bff/enstellar_bff/clients/workflow.py`, add:

  ```python
  async def rfi(
      self,
      case_id: str,
      tenant_id: str,
      provider_npi: str,
      document_types: list[str],
      free_text: str | None,
      actor_id: str,
  ) -> dict:
      resp = await self._client.post(
          f"/cases/{case_id}/pend-rfi",
          json={
              "provider_npi": provider_npi,
              "document_types": document_types,
              "free_text": free_text,
              "actor_id": actor_id,
          },
          headers={"X-Tenant-Id": tenant_id},
      )
      resp.raise_for_status()
      return resp.json()
  ```

- [ ] **Step 5: Add POST /cases/{id}/rfi route**

  In `services/portal-bff/enstellar_bff/routers/cases.py`, add the route.

  First check what field name holds the NPI in the case response:
  ```bash
  grep -rn "practitioner_npi\|provider.*npi\|npi" services/portal-bff/enstellar_bff/ | head -20
  ```

  Then add the route:

  ```python
  @router.post("/cases/{case_id}/rfi", status_code=200)
  async def post_rfi(
      case_id: str,
      body: RfiRequest,
      auth: dict = Depends(require_reviewer),
  ) -> dict:
      tenant_id: str = auth["tenant_id"]
      actor_id: str = auth["sub"]
      case = await workflow_client.get_case(case_id, tenant_id)
      provider_npi: str = (
          case.get("practitioner_npi")
          or (case.get("provider") or {}).get("npi", "")
      )
      await workflow_client.rfi(
          case_id=case_id,
          tenant_id=tenant_id,
          provider_npi=provider_npi,
          document_types=body.requested_docs,
          free_text=body.question or None,
          actor_id=actor_id,
      )
      return {"status": "pend_rfi"}
  ```

  Make sure `RfiRequest` is imported at the top of the router file.

- [ ] **Step 6: Run tests — expect pass**

  ```bash
  python -m pytest tests/test_rfi.py -v
  ```
  Expected: all 4 tests PASS.

- [ ] **Step 7: Run full BFF test suite**

  ```bash
  python -m pytest --tb=short -q
  ```
  Expected: no regressions.

- [ ] **Step 8: Commit**

  ```bash
  git add services/portal-bff/enstellar_bff/models.py \
          services/portal-bff/enstellar_bff/clients/workflow.py \
          services/portal-bff/enstellar_bff/routers/cases.py \
          services/portal-bff/tests/test_rfi.py
  git commit -m "feat(UR2): BFF POST /bff/cases/{id}/rfi proxy"
  ```

---

## Task 3 — UR3: RFI modal in React

**Review class: standard**

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/CasePage.tsx`

- [ ] **Step 1: Add postRfi to API client**

  In `apps/web/src/api/client.ts`, add:

  ```ts
  export function postRfi(
    caseId: string,
    body: { question: string; requested_docs: string[] }
  ): Promise<{ status: string }> {
    return api.post(`/bff/cases/${caseId}/rfi`, body).then(r => r.data);
  }
  ```

- [ ] **Step 2: Locate "Request info" button in CasePage.tsx**

  ```bash
  grep -n "Request info\|rfi\|pend_rfi" apps/web/src/pages/CasePage.tsx | head -20
  ```
  Note the line numbers for the button (≈1562-1582) and the component that renders it.

- [ ] **Step 3: Add modal open state**

  Near the top of the component that contains the "Request info" button, add:

  ```ts
  const [rfiOpen, setRfiOpen] = useState(false);
  ```

  Update the button `onClick` from the no-op to:
  ```tsx
  onClick={() => setRfiOpen(true)}
  ```

- [ ] **Step 4: Add RfiModal component**

  Before the `export default` of `CasePage`, add the `RfiModal` component. It can be inline in `CasePage.tsx` or extracted to `apps/web/src/components/RfiModal.tsx`.

  ```tsx
  const DOC_TYPES = [
    { value: 'lab', label: 'Lab results' },
    { value: 'imaging', label: 'Imaging' },
    { value: 'clinical_notes', label: 'Clinical notes' },
    { value: 'referral', label: 'Referral' },
  ] as const;

  function RfiModal({
    caseId,
    onClose,
    onSuccess,
  }: {
    caseId: string;
    onClose: () => void;
    onSuccess: () => void;
  }) {
    const [question, setQuestion] = useState('');
    const [requestedDocs, setRequestedDocs] = useState<string[]>([]);

    const mutation = useMutation(
      () => postRfi(caseId, { question, requested_docs: requestedDocs }),
      { onSuccess }
    );

    const toggleDoc = (value: string) =>
      setRequestedDocs(prev =>
        prev.includes(value) ? prev.filter(d => d !== value) : [...prev, value]
      );

    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
          <h3 className="text-lg font-semibold mb-4">Request information from provider</h3>

          <textarea
            className="w-full border rounded p-2 text-sm resize-none"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Describe what information is needed…"
            rows={4}
          />

          <fieldset className="mt-3">
            <legend className="text-sm font-medium text-gray-700 mb-1">
              Document types requested
            </legend>
            <div className="space-y-1">
              {DOC_TYPES.map(dt => (
                <label key={dt.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={requestedDocs.includes(dt.value)}
                    onChange={() => toggleDoc(dt.value)}
                  />
                  {dt.label}
                </label>
              ))}
            </div>
          </fieldset>

          {mutation.isError && (
            <p className="mt-2 text-sm text-red-600">Failed to send — please try again.</p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
              onClick={onClose}
              disabled={mutation.isLoading}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              onClick={() => mutation.mutate()}
              disabled={!question.trim() || mutation.isLoading}
            >
              {mutation.isLoading ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 5: Render modal in CasePage JSX**

  In the JSX of the component that owns `rfiOpen` state, add after the button:

  ```tsx
  {rfiOpen && (
    <RfiModal
      caseId={caseId!}
      onClose={() => setRfiOpen(false)}
      onSuccess={() => {
        setRfiOpen(false);
        queryClient.invalidateQueries(['case', caseId]);
        queryClient.invalidateQueries(['worklist']);
      }}
    />
  )}
  ```

  Make sure `queryClient` is obtained via `const queryClient = useQueryClient();` at the top of the component.

- [ ] **Step 6: Verify imports**

  The component using `RfiModal` must import (if not already present):
  ```ts
  import { useState } from 'react';
  import { useMutation, useQueryClient } from '@tanstack/react-query';
  import { postRfi } from '../api/client';
  ```

- [ ] **Step 7: Type-check**

  ```bash
  cd apps/web && npx tsc --noEmit 2>&1
  ```
  Expected: no new type errors.

- [ ] **Step 8: Start dev server and manually verify**

  ```bash
  make up  # ensure BFF + workflow-engine are up
  cd apps/web && npm run dev
  ```
  Open a case in `clinical_review` state. Click "Request info". Verify:
  1. Modal opens.
  2. Textarea accepts input.
  3. Checkboxes toggle independently.
  4. Send button is disabled when textarea is empty; enabled when filled.
  5. After Send: modal closes, case status badge shows "Awaiting info".

- [ ] **Step 9: Commit**

  ```bash
  git add apps/web/src/api/client.ts apps/web/src/pages/CasePage.tsx
  git commit -m "feat(UR3): RFI modal wired to Request info button"
  ```
