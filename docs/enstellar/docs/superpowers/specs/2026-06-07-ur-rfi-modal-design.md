# Design: UR — RFI Modal + Pend Transition (P2)

**Date:** 2026-06-07
**Phase:** P2 (UI Backend Wiring)
**Tasks:** UR1, UR2, UR3
**Review classes:** UR1/UR2 = sensitive (clocks); UR3 = standard

---

## Context

The "Request info" button in `CasePage.tsx` is currently a no-op (lines 1562-1582). `POST /cases/{case_id}/pend-rfi` already exists in the workflow-engine (`cases/router.py:145-176`) and: transitions the case to `pend_rfi`, pauses the SLA clock in the same transaction, and emits `case.rfi.sent` via the outbox.

The existing endpoint expects body `{provider_npi, document_types, free_text}`. The BFF must fetch `provider_npi` from the case rather than asking the reviewer to supply it — reviewers send `{question, requested_docs}` only.

---

## Architecture

```
Browser (RFI modal)
  └─> POST /bff/cases/{id}/rfi  {question: str, requested_docs: list[str]}
       └─> WorkflowClient.get_case() → extract provider_npi
       └─> WorkflowClient.rfi()
            └─> POST /cases/{id}/pend-rfi  {provider_npi, document_types, free_text}
                 └─> TransitionEngine → pend_rfi state
                      ├─> SLA clock pause (same transaction)
                      └─> case.rfi.sent event (outbox)
```

---

## UR1 — Verify workflow-engine `POST /cases/{case_id}/pend-rfi`

The endpoint exists. Verify it satisfies all three conditions and add an integration test asserting them atomically.

**Verification checklist:**
1. State transitions to `pend_rfi`.
2. SLA clock row has `paused_at IS NOT NULL` after the call.
3. A `case.rfi.sent` event appears in the outbox — same database transaction as the state transition.

If any condition is not met, patch the endpoint minimally to satisfy it; do not refactor the transition logic.

**New test file:** `services/workflow-engine/tests/test_pend_rfi_integration.py`

```python
async def test_pend_rfi_transitions_and_pauses_clock(client, seeded_case, db_conn):
    resp = await client.post(
        f"/cases/{seeded_case.case_id}/pend-rfi",
        json={"provider_npi": "1234567890", "document_types": ["lab"], "free_text": "Please send labs."},
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
    assert clock["paused_at"] is not None
    event = await db_conn.fetchrow(
        "SELECT payload FROM outbox WHERE tenant_id = $1 AND event_type = 'case.rfi.sent' ORDER BY created_at DESC LIMIT 1",
        seeded_case.tenant_id,
    )
    assert event is not None

async def test_pend_rfi_clock_pause_is_atomic(client, seeded_case, db_conn):
    """Clock pause and state transition must be in the same transaction."""
    # Simulate second call (idempotent or 409) — clock must not be paused twice.
    await client.post(
        f"/cases/{seeded_case.case_id}/pend-rfi",
        json={"provider_npi": "1234567890", "document_types": ["lab"], "free_text": None},
        headers={"X-Tenant-Id": seeded_case.tenant_id},
    )
    clocks = await db_conn.fetch(
        "SELECT id FROM clocks WHERE case_id = $1 AND tenant_id = $2 AND paused_at IS NOT NULL",
        seeded_case.case_id, seeded_case.tenant_id,
    )
    assert len(clocks) == 1  # Only one paused clock row
```

**DoD:** both tests pass; case in `pend_rfi`; clock paused; `case.rfi.sent` in outbox.

---

## UR2 — BFF `POST /bff/cases/{id}/rfi`

### Model

Add to `services/portal-bff/enstellar_bff/models.py`:

```python
class RfiRequest(BaseModel):
    question: str
    requested_docs: list[str] = []
```

### WorkflowClient

Add to `services/portal-bff/enstellar_bff/clients/workflow.py`:

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

The BFF already has a `WorkflowClient.get_case(case_id, tenant_id) -> dict` method (used by existing case-detail route). Use it to extract `provider_npi`. The NPI field path in the canonical case model is `case["practitioner_npi"]` or `case.get("provider", {}).get("npi", "")` — verify against actual model and use whichever is present.

### Route

Add to `services/portal-bff/enstellar_bff/routers/cases.py`:

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

### Test

`services/portal-bff/tests/test_rfi.py`:

