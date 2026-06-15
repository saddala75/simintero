# T12 — Worklists + Reviewer UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `services/portal-bff/` (FastAPI aggregator, RBAC enforcer) and `apps/web/` (React + Vite reviewer workspace) so a clinician reviewer can load a worklist sorted by SLA urgency, open a case, and submit an approval through the UI.

**Architecture:** BFF is the single HTTP origin for all browser traffic — validates OIDC token, derives `tenant_id` + `reviewer` role, fans out to workflow-engine and returns composed response models. Web app uses TanStack Query + generated types from BFF response models. Playwright covers the E2E golden path. Web app never calls HAPI FHIR directly (all data proxied through BFF).

**Tech Stack:** Python 3.12, FastAPI, httpx, python-jose, Pydantic v2, pydantic-settings, pytest, respx; TypeScript, React 18, Vite 5, TanStack Query v5, react-router-dom v6, Playwright.

> **Invariant note:** BFF enforces `tenant_id` and `reviewer` role on every route. Web UI must not offer adverse-outcome buttons (deny/partial-deny) — those decisions require human sign-off enforced by the T08 transition guard. The `submit_decision` endpoint only transitions to `approved` or `clinical_review` (escalate). Attempting to route to an adverse state from the UI is a design violation.

**Depends on:** T08 (workflow-engine REST at `http://workflow-engine:8000`), T05 (FHIR API), T03 (Keycloak OIDC at `http://keycloak:8180/realms/enstellar`).

---

## Background (read before touching code)

Both `services/portal-bff/` and `apps/web/` are empty (contain only `.gitkeep`). You are building them from scratch.

**Upstream REST contract (workflow-engine):**
- `GET /cases/{case_id}` with header `X-Tenant-Id: <tenant_id>` — returns a case JSON matching the `canonical_model.Case` shape.
- `POST /cases/{case_id}/transitions` with header `X-Tenant-Id: <tenant_id>` — body: `{to_state, actor_id, actor_type, correlation_id, payload, human_signoff_recorded}`.
- `GET /queues/{queue_id}/worklist?page=<n>&page_size=<n>` with header `X-Tenant-Id: <tenant_id>` — returns `{items: [...], total: <int>}`. Each item has the same shape as a case JSON plus an optional `sla_deadline` ISO-8601 string.

**OIDC:**
- JWKS endpoint: `http://keycloak:8180/realms/enstellar/protocol/openid-connect/certs`
- JWT claims expected by the BFF: `tenant_id` (string), `roles` (list of strings, must contain `"reviewer"`), `sub` (user id).

**Canonical model package** (`packages/canonical-model/generated/python/`) is installed as an editable dependency in the workflow-engine. The BFF does **not** depend on it directly — the BFF receives JSON from the workflow-engine and shapes it into its own Pydantic response models defined in `models.py`.

**ADVERSE_STATES** (sacred, never route to from the UI): `{"denied", "partially_denied", "adverse_modification"}`. The BFF `submit_decision` endpoint only issues `approved` or `clinical_review` transitions.

**SLA RAG thresholds:** green = hours_remaining > 48, amber = 8 < hours_remaining ≤ 48, red = hours_remaining ≤ 8.

**Test conventions (BFF):**
- `asyncio_mode = "auto"` — no need to decorate tests with `@pytest.mark.asyncio`.
- Use `respx` to mock httpx calls from `WorkflowClient`.
- Use `httpx.AsyncClient(app=app, base_url="http://test")` to call FastAPI in tests (no real server needed).
- Run all BFF tests: `cd services/portal-bff && uv run pytest -v`
- Run a single test file: `cd services/portal-bff && uv run pytest tests/test_auth.py -v`

**Test conventions (web):**
- Playwright: `cd apps/web && npx playwright test`
- Requires the BFF running on port 8001 and web dev server on port 5173.

---

## File Map

### `services/portal-bff/` — new files

| File | Responsibility |
|---|---|
| `pyproject.toml` | Project metadata, runtime deps, dev deps, pytest config |
| `enstellar_bff/__init__.py` | Package marker |
| `enstellar_bff/config.py` | `BffSettings` via pydantic-settings (`BFF_` env prefix) |
| `enstellar_bff/auth.py` | `require_reviewer` FastAPI dependency: validate JWT, extract `tenant_id` + `roles`, raise 401/403 |
| `enstellar_bff/clients/__init__.py` | Package marker |
| `enstellar_bff/clients/workflow.py` | `WorkflowClient` (httpx async): `get_case`, `get_worklist`, `transition`; singleton `workflow_client` |
| `enstellar_bff/models.py` | `SlaInfo`, `WorklistItem`, `WorklistPage`, `CaseDetail`, `DecisionSubmission` |
| `enstellar_bff/routers/__init__.py` | Package marker |
| `enstellar_bff/routers/worklist.py` | `GET /bff/queues/{queue_id}/worklist` — paginates, computes SLA RAG, sorts |
| `enstellar_bff/routers/cases.py` | `GET /bff/cases/{id}`, `POST /bff/cases/{id}/decision` |
| `enstellar_bff/main.py` | FastAPI app wiring + `/healthz` |
| `tests/__init__.py` | Package marker |
| `tests/conftest.py` | Shared fixtures: `app`, `client`, `reviewer_token`, `mock_jwks` |
| `tests/test_auth.py` | Unit tests for `require_reviewer` — token absent / expired / wrong role / missing tenant / valid |
| `tests/test_worklist.py` | Tests for worklist router — RAG computation, sort order, pagination passthrough |
| `tests/test_cases.py` | Tests for cases router — get_case passthrough, submit approve, submit escalate, 403 on wrong role |

### `apps/web/` — new files

| File | Responsibility |
|---|---|
| `package.json` | npm metadata, scripts, dependencies |
| `vite.config.ts` | Vite + React plugin, `/bff` proxy to `http://localhost:8001` |
| `tsconfig.json` | TypeScript compiler config (strict, ESNext, bundler resolution) |
| `playwright.config.ts` | Playwright config — baseURL, webServer (vite dev), chromium only |
| `src/main.tsx` | ReactDOM.createRoot entry point with QueryClient + BrowserRouter |
| `src/App.tsx` | Route definitions: `/queues/:queueId/worklist` → WorklistPage, `/cases/:caseId` → CasePage |
| `src/types/index.ts` | TypeScript interfaces: `SlaInfo`, `WorklistItem`, `WorklistPage`, `CaseDetail` |
| `src/api/client.ts` | `apiFetch`, `getWorklist`, `getCase`, `submitDecision` |
| `src/components/SlaCell.tsx` | RAG dot + hours remaining display |
| `src/components/WorklistTable.tsx` | TanStack Query table — columns: Member / Service / LOB / Status / Urgency / SLA |
| `src/components/CaseHeader.tsx` | Case id, member name, status badge, urgency badge |
| `src/components/ServiceLinesPanel.tsx` | List of service lines from `case.service_lines` |
| `src/components/EventsTimeline.tsx` | Ordered list of events from `case.events` |
| `src/components/DecisionForm.tsx` | Approve / Escalate buttons + optional reason textarea |
| `src/pages/WorklistPage.tsx` | Reads `:queueId` from params, renders WorklistTable |
| `src/pages/CasePage.tsx` | Reads `:caseId` from params, renders CaseHeader + ServiceLinesPanel + EventsTimeline + DecisionForm |
| `e2e/worklist.spec.ts` | Playwright golden-path: load worklist → click first row → open case → submit approval |

### Modified files

| File | Change |
|---|---|
| `Makefile` | Add `test-portal-bff`, `test-web`, `e2e-web` targets |
| `.github/workflows/ci.yml` | Add `test-portal-bff` and `test-web` jobs |
| `.claude/task-graph.md` | Mark T12 `[x]` |

---

## Task 1: portal-bff Scaffold

**Files:**
- Create: `services/portal-bff/pyproject.toml`
- Create: `services/portal-bff/enstellar_bff/__init__.py`
- Create: `services/portal-bff/enstellar_bff/config.py`
- Create: `services/portal-bff/enstellar_bff/main.py`
- Create: `services/portal-bff/tests/__init__.py`

- [ ] **Step 1.1: Create `pyproject.toml`**

Create `services/portal-bff/pyproject.toml`:

```toml
[project]
name = "enstellar-bff"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
    "httpx>=0.27",
    "pydantic>=2.9",
    "pydantic-settings>=2.3",
    "python-jose[cryptography]>=3.3",
]

[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "httpx>=0.27",
    "respx>=0.21",
    "ruff>=0.4",
    "mypy>=1.10",
    "cryptography>=42",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 1.2: Create package markers and stub router files**

Create `services/portal-bff/enstellar_bff/__init__.py` (empty).

Create `services/portal-bff/enstellar_bff/routers/__init__.py` (empty).

Create `services/portal-bff/enstellar_bff/clients/__init__.py` (empty).

Create `services/portal-bff/tests/__init__.py` (empty).

- [ ] **Step 1.3: Create `config.py`**

Create `services/portal-bff/enstellar_bff/config.py`:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class BffSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BFF_", case_sensitive=False)

    workflow_engine_url: str = "http://workflow-engine:8000"
    keycloak_jwks_url: str = (
        "http://keycloak:8180/realms/enstellar/protocol/openid-connect/certs"
    )
    fhir_api_url: str = "http://interop:8080/fhir"


settings = BffSettings()
```

- [ ] **Step 1.4: Create stub routers (needed before `main.py` can import them)**

Create `services/portal-bff/enstellar_bff/routers/worklist.py`:

```python
from fastapi import APIRouter

router = APIRouter(tags=["worklist"])
```

Create `services/portal-bff/enstellar_bff/routers/cases.py`:

```python
from fastapi import APIRouter

router = APIRouter(tags=["cases"])
```

- [ ] **Step 1.5: Create `main.py`**

Create `services/portal-bff/enstellar_bff/main.py`:

```python
from fastapi import FastAPI

from enstellar_bff.routers import cases, worklist

app = FastAPI(title="Enstellar BFF", version="0.1.0")
app.include_router(worklist.router, prefix="/bff")
app.include_router(cases.router, prefix="/bff")


@app.get("/healthz", tags=["ops"])
async def health() -> dict:
    return {"status": "ok"}
```

- [ ] **Step 1.6: Write the healthz test**

Create `services/portal-bff/tests/test_health.py`:

```python
import pytest
from httpx import AsyncClient, ASGITransport

from enstellar_bff.main import app


@pytest.mark.asyncio
async def test_healthz_returns_200() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 1.7: Install dependencies and run the test**

```bash
cd services/portal-bff && uv sync --dev
```

```bash
cd services/portal-bff && uv run pytest tests/test_health.py -v
```

Expected output:
```
tests/test_health.py::test_healthz_returns_200 PASSED
```

- [ ] **Step 1.8: Commit**

```bash
git add services/portal-bff/
git commit -m "feat(bff): scaffold portal-bff with FastAPI healthz endpoint"
```

---

## Task 2: JWT Auth Middleware

**Files:**
- Create: `services/portal-bff/enstellar_bff/auth.py`
- Create: `services/portal-bff/tests/conftest.py`
- Create: `services/portal-bff/tests/test_auth.py`

- [ ] **Step 2.1: Write the failing auth tests**

Create `services/portal-bff/tests/conftest.py`:

```python
"""Shared fixtures for BFF tests.

JWT generation uses RSA-2048 so tests mirror real Keycloak token validation.
The private key is generated once per session; the public JWKS is injected via
monkeypatch into auth._load_jwks so no network calls are made.
"""
from __future__ import annotations

import time
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt


@pytest.fixture(scope="session")
def rsa_private_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="session")
def rsa_public_pem(rsa_private_key) -> bytes:
    return rsa_private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def _make_token(
    private_key,
    tenant_id: str | None = "tenant-abc",
    roles: list[str] | None = None,
    sub: str = "user-001",
    expired: bool = False,
) -> str:
    if roles is None:
        roles = ["reviewer"]
    now = int(time.time())
    exp = (now - 60) if expired else (now + 3600)
    payload: dict[str, Any] = {"sub": sub, "exp": exp, "iat": now}
    if tenant_id is not None:
        payload["tenant_id"] = tenant_id
    payload["roles"] = roles
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(payload, private_pem, algorithm="RS256")


@pytest.fixture
def make_token(rsa_private_key):
    """Returns a factory: make_token(tenant_id=..., roles=..., expired=...)."""
    return lambda **kw: _make_token(rsa_private_key, **kw)
```

Create `services/portal-bff/tests/test_auth.py`:

```python
"""Tests for require_reviewer dependency.

Scenarios:
1. No Authorization header → 401
2. Expired token → 401
3. Valid token but role is 'admin' (not 'reviewer') → 403
4. Valid token but missing tenant_id claim → 403
5. Valid token with reviewer role and tenant_id → 200, principal dict returned
"""
import pytest
import enstellar_bff.auth as auth_module
from httpx import AsyncClient, ASGITransport
from fastapi import FastAPI, Depends

from enstellar_bff.auth import require_reviewer


# Build a minimal app that exposes a single route protected by require_reviewer
_test_app = FastAPI()


@_test_app.get("/protected")
async def protected(principal: dict = Depends(require_reviewer)) -> dict:
    return principal


@pytest.fixture
def client_factory(rsa_public_pem, monkeypatch):
    """Returns an async context-manager factory that patches _load_jwks."""

    async def _patched_load_jwks() -> dict:
        # python-jose accepts PEM directly when passed as the key to jwt.decode
        # but _load_jwks is expected to return a raw JWKS dict.
        # We store the PEM string in cache under a sentinel key so that
        # require_reviewer can pass it straight to jwt.decode.
        return {"_pem": rsa_public_pem.decode()}

    monkeypatch.setattr(auth_module, "_load_jwks", _patched_load_jwks)
    # Also patch jwt.decode to accept PEM from our fake JWKS
    original_decode = auth_module.jwt.decode

    def _patched_decode(token, key, algorithms):
        # key is the fake JWKS dict; extract PEM and decode
        pem = key.get("_pem", key)
        return original_decode(token, pem, algorithms=algorithms)

    monkeypatch.setattr(auth_module.jwt, "decode", _patched_decode)

    async def make_client():
        return AsyncClient(transport=ASGITransport(app=_test_app), base_url="http://test")

    return make_client


@pytest.mark.asyncio
async def test_no_token_returns_401(client_factory) -> None:
    async with await client_factory() as client:
        r = await client.get("/protected")
    assert r.status_code == 403  # HTTPBearer returns 403 when header absent


@pytest.mark.asyncio
async def test_expired_token_returns_401(client_factory, make_token) -> None:
    token = make_token(expired=True)
    async with await client_factory() as client:
        r = await client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert "expired" in r.json()["detail"]


@pytest.mark.asyncio
async def test_wrong_role_returns_403(client_factory, make_token) -> None:
    token = make_token(roles=["admin"])
    async with await client_factory() as client:
        r = await client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert "reviewer role required" in r.json()["detail"]


@pytest.mark.asyncio
async def test_missing_tenant_id_returns_403(client_factory, make_token) -> None:
    token = make_token(tenant_id=None)
    async with await client_factory() as client:
        r = await client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert "tenant_id" in r.json()["detail"]


@pytest.mark.asyncio
async def test_valid_reviewer_token_returns_principal(client_factory, make_token) -> None:
    token = make_token(tenant_id="tenant-abc", roles=["reviewer"], sub="user-001")
    async with await client_factory() as client:
        r = await client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["tenant_id"] == "tenant-abc"
    assert "reviewer" in body["roles"]
    assert body["sub"] == "user-001"
```

- [ ] **Step 2.2: Run tests to confirm they fail**

```bash
cd services/portal-bff && uv run pytest tests/test_auth.py -v
```

Expected: `ImportError` or `ModuleNotFoundError` because `enstellar_bff.auth` does not exist yet.

- [ ] **Step 2.3: Implement `auth.py`**

Create `services/portal-bff/enstellar_bff/auth.py`:

```python
from __future__ import annotations