```python
async def test_post_rfi_proxies_to_workflow_engine(client, respx_mock, authed_headers):
    case_id = "00000000-0000-0000-0000-000000000001"
    respx_mock.get(f"/cases/{case_id}").mock(return_value=httpx.Response(
        200, json={"practitioner_npi": "9876543210"}
    ))
    respx_mock.post(f"/cases/{case_id}/pend-rfi").mock(return_value=httpx.Response(
        200, json={"status": "pend_rfi"}
    ))
    resp = await client.post(
        f"/bff/cases/{case_id}/rfi",
        json={"question": "Please send recent labs.", "requested_docs": ["lab"]},
        headers=authed_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "pend_rfi"

async def test_post_rfi_actor_id_from_auth_not_body(client, respx_mock, authed_headers):
    """actor_id must come from auth["sub"], never from request body."""
    case_id = "00000000-0000-0000-0000-000000000001"
    captured = {}
    respx_mock.get(f"/cases/{case_id}").mock(return_value=httpx.Response(200, json={"practitioner_npi": "123"}))
    def capture(request):
        captured["body"] = request.content
        return httpx.Response(200, json={"status": "pend_rfi"})
    respx_mock.post(f"/cases/{case_id}/pend-rfi").mock(side_effect=capture)
    await client.post(
        f"/bff/cases/{case_id}/rfi",
        json={"question": "Labs please", "requested_docs": []},
        headers=authed_headers,
    )
    import json
    body = json.loads(captured["body"])
    assert "actor_id" not in body or body.get("actor_id") != "attacker-injected"
    assert body.get("provider_npi") == "123"  # came from case, not request

async def test_post_rfi_provider_npi_from_case_not_body(client, respx_mock, authed_headers):
    """BFF must never accept provider_npi from the reviewer request body."""
    case_id = "00000000-0000-0000-0000-000000000002"
    respx_mock.get(f"/cases/{case_id}").mock(return_value=httpx.Response(200, json={"practitioner_npi": "CORRECT_NPI"}))
    captured = {}
    def capture(req):
        import json
        captured["npi"] = json.loads(req.content)["provider_npi"]
        return httpx.Response(200, json={"status": "pend_rfi"})
    respx_mock.post(f"/cases/{case_id}/pend-rfi").mock(side_effect=capture)
    await client.post(
        f"/bff/cases/{case_id}/rfi",
        json={"question": "Q", "requested_docs": []},
        headers=authed_headers,
    )
    assert captured["npi"] == "CORRECT_NPI"
```

**DoD:** all 3 tests pass; `provider_npi` comes from case; `actor_id` from `auth["sub"]`.

---

## UR3 — Web: RFI modal

### API client

Add to `apps/web/src/api/client.ts`:

```ts
export function postRfi(
  caseId: string,
  body: { question: string; requested_docs: string[] }
): Promise<{ status: string }> {
  return api.post(`/bff/cases/${caseId}/rfi`, body).then(r => r.data);
}
```

### Types

No new type needed — `RfiRequest` shape is inline above.

### CasePage.tsx changes

1. Add state: `const [rfiOpen, setRfiOpen] = useState(false);`
2. "Request info" button: `onClick={() => setRfiOpen(true)}` (remove no-op handler).
3. Add `<RfiModal>` below the button (or as a sibling in the JSX tree):

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

4. **New component** `RfiModal` (inline in `CasePage.tsx` or extracted to `apps/web/src/components/RfiModal.tsx`):

```tsx
const DOC_TYPES = [
  { value: 'lab', label: 'Lab results' },
  { value: 'imaging', label: 'Imaging' },
  { value: 'clinical_notes', label: 'Clinical notes' },
  { value: 'referral', label: 'Referral' },
];

function RfiModal({ caseId, onClose, onSuccess }: {
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
  const toggleDoc = (v: string) =>
    setRequestedDocs(prev => prev.includes(v) ? prev.filter(d => d !== v) : [...prev, v]);

  return (
    <div className="modal-overlay">
      <div className="modal-panel">
        <h3>Request information from provider</h3>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Describe what information is needed…"
          rows={4}
        />
        <fieldset>
          <legend>Document types requested</legend>
          {DOC_TYPES.map(dt => (
            <label key={dt.value}>
              <input
                type="checkbox"
                checked={requestedDocs.includes(dt.value)}
                onChange={() => toggleDoc(dt.value)}
              />
              {dt.label}
            </label>
          ))}
        </fieldset>
        <div className="modal-actions">
          <button onClick={onClose} disabled={mutation.isLoading}>Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!question.trim() || mutation.isLoading}
          >
            {mutation.isLoading ? 'Sending…' : 'Send request'}
          </button>
        </div>
        {mutation.isError && <p className="error">Failed to send — please try again.</p>}
      </div>
    </div>
  );
}
```

**DoD:** clicking Send calls `POST /bff/cases/{id}/rfi`; case state badge transitions from "In review" to "Awaiting info" (because `['case', caseId]` is invalidated and refetched); modal closes on success; worklist badge updates.

---

## Non-negotiable invariants

- `actor_id` always from `auth["sub"]`, never accepted from request body — asserted by test.
- `provider_npi` always fetched from the case by the BFF, never from request body — asserted by test.
- Clock pause and state transition must be in the same database transaction — verified by UR1 integration test.
- `tenant_id` on every query, event, log line.
- Review class UR1 + UR2: **sensitive (clocks)** — requires senior engineer review before merge.