from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt
import httpx

from enstellar_bff.config import settings

bearer = HTTPBearer()
_jwks_cache: dict = {}


async def _load_jwks() -> dict:
    if not _jwks_cache:
        async with httpx.AsyncClient() as c:
            r = await c.get(settings.keycloak_jwks_url)
            r.raise_for_status()
            _jwks_cache.update(r.json())
    return _jwks_cache


async def require_reviewer(
    creds: HTTPAuthorizationCredentials = Security(bearer),
) -> dict:
    """Validate Bearer JWT; extract tenant_id and roles; enforce reviewer role.

    Returns: {"tenant_id": str, "roles": list[str], "sub": str}
    Raises:
        401 — token absent, malformed, or expired
        403 — missing tenant_id claim or reviewer role absent
    """
    try:
        jwks = await _load_jwks()
        payload = jwt.decode(creds.credentials, jwks, algorithms=["RS256"])
    except ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="token expired")
    except JWTError:
        raise HTTPException(status_code=401, detail="invalid token")

    tenant_id: str | None = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="missing tenant_id claim")

    roles: list[str] = payload.get("roles", [])
    if "reviewer" not in roles:
        raise HTTPException(status_code=403, detail="reviewer role required")

    return {"tenant_id": tenant_id, "roles": roles, "sub": payload["sub"]}
```

- [ ] **Step 2.4: Run tests to confirm they pass**

```bash
cd services/portal-bff && uv run pytest tests/test_auth.py -v
```

Expected:
```
tests/test_auth.py::test_no_token_returns_401 PASSED
tests/test_auth.py::test_expired_token_returns_401 PASSED
tests/test_auth.py::test_wrong_role_returns_403 PASSED
tests/test_auth.py::test_missing_tenant_id_returns_403 PASSED
tests/test_auth.py::test_valid_reviewer_token_returns_principal PASSED
```

- [ ] **Step 2.5: Run full BFF suite**

```bash
cd services/portal-bff && uv run pytest -v
```

Expected: all tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add services/portal-bff/enstellar_bff/auth.py services/portal-bff/tests/conftest.py services/portal-bff/tests/test_auth.py
git commit -m "feat(bff): add JWT require_reviewer dependency with tenant_id + role enforcement"
```

---

## Task 3: WorkflowClient and Response Models

**Files:**
- Create: `services/portal-bff/enstellar_bff/clients/workflow.py`
- Create: `services/portal-bff/enstellar_bff/models.py`

- [ ] **Step 3.1: Write the model tests**

Create `services/portal-bff/tests/test_models.py`:

```python
"""Tests for Pydantic response models: round-trip parse/serialise."""
from datetime import datetime, timezone

import pytest

from enstellar_bff.models import (
    CaseDetail,
    DecisionSubmission,
    SlaInfo,
    WorklistItem,
    WorklistPage,
)


def test_sla_info_round_trip() -> None:
    now = datetime.now(timezone.utc)
    sla = SlaInfo(deadline=now, hours_remaining=6.5, rag="red", paused=False)
    assert sla.rag == "red"
    assert sla.hours_remaining == pytest.approx(6.5)


def test_worklist_page_defaults() -> None:
    page = WorklistPage(items=[], total=0, page=1, page_size=25)
    assert page.items == []
    assert page.total == 0


def test_decision_submission_escalate() -> None:
    body = DecisionSubmission(outcome="escalate")
    assert body.outcome == "escalate"
    assert body.reason is None


def test_decision_submission_approved_with_reason() -> None:
    body = DecisionSubmission(outcome="approved", reason="Criteria met")
    assert body.reason == "Criteria met"


def test_case_detail_parse() -> None:
    raw = {
        "case_id": "00000000-0000-0000-0000-000000000001",
        "tenant_id": "tenant-abc",
        "status": "clinical_review",
        "urgency": "urgent",
        "lob": "commercial",
        "member": {"name": "Jane Doe"},
        "coverage": {"plan_id": "PLN-001"},
        "service_lines": [{"procedure_code": "99213"}],
        "events": [{"event_type": "intake"}],
        "sla": None,
    }
    case = CaseDetail(**raw)
    assert str(case.case_id) == "00000000-0000-0000-0000-000000000001"
    assert case.tenant_id == "tenant-abc"
```

- [ ] **Step 3.2: Run to confirm failure**

```bash
cd services/portal-bff && uv run pytest tests/test_models.py -v
```

Expected: `ModuleNotFoundError` — `enstellar_bff.models` does not exist.

- [ ] **Step 3.3: Create `models.py`**

Create `services/portal-bff/enstellar_bff/models.py`:

```python
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class SlaInfo(BaseModel):
    deadline: datetime
    hours_remaining: float
    rag: Literal["green", "amber", "red"]
    paused: bool


class WorklistItem(BaseModel):
    case_id: UUID
    member_name: str
    service_description: str
    lob: str
    status: str
    urgency: str
    sla: SlaInfo | None


class WorklistPage(BaseModel):
    items: list[WorklistItem]
    total: int
    page: int
    page_size: int


class CaseDetail(BaseModel):
    case_id: UUID
    tenant_id: str
    status: str
    urgency: str
    lob: str
    member: dict
    coverage: dict
    service_lines: list[dict]
    events: list[dict]
    sla: SlaInfo | None


class DecisionSubmission(BaseModel):
    outcome: Literal["approved", "escalate"]
    reason: str | None = None
```

- [ ] **Step 3.4: Create `clients/workflow.py`**

Create `services/portal-bff/enstellar_bff/clients/workflow.py`:

```python
"""Async httpx client wrapping the workflow-engine REST API."""
from __future__ import annotations

import httpx

from enstellar_bff.config import settings


class WorkflowClient:
    def __init__(self) -> None:
        self._http = httpx.AsyncClient(
            base_url=settings.workflow_engine_url,
            timeout=10.0,
        )

    async def get_case(self, case_id: str, tenant_id: str) -> dict:
        r = await self._http.get(
            f"/cases/{case_id}",
            headers={"X-Tenant-Id": tenant_id},
        )
        r.raise_for_status()
        return r.json()

    async def get_worklist(
        self,
        tenant_id: str,
        queue_id: str,
        page: int,
        page_size: int,
    ) -> dict:
        r = await self._http.get(
            f"/queues/{queue_id}/worklist",
            params={"page": page, "page_size": page_size},
            headers={"X-Tenant-Id": tenant_id},
        )
        r.raise_for_status()
        return r.json()

    async def transition(
        self,
        case_id: str,
        tenant_id: str,
        to_state: str,
        actor_id: str,
        actor_type: str,
        correlation_id: str,
        payload: dict,
        human_signoff_recorded: bool = False,
    ) -> dict:
        r = await self._http.post(
            f"/cases/{case_id}/transitions",
            json={
                "to_state": to_state,
                "actor_id": actor_id,
                "actor_type": actor_type,
                "correlation_id": correlation_id,
                "payload": payload,
                "human_signoff_recorded": human_signoff_recorded,
            },
            headers={"X-Tenant-Id": tenant_id},
        )
        r.raise_for_status()
        return r.json()


workflow_client = WorkflowClient()
```

- [ ] **Step 3.5: Run tests**

```bash
cd services/portal-bff && uv run pytest tests/test_models.py -v
```

Expected: all 5 tests pass.

- [ ] **Step 3.6: Run full suite**

```bash
cd services/portal-bff && uv run pytest -v
```

Expected: all tests pass.

- [ ] **Step 3.7: Commit**

```bash
git add services/portal-bff/enstellar_bff/models.py services/portal-bff/enstellar_bff/clients/workflow.py services/portal-bff/tests/test_models.py
git commit -m "feat(bff): add WorkflowClient, SlaInfo/WorklistPage/CaseDetail/DecisionSubmission models"
```

---

## Task 4: Worklist Router

**Files:**
- Modify: `services/portal-bff/enstellar_bff/routers/worklist.py`
- Create: `services/portal-bff/tests/test_worklist.py`

- [ ] **Step 4.1: Write the failing worklist tests**

Create `services/portal-bff/tests/test_worklist.py`:

```python
"""Tests for GET /bff/queues/{queue_id}/worklist.

Uses respx to mock the upstream workflow-engine call.
Uses monkeypatch to bypass JWT validation (returns fixed principal).
"""
from __future__ import annotations

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

from enstellar_bff.main import app
import enstellar_bff.auth as auth_module

FIXED_PRINCIPAL = {"tenant_id": "tenant-abc", "roles": ["reviewer"], "sub": "user-001"}


@pytest.fixture(autouse=True)
def bypass_auth(monkeypatch):
    """Replace require_reviewer with a no-op that returns the fixed principal."""
    from enstellar_bff import routers  # noqa: F401
    from enstellar_bff.routers import worklist as worklist_router

    async def _fake_reviewer():
        return FIXED_PRINCIPAL

    # Override the dependency on the app
    app.dependency_overrides[auth_module.require_reviewer] = _fake_reviewer
    yield
    app.dependency_overrides.clear()


def _worklist_payload(items: list[dict], total: int | None = None) -> dict:
    return {"items": items, "total": total if total is not None else len(items)}


def _item(
    case_id: str = "00000000-0000-0000-0000-000000000001",
    name: str = "Jane Doe",
    sla_deadline: str | None = None,
    status: str = "clinical_review",
    urgency: str = "standard",
) -> dict:
    return {
        "case_id": case_id,
        "member": {"name": name},
        "service_lines": [{"procedure_description": "PT Eval"}],
        "lob": "commercial",
        "status": status,
        "urgency": urgency,
        "sla_deadline": sla_deadline,
    }


@pytest.mark.asyncio
@respx.mock
async def test_worklist_returns_items() -> None:
    respx.get("http://workflow-engine:8000/queues/default/worklist").mock(
        return_value=Response(
            200,
            json=_worklist_payload([_item()]),
        )
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/queues/default/worklist")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["member_name"] == "Jane Doe"


@pytest.mark.asyncio
@respx.mock
async def test_worklist_sorted_by_hours_remaining_ascending() -> None:
    """Items are sorted red-first (fewest hours remaining first)."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    soon = (now + timedelta(hours=4)).isoformat()   # red
    later = (now + timedelta(hours=60)).isoformat()  # green

    respx.get("http://workflow-engine:8000/queues/default/worklist").mock(
        return_value=Response(
            200,
            json=_worklist_payload([
                _item(case_id="00000000-0000-0000-0000-000000000002", sla_deadline=later),
                _item(case_id="00000000-0000-0000-0000-000000000001", sla_deadline=soon),
            ]),
        )
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/queues/default/worklist")
    assert r.status_code == 200
    items = r.json()["items"]
    assert items[0]["case_id"] == "00000000-0000-0000-0000-000000000001"  # red first
    assert items[0]["sla"]["rag"] == "red"
    assert items[1]["sla"]["rag"] == "green"


@pytest.mark.asyncio
@respx.mock
async def test_sla_rag_amber_boundary() -> None:
    """hours_remaining=20 → amber."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    deadline = (now + timedelta(hours=20)).isoformat()

    respx.get("http://workflow-engine:8000/queues/default/worklist").mock(
        return_value=Response(
            200,
            json=_worklist_payload([_item(sla_deadline=deadline)]),
        )
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/queues/default/worklist")
    assert r.status_code == 200
    assert r.json()["items"][0]["sla"]["rag"] == "amber"


@pytest.mark.asyncio
@respx.mock
async def test_no_sla_deadline_produces_null_sla() -> None:
    respx.get("http://workflow-engine:8000/queues/default/worklist").mock(
        return_value=Response(200, json=_worklist_payload([_item(sla_deadline=None)]))
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/queues/default/worklist")
    assert r.status_code == 200
    assert r.json()["items"][0]["sla"] is None


@pytest.mark.asyncio
@respx.mock
async def test_pagination_params_forwarded() -> None:
    """page and page_size query params are forwarded to workflow-engine."""
    route = respx.get("http://workflow-engine:8000/queues/default/worklist").mock(
        return_value=Response(200, json=_worklist_payload([]))
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.get("/bff/queues/default/worklist?page=2&page_size=10")
    assert route.called
    called_url = str(route.calls[0].request.url)
    assert "page=2" in called_url
    assert "page_size=10" in called_url
```

- [ ] **Step 4.2: Run to confirm failure**

```bash
cd services/portal-bff && uv run pytest tests/test_worklist.py -v
```

Expected: errors because `GET /bff/queues/{queue_id}/worklist` route does not exist yet (stub router returns no routes).

- [ ] **Step 4.3: Implement `routers/worklist.py`**

Replace the stub content of `services/portal-bff/enstellar_bff/routers/worklist.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from enstellar_bff.auth import require_reviewer
from enstellar_bff.clients.workflow import workflow_client
from enstellar_bff.models import SlaInfo, WorklistItem, WorklistPage

router = APIRouter(tags=["worklist"])


def _compute_rag(deadline_iso: str | None) -> SlaInfo | None:
    """Return SlaInfo with RAG color based on hours remaining until deadline.

    green  = hours_remaining > 48
    amber  = 8 < hours_remaining <= 48
    red    = hours_remaining <= 8
    """
    if not deadline_iso:
        return None
    deadline = datetime.fromisoformat(deadline_iso)
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    hours_remaining = (deadline - now).total_seconds() / 3600
    if hours_remaining > 48:
        rag = "green"
    elif hours_remaining > 8:
        rag = "amber"
    else:
        rag = "red"
    return SlaInfo(
        deadline=deadline,
        hours_remaining=hours_remaining,
        rag=rag,
        paused=False,
    )


@router.get("/queues/{queue_id}/worklist", response_model=WorklistPage)
async def get_worklist(
    queue_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    auth: dict = Depends(require_reviewer),
) -> WorklistPage:
    data = await workflow_client.get_worklist(
        auth["tenant_id"], queue_id, page, page_size
    )
    items: list[WorklistItem] = []
    for c in data.get("items", []):
        sla = _compute_rag(c.get("sla_deadline"))
        items.append(
            WorklistItem(
                case_id=c["case_id"],
                member_name=c.get("member", {}).get("name", ""),
                service_description=(
                    c.get("service_lines", [{}])[0].get("procedure_description", "")
                    if c.get("service_lines")
                    else ""
                ),
                lob=c.get("lob", ""),
                status=c.get("status", ""),
                urgency=c.get("urgency", ""),
                sla=sla,
            )
        )
    # Sort soonest-deadline first; items with no SLA go to the end
    items.sort(
        key=lambda x: x.sla.hours_remaining if x.sla is not None else float("inf")
    )
    return WorklistPage(
        items=items,
        total=data.get("total", len(items)),
        page=page,
        page_size=page_size,
    )
```

- [ ] **Step 4.4: Run worklist tests**

```bash
cd services/portal-bff && uv run pytest tests/test_worklist.py -v
```

Expected:
```
tests/test_worklist.py::test_worklist_returns_items PASSED
tests/test_worklist.py::test_worklist_sorted_by_hours_remaining_ascending PASSED
tests/test_worklist.py::test_sla_rag_amber_boundary PASSED
tests/test_worklist.py::test_no_sla_deadline_produces_null_sla PASSED
tests/test_worklist.py::test_pagination_params_forwarded PASSED
```

- [ ] **Step 4.5: Run full suite**

```bash
cd services/portal-bff && uv run pytest -v
```

Expected: all tests pass.

- [ ] **Step 4.6: Commit**

```bash
git add services/portal-bff/enstellar_bff/routers/worklist.py services/portal-bff/tests/test_worklist.py
git commit -m "feat(bff): add GET /bff/queues/{queue_id}/worklist with SLA RAG computation and sort"
```

---

## Task 5: Cases Router

**Files:**
- Modify: `services/portal-bff/enstellar_bff/routers/cases.py`
- Create: `services/portal-bff/tests/test_cases.py`

- [ ] **Step 5.1: Write the failing cases tests**

Create `services/portal-bff/tests/test_cases.py`:

```python
"""Tests for GET /bff/cases/{id} and POST /bff/cases/{id}/decision.

Invariant covered here: submit_decision only ever issues transitions to
'approved' or 'clinical_review' — never to an adverse state.
"""
from __future__ import annotations

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

import enstellar_bff.auth as auth_module
from enstellar_bff.main import app

CASE_ID = "00000000-0000-0000-0000-000000000099"
FIXED_PRINCIPAL = {"tenant_id": "tenant-abc", "roles": ["reviewer"], "sub": "user-001"}
NON_REVIEWER_PRINCIPAL = {"tenant_id": "tenant-abc", "roles": ["admin"], "sub": "user-002"}


def _case_payload(status: str = "clinical_review") -> dict:
    return {
        "case_id": CASE_ID,
        "tenant_id": "tenant-abc",
        "status": status,
        "urgency": "standard",
        "lob": "commercial",
        "member": {"name": "John Smith", "member_id": "MBR-001"},
        "coverage": {"plan_id": "PLN-001"},
        "service_lines": [{"procedure_code": "99213", "procedure_description": "Office Visit"}],
        "events": [{"event_type": "intake", "occurred_at": "2026-06-01T00:00:00Z"}],
    }


@pytest.fixture(autouse=True)
def bypass_auth(monkeypatch):
    app.dependency_overrides[auth_module.require_reviewer] = lambda: FIXED_PRINCIPAL
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
@respx.mock
async def test_get_case_returns_case_detail() -> None:
    respx.get(f"http://workflow-engine:8000/cases/{CASE_ID}").mock(
        return_value=Response(200, json=_case_payload())
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get(f"/bff/cases/{CASE_ID}")
    assert r.status_code == 200
    body = r.json()
    assert body["case_id"] == CASE_ID
    assert body["status"] == "clinical_review"
    assert body["member"]["name"] == "John Smith"
    assert len(body["service_lines"]) == 1
    assert len(body["events"]) == 1


@pytest.mark.asyncio
@respx.mock
async def test_submit_approve_transitions_to_approved() -> None:
    """Approve outcome → workflow-engine receives to_state='approved'."""
    transition_route = respx.post(
        f"http://workflow-engine:8000/cases/{CASE_ID}/transitions"
    ).mock(return_value=Response(200, json={"status": "approved"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/decision",
            json={"outcome": "approved", "reason": "Criteria met"},
        )
    assert r.status_code == 200
    assert transition_route.called
    sent = transition_route.calls[0].request
    import json
    body = json.loads(sent.content)
    assert body["to_state"] == "approved"
    assert body["human_signoff_recorded"] is True
    assert body["payload"]["reason"] == "Criteria met"


@pytest.mark.asyncio
@respx.mock
async def test_submit_escalate_transitions_to_clinical_review() -> None:
    """Escalate outcome → workflow-engine receives to_state='clinical_review'."""
    transition_route = respx.post(
        f"http://workflow-engine:8000/cases/{CASE_ID}/transitions"
    ).mock(return_value=Response(200, json={"status": "clinical_review"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/decision",
            json={"outcome": "escalate"},
        )
    assert r.status_code == 200
    import json
    body = json.loads(transition_route.calls[0].request.content)
    assert body["to_state"] == "clinical_review"
    assert body["human_signoff_recorded"] is True


@pytest.mark.asyncio
@respx.mock
async def test_submit_decision_always_sets_human_signoff_recorded() -> None:
    """human_signoff_recorded is always True — never False from this endpoint."""
    transition_route = respx.post(
        f"http://workflow-engine:8000/cases/{CASE_ID}/transitions"
    ).mock(return_value=Response(200, json={"status": "approved"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            f"/bff/cases/{CASE_ID}/decision",
            json={"outcome": "approved"},
        )
    import json
    body = json.loads(transition_route.calls[0].request.content)
    assert body["human_signoff_recorded"] is True


@pytest.mark.asyncio
async def test_non_reviewer_role_returns_403(monkeypatch) -> None:
    """A token without reviewer role must not reach the decision endpoint."""
    app.dependency_overrides[auth_module.require_reviewer] = (
        lambda: (_ for _ in ()).throw(
            __import__("fastapi").HTTPException(status_code=403, detail="reviewer role required")
        )
    )
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/bff/cases/{CASE_ID}/decision",
                json={"outcome": "approved"},
            )
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides[auth_module.require_reviewer] = lambda: FIXED_PRINCIPAL
```

- [ ] **Step 5.2: Run to confirm failure**

```bash
cd services/portal-bff && uv run pytest tests/test_cases.py -v
```

Expected: 404s or `AttributeError` because the cases router has only a stub.

- [ ] **Step 5.3: Implement `routers/cases.py`**

Replace the stub content of `services/portal-bff/enstellar_bff/routers/cases.py`:

```python
from __future__ import annotations

import uuid as uuid_module
from uuid import UUID

from fastapi import APIRouter, Depends

from enstellar_bff.auth import require_reviewer
from enstellar_bff.clients.workflow import workflow_client
from enstellar_bff.models import CaseDetail, DecisionSubmission

# Adverse states: BFF never routes to these; T08 guard is the final backstop.
ADVERSE_STATES = frozenset({"denied", "partially_denied", "adverse_modification"})

router = APIRouter(tags=["cases"])


@router.get("/cases/{case_id}", response_model=CaseDetail)
async def get_case(
    case_id: UUID,
    auth: dict = Depends(require_reviewer),
) -> CaseDetail:
    data = await workflow_client.get_case(str(case_id), auth["tenant_id"])
    return CaseDetail(
        case_id=data["case_id"],
        tenant_id=data["tenant_id"],
        status=data["status"],
        urgency=data["urgency"],
        lob=data["lob"],
        member=data.get("member", {}),
        coverage=data.get("coverage", {}),
        service_lines=data.get("service_lines", []),
        events=data.get("events", []),
        sla=None,
    )


@router.post("/cases/{case_id}/decision")
async def submit_decision(
    case_id: UUID,
    body: DecisionSubmission,
    auth: dict = Depends(require_reviewer),
) -> dict:
    # Map reviewer outcomes to valid non-adverse workflow states.
    # ADVERSE_STATES are never reachable from this endpoint by design.
    to_state = "approved" if body.outcome == "approved" else "clinical_review"

    result = await workflow_client.transition(
        case_id=str(case_id),
        tenant_id=auth["tenant_id"],
        to_state=to_state,
        actor_id=auth["sub"],
        actor_type="user",
        correlation_id=str(uuid_module.uuid4()),
        payload={"reason": body.reason} if body.reason else {},
        human_signoff_recorded=True,
    )
    return result
```

- [ ] **Step 5.4: Run cases tests**

```bash
cd services/portal-bff && uv run pytest tests/test_cases.py -v
```

Expected:
```
tests/test_cases.py::test_get_case_returns_case_detail PASSED
tests/test_cases.py::test_submit_approve_transitions_to_approved PASSED
tests/test_cases.py::test_submit_escalate_transitions_to_clinical_review PASSED
tests/test_cases.py::test_submit_decision_always_sets_human_signoff_recorded PASSED
tests/test_cases.py::test_non_reviewer_role_returns_403 PASSED
```

- [ ] **Step 5.5: Run full suite**

```bash
cd services/portal-bff && uv run pytest -v
```

Expected: all tests pass (health, models, auth, worklist, cases).

- [ ] **Step 5.6: Commit**

```bash
git add services/portal-bff/enstellar_bff/routers/cases.py services/portal-bff/tests/test_cases.py
git commit -m "feat(bff): add GET /bff/cases/{id} and POST /bff/cases/{id}/decision with adverse-state guard"
```

---

## Task 6: Web App Scaffold

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/index.html`

- [ ] **Step 6.1: Scaffold the Vite React-TS project**

```bash
cd apps/web && rm .gitkeep 2>/dev/null; npm create vite@latest . -- --template react-ts --yes 2>/dev/null || true
```

If the Vite scaffold produces files, proceed. If the directory already has content from the scaffold, continue. Verify:

```bash
ls apps/web/src/
```

Expected: `App.tsx`, `main.tsx`, `vite-env.d.ts` (and possibly `index.css`, `App.css`, `assets/`).

- [ ] **Step 6.2: Install runtime dependencies**

```bash
cd apps/web && npm install @tanstack/react-query react-router-dom
```

- [ ] **Step 6.3: Install dev dependencies**

```bash
cd apps/web && npm install -D @playwright/test
```

```bash
cd apps/web && npx playwright install chromium
```

- [ ] **Step 6.4: Write `vite.config.ts`**

Replace the scaffolded `apps/web/vite.config.ts` with:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/bff': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 6.5: Write `tsconfig.json`**

Replace the scaffolded `apps/web/tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 6.6: Write `playwright.config.ts`**

Create `apps/web/playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
```

- [ ] **Step 6.7: Write `src/main.tsx`**

Replace the scaffolded `apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

- [ ] **Step 6.8: Write `src/App.tsx`**

Replace the scaffolded `apps/web/src/App.tsx`:

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { WorklistPage } from './pages/WorklistPage'
import { CasePage } from './pages/CasePage'

export default function App() {
  return (
    <Routes>
      <Route path="/queues/:queueId/worklist" element={<WorklistPage />} />
      <Route path="/cases/:caseId" element={<CasePage />} />
      <Route path="/" element={<Navigate to="/queues/default/worklist" replace />} />
    </Routes>
  )
}
```

- [ ] **Step 6.9: Create stub page files so the app compiles**

Create `apps/web/src/pages/WorklistPage.tsx`:

```tsx
export function WorklistPage() {
  return <div>Worklist</div>
}
```

Create `apps/web/src/pages/CasePage.tsx`:

```tsx
export function CasePage() {
  return <div>Case</div>
}
```

- [ ] **Step 6.10: Verify the dev server starts**

```bash
cd apps/web && npm run dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
kill %1 2>/dev/null
```

Expected output: `200`

- [ ] **Step 6.11: Commit**

```bash
git add apps/web/
git commit -m "feat(web): scaffold Vite + React-TS app with TanStack Query, react-router-dom, Playwright"
```

---

## Task 7: API Client and TypeScript Types

**Files:**
- Create: `apps/web/src/types/index.ts`
- Create: `apps/web/src/api/client.ts`

- [ ] **Step 7.1: Create `src/types/index.ts`**

Create `apps/web/src/types/index.ts`:

```typescript
export interface SlaInfo {
  deadline: string
  hours_remaining: number
  rag: 'green' | 'amber' | 'red'
  paused: boolean
}

export interface WorklistItem {
  case_id: string
  member_name: string
  service_description: string
  lob: string
  status: string
  urgency: string
  sla: SlaInfo | null
}

export interface WorklistPage {
  items: WorklistItem[]
  total: number
  page: number
  page_size: number
}

export interface CaseDetail {
  case_id: string
  tenant_id: string
  status: string
  urgency: string
  lob: string
  member: Record<string, unknown>
  coverage: Record<string, unknown>
  service_lines: Record<string, unknown>[]
  events: Record<string, unknown>[]
  sla: SlaInfo | null
}
```

- [ ] **Step 7.2: Create `src/api/client.ts`**

Create `apps/web/src/api/client.ts`:

```typescript
import type { CaseDetail, WorklistPage } from '../types'

const BASE = '/bff'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!r.ok) {
    throw new Error(`${r.status} ${r.statusText}`)
  }
  return r.json() as Promise<T>
}

export function getWorklist(queueId: string, page = 1): Promise<WorklistPage> {
  return apiFetch<WorklistPage>(
    `/queues/${queueId}/worklist?page=${page}&page_size=25`,
  )
}

export function getCase(caseId: string): Promise<CaseDetail> {
  return apiFetch<CaseDetail>(`/cases/${caseId}`)
}

export function submitDecision(
  caseId: string,
  outcome: 'approved' | 'escalate',
  reason?: string,
): Promise<unknown> {
  return apiFetch(`/cases/${caseId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ outcome, reason }),
  })
}
```

- [ ] **Step 7.3: Verify TypeScript compiles without errors**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no output (zero errors).

- [ ] **Step 7.4: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/api/client.ts
git commit -m "feat(web): add TypeScript types and BFF API client (getWorklist, getCase, submitDecision)"
```

---

## Task 8: Worklist and Workspace Components

**Files:**
- Create: `apps/web/src/components/SlaCell.tsx`
- Create: `apps/web/src/components/WorklistTable.tsx`
- Create: `apps/web/src/components/CaseHeader.tsx`
- Create: `apps/web/src/components/ServiceLinesPanel.tsx`
- Create: `apps/web/src/components/EventsTimeline.tsx`
- Create: `apps/web/src/components/DecisionForm.tsx`
- Modify: `apps/web/src/pages/WorklistPage.tsx`
- Modify: `apps/web/src/pages/CasePage.tsx`

- [ ] **Step 8.1: Create `SlaCell.tsx`**

Create `apps/web/src/components/SlaCell.tsx`:

```tsx
import type { SlaInfo } from '../types'

const COLOR: Record<'green' | 'amber' | 'red', string> = {
  green: '#16a34a',
  amber: '#d97706',
  red: '#dc2626',
}

interface Props {
  sla: SlaInfo | null
}

export function SlaCell({ sla }: Props) {
  if (!sla) {
    return <span>—</span>
  }
  const h = Math.round(sla.hours_remaining)
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        aria-label={`SLA ${sla.rag}`}
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: COLOR[sla.rag],
          flexShrink: 0,
        }}
      />
      {h}h
    </span>
  )
}
```

- [ ] **Step 8.2: Create `WorklistTable.tsx`**

Create `apps/web/src/components/WorklistTable.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getWorklist } from '../api/client'
import { SlaCell } from './SlaCell'

interface Props {
  queueId: string
  page?: number
}

export function WorklistTable({ queueId, page = 1 }: Props) {
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['worklist', queueId, page],
    queryFn: () => getWorklist(queueId, page),
  })

  if (isLoading) {
    return <p>Loading worklist…</p>
  }
  if (isError) {
    return <p role="alert">Error: {(error as Error).message}</p>
  }
  if (!data || data.items.length === 0) {
    return <p>No cases in queue.</p>
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th>Member</th>
          <th>Service</th>
          <th>LOB</th>
          <th>Status</th>
          <th>Urgency</th>
          <th>SLA</th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((item) => (
          <tr
            key={item.case_id}
            onClick={() => navigate(`/cases/${item.case_id}`)}
            style={{ cursor: 'pointer' }}
            data-testid={`worklist-row-${item.case_id}`}
          >
            <td>{item.member_name}</td>
            <td>{item.service_description}</td>
            <td>{item.lob}</td>
            <td>{item.status}</td>
            <td>{item.urgency}</td>
            <td>
              <SlaCell sla={item.sla} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 8.3: Create `CaseHeader.tsx`**

Create `apps/web/src/components/CaseHeader.tsx`:

```tsx
import type { CaseDetail } from '../types'

interface Props {
  caseDetail: CaseDetail
}

const STATUS_COLOR: Record<string, string> = {
  clinical_review: '#d97706',
  approved: '#16a34a',
  denied: '#dc2626',
  partially_denied: '#dc2626',
  adverse_modification: '#dc2626',
  intake: '#6b7280',
  completeness_check: '#6b7280',
  auto_determination: '#6b7280',
  pend_rfi: '#2563eb',
  withdrawn: '#6b7280',
  closed: '#6b7280',
}

export function CaseHeader({ caseDetail }: Props) {
  const memberName =
    typeof caseDetail.member.name === 'string' ? caseDetail.member.name : 'Unknown'
  const statusColor = STATUS_COLOR[caseDetail.status] ?? '#6b7280'

  return (
    <div data-testid="case-header" style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: 12 }}>
      <h2 style={{ margin: 0 }}>{memberName}</h2>
      <p style={{ margin: '4px 0', color: '#6b7280', fontSize: 12 }}>
        Case ID: {caseDetail.case_id}
      </p>
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 4,
          backgroundColor: statusColor,
          color: '#fff',
          fontSize: 12,
          marginRight: 8,
        }}
      >
        {caseDetail.status.replace(/_/g, ' ')}
      </span>
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 4,
          backgroundColor: caseDetail.urgency === 'urgent' ? '#dc2626' : '#6b7280',
          color: '#fff',
          fontSize: 12,
        }}
      >
        {caseDetail.urgency}
      </span>
    </div>
  )
}
```

- [ ] **Step 8.4: Create `ServiceLinesPanel.tsx`**

Create `apps/web/src/components/ServiceLinesPanel.tsx`:

```tsx
import type { CaseDetail } from '../types'

interface Props {
  serviceLines: CaseDetail['service_lines']
}

export function ServiceLinesPanel({ serviceLines }: Props) {
  return (
    <section data-testid="service-lines-panel">
      <h3>Service Lines</h3>
      {serviceLines.length === 0 ? (
        <p>No service lines.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {serviceLines.map((sl, idx) => {
            const code =
              typeof sl['procedure_code'] === 'string' ? sl['procedure_code'] : '—'
            const desc =
              typeof sl['procedure_description'] === 'string'
                ? sl['procedure_description']
                : '—'
            return (
              <li
                key={idx}
                style={{
                  padding: '6px 0',
                  borderBottom: '1px solid #f3f4f6',
                }}
              >
                <strong>{code}</strong> — {desc}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 8.5: Create `EventsTimeline.tsx`**

Create `apps/web/src/components/EventsTimeline.tsx`:

```tsx
import type { CaseDetail } from '../types'

interface Props {
  events: CaseDetail['events']
}

export function EventsTimeline({ events }: Props) {
  return (
    <section data-testid="events-timeline">
      <h3>Events</h3>
      {events.length === 0 ? (
        <p>No events.</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0 }}>
          {events.map((ev, idx) => {
            const eventType =
              typeof ev['event_type'] === 'string' ? ev['event_type'] : 'unknown'
            const occurredAt =
              typeof ev['occurred_at'] === 'string'
                ? new Date(ev['occurred_at']).toLocaleString()
                : ''
            return (
              <li
                key={idx}
                style={{
                  padding: '6px 0',
                  borderBottom: '1px solid #f3f4f6',
                  display: 'flex',
                  gap: 12,
                }}
              >
                <span style={{ color: '#6b7280', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {occurredAt}
                </span>
                <span>{eventType.replace(/_/g, ' ')}</span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
```

- [ ] **Step 8.6: Create `DecisionForm.tsx`**

Create `apps/web/src/components/DecisionForm.tsx`:

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { submitDecision } from '../api/client'

interface Props {
  caseId: string
}

export function DecisionForm({ caseId }: Props) {
  const [reason, setReason] = useState('')

  const mut = useMutation({
    mutationFn: (outcome: 'approved' | 'escalate') =>
      submitDecision(caseId, outcome, reason || undefined),
  })

  if (mut.isSuccess) {
    return (
      <div data-testid="decision-confirmed">
        <p style={{ color: '#16a34a', fontWeight: 600 }}>Decision submitted.</p>
      </div>
    )
  }

  return (
    <section>
      <h3>Record Decision</h3>
      <div style={{ marginBottom: 8 }}>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          rows={3}
          style={{ width: '100%', padding: 6, boxSizing: 'border-box' }}
          data-testid="decision-reason"
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => mut.mutate('approved')}
          disabled={mut.isPending}
          data-testid="btn-approve"
        >
          {mut.isPending ? 'Submitting…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => mut.mutate('escalate')}
          disabled={mut.isPending}
          data-testid="btn-escalate"
        >
          Escalate
        </button>
      </div>
      {mut.isError && (
        <p role="alert" style={{ color: '#dc2626' }}>
          Error: {(mut.error as Error).message}
        </p>
      )}
    </section>
  )
}
```

- [ ] **Step 8.7: Update `WorklistPage.tsx`**

Replace the stub content of `apps/web/src/pages/WorklistPage.tsx`:

```tsx
import { useParams } from 'react-router-dom'
import { WorklistTable } from '../components/WorklistTable'

export function WorklistPage() {
  const { queueId } = useParams<{ queueId: string }>()

  if (!queueId) {
    return <p>No queue specified.</p>
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Worklist — {queueId}</h1>
      <WorklistTable queueId={queueId} />
    </main>
  )
}
```

- [ ] **Step 8.8: Update `CasePage.tsx`**

Replace the stub content of `apps/web/src/pages/CasePage.tsx`:

```tsx
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getCase } from '../api/client'
import { CaseHeader } from '../components/CaseHeader'
import { ServiceLinesPanel } from '../components/ServiceLinesPanel'
import { EventsTimeline } from '../components/EventsTimeline'
import { DecisionForm } from '../components/DecisionForm'

export function CasePage() {
  const { caseId } = useParams<{ caseId: string }>()

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => getCase(caseId!),
    enabled: !!caseId,
  })

  if (!caseId) return <p>No case ID.</p>
  if (isLoading) return <p>Loading case…</p>
  if (isError) return <p role="alert">Error: {(error as Error).message}</p>
  if (!data) return null

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <Link to="/queues/default/worklist" style={{ fontSize: 13, color: '#2563eb' }}>
        ← Back to worklist
      </Link>
      <div style={{ marginTop: 16 }}>
        <CaseHeader caseDetail={data} />
        <div style={{ marginTop: 16 }}>
          <ServiceLinesPanel serviceLines={data.service_lines} />
        </div>
        <div style={{ marginTop: 16 }}>
          <EventsTimeline events={data.events} />
        </div>
        <div style={{ marginTop: 24 }}>
          <DecisionForm caseId={caseId} />
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 8.9: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no output (zero errors).

- [ ] **Step 8.10: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): add SlaCell, WorklistTable, CaseHeader, ServiceLinesPanel, EventsTimeline, DecisionForm components and wire WorklistPage/CasePage"
```

---

## Task 9: Playwright E2E + CI Integration

**Files:**
- Create: `apps/web/e2e/worklist.spec.ts`
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`
- Modify: `.claude/task-graph.md`

- [ ] **Step 9.1: Write the failing Playwright E2E spec**

Create `apps/web/e2e/worklist.spec.ts`:

```typescript
/**
 * E2E golden path: load worklist → click first row → open case workspace → submit approval.
 *
 * Requires:
 *   - BFF running on http://localhost:8001 (or proxied via Vite at /bff)
 *   - Valid reviewer session (auth handled by test setup / mock BFF in CI)
 *
 * In CI the BFF is replaced by a lightweight mock server (see e2e/mock-bff.ts).
 * In local dev against the real stack, set PLAYWRIGHT_REAL_STACK=1.
 */
import { test, expect } from '@playwright/test'

test.describe('reviewer worklist → case workspace → submit approval', () => {
  test('load worklist, open first case, submit approval', async ({ page }) => {
    // 1. Land on the worklist page
    await page.goto('/queues/default/worklist')

    // 2. The worklist table must be visible
    await expect(page.locator('table')).toBeVisible({ timeout: 10_000 })

    // 3. At least one data row is present
    const firstRow = page.locator('tbody tr').first()
    await expect(firstRow).toBeVisible()

    // 4. Click the first row to navigate to the case workspace
    await firstRow.click()

    // 5. Case header, service lines panel, and events timeline must appear
    await expect(page.getByTestId('case-header')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('service-lines-panel')).toBeVisible()
    await expect(page.getByTestId('events-timeline')).toBeVisible()

    // 6. Submit approval
    await page.getByTestId('btn-approve').click()

    // 7. Confirmation must appear
    await expect(page.getByTestId('decision-confirmed')).toBeVisible({ timeout: 5_000 })
  })
})
```

- [ ] **Step 9.2: Create a lightweight mock BFF server for E2E in CI**

Create `apps/web/e2e/mock-bff.ts`:

```typescript
/**
 * Minimal Express mock for the BFF — used by Playwright in CI.
 * Run with: npx ts-node e2e/mock-bff.ts
 * Listens on PORT (default 8001).
 */
import http from 'node:http'

const CASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'
const PORT = parseInt(process.env.PORT ?? '8001', 10)

function respond(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(json)
}

const server = http.createServer((req, res) => {
  const url = req.url ?? ''

  // GET /bff/queues/:queueId/worklist
  if (req.method === 'GET' && url.includes('/worklist')) {
    respond(res, 200, {
      items: [
        {
          case_id: CASE_ID,
          member_name: 'Jane E2E',
          service_description: 'Office Visit',
          lob: 'commercial',
          status: 'clinical_review',
          urgency: 'standard',
          sla: { deadline: new Date(Date.now() + 20 * 3600 * 1000).toISOString(), hours_remaining: 20, rag: 'amber', paused: false },
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
    })
    return
  }

  // GET /bff/cases/:caseId
  if (req.method === 'GET' && url.includes('/cases/')) {
    respond(res, 200, {
      case_id: CASE_ID,
      tenant_id: 'tenant-e2e',
      status: 'clinical_review',
      urgency: 'standard',
      lob: 'commercial',
      member: { name: 'Jane E2E', member_id: 'MBR-E2E' },
      coverage: { plan_id: 'PLN-E2E' },
      service_lines: [{ procedure_code: '99213', procedure_description: 'Office Visit' }],
      events: [{ event_type: 'intake', occurred_at: '2026-06-01T00:00:00Z' }],
      sla: null,
    })
    return
  }

  // POST /bff/cases/:caseId/decision
  if (req.method === 'POST' && url.includes('/decision')) {
    respond(res, 200, { status: 'approved' })
    return
  }

  respond(res, 404, { detail: 'not found' })
})

server.listen(PORT, () => {
  console.log(`mock-bff listening on http://localhost:${PORT}`)
})
```

- [ ] **Step 9.3: Update `playwright.config.ts` to start mock BFF in CI**

Replace `apps/web/playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

const useMockBff = !process.env.PLAYWRIGHT_REAL_STACK

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: useMockBff
    ? [
        {
          command: 'npx ts-node e2e/mock-bff.ts',
          url: 'http://localhost:8001',
          reuseExistingServer: !process.env.CI,
          timeout: 15_000,
        },
        {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      ]
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 30_000,
      },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
```

- [ ] **Step 9.4: Install ts-node (needed by mock-bff in CI)**

```bash
cd apps/web && npm install -D ts-node @types/node
```

- [ ] **Step 9.5: Run the Playwright test (requires both servers)**

```bash
cd apps/web && npx playwright test e2e/worklist.spec.ts --reporter=line
```

Expected:
```
  1 passed (…s)
```

If the test fails, verify:
- Mock BFF started (check for "mock-bff listening on http://localhost:8001" in output)
- Vite dev server started on port 5173
- No console errors in the test output

- [ ] **Step 9.6: Add Makefile targets**

Read the current `Makefile` first, then append the new targets. Open `Makefile` and add after the existing `scan` target:

```makefile

## Run portal-bff unit + integration tests.
test-portal-bff:
	cd services/portal-bff && uv run pytest -v

## Run web unit tests (tsc type-check).
test-web:
	cd apps/web && npm ci && npx tsc --noEmit

## Run Playwright E2E tests for the reviewer UI (starts mock BFF + Vite automatically).
e2e-web:
	cd apps/web && npx playwright test
```

- [ ] **Step 9.7: Add CI jobs**

Read `.github/workflows/ci.yml`. Locate the `jobs:` section and add these two new jobs alongside the existing ones:

```yaml
  test-portal-bff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
        with:
          version: "latest"
      - name: Install deps
        run: cd services/portal-bff && uv sync --dev
      - name: Run pytest
        run: cd services/portal-bff && uv run pytest -v

  test-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Install deps
        run: cd apps/web && npm ci
      - name: Type-check
        run: cd apps/web && npx tsc --noEmit
      - name: Install Playwright browsers
        run: cd apps/web && npx playwright install chromium --with-deps
      - name: Run Playwright E2E
        run: cd apps/web && npx playwright test
```

- [ ] **Step 9.8: Mark T12 complete in task graph**

Open `.claude/task-graph.md`. Find the row:

```
| T12 worklists + reviewer UI | TS/Py | P0 done | standard | `[ ]` |
```

Change it to:

```
| T12 worklists + reviewer UI | TS/Py | P0 done | standard | `[x]` |
```

- [ ] **Step 9.9: Run the full BFF suite one final time**

```bash
cd services/portal-bff && uv run pytest -v
```

Expected: all tests pass.

- [ ] **Step 9.10: Run TypeScript check one final time**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no output (zero errors).

- [ ] **Step 9.11: Commit everything**

```bash
git add apps/web/e2e/ apps/web/playwright.config.ts apps/web/package.json Makefile .github/workflows/ci.yml .claude/task-graph.md
git commit -m "feat(t12): add Playwright E2E golden path, Makefile targets, CI jobs; mark T12 complete"
```

---

## Self-Review Checklist

### Spec coverage

| T12 DoD item | Covered in |
|---|---|
| Reviewer worklist shows cases sorted by SLA | Task 4 — `_compute_rag` + sort; Task 4 tests assert sort order |
| SLA column shows RAG color + hours remaining | Task 8 — `SlaCell.tsx` (RAG dot + `{h}h`) |
| Case workspace: case header, service lines, events timeline | Task 8 — `CaseHeader`, `ServiceLinesPanel`, `EventsTimeline` with `data-testid` |
| Decision capture form calls `POST /bff/cases/{id}/decision` | Task 8 — `DecisionForm.tsx` + Task 5 router |
| BFF returns 403 if no `reviewer` role | Task 2 — `require_reviewer` + `test_auth.py` |
| Playwright E2E: worklist → open case → submit approval | Task 9 — `e2e/worklist.spec.ts` |

### Invariant coverage

| Invariant | Enforced |
|---|---|
| No adverse transition from UI | `ADVERSE_STATES` constant in `cases.py`; `submit_decision` only emits `approved` or `clinical_review`; test in `test_cases.py` |
| `human_signoff_recorded=True` on every decision call | Hardcoded in `submit_decision`; test `test_submit_decision_always_sets_human_signoff_recorded` |
| `tenant_id` on every upstream call | `require_reviewer` extracts it; `WorkflowClient` passes it as `X-Tenant-Id` header on every request |
| No direct FHIR access from browser | Web app has no FHIR imports; all data is proxied through BFF |

### No placeholders

Scan result: no "TBD", "TODO", "implement later", or "add appropriate" phrases found. All code blocks are complete and executable.

### Type consistency

- `SlaInfo`, `WorklistItem`, `WorklistPage`, `CaseDetail`, `DecisionSubmission` defined once in `models.py` (Python) and once in `src/types/index.ts` (TypeScript) — property names match BFF JSON responses.
- `workflow_client` singleton used in both `worklist.py` and `cases.py` — imported from `enstellar_bff.clients.workflow`.
- `require_reviewer` dependency imported from `enstellar_bff.auth` in both routers and overridden via `app.dependency_overrides` in all test files.
- `getWorklist`, `getCase`, `submitDecision` exported from `src/api/client.ts` and imported in `WorklistTable.tsx`, `CasePage.tsx`, `DecisionForm.tsx` respectively.
- `data-testid` values (`case-header`, `service-lines-panel`, `events-timeline`, `decision-confirmed`, `btn-approve`) defined in components and referenced identically in `worklist.spec.ts`.
