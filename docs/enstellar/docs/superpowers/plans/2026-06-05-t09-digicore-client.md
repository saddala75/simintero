# T09 — Digicore Client + Decision Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `services/integration-connectors/` as a standalone Python package `enstellar-connectors`. Ship `DigiCoreClient` — an async httpx client that calls `POST /api/v1/decisions`, retries on transient errors (502/503/504, network errors) with exponential backoff (3 attempts, 1–30 s), and opens an in-memory circuit breaker after 5 consecutive call failures. Every request carries `tenant_id`; a missing or blank `tenant_id` raises `ValidationError` before any HTTP call is made.

**Architecture:** New package `services/integration-connectors/enstellar_connectors/`. `DigiCoreClient` uses `httpx.AsyncClient` (one per call to avoid connection-pool lifecycle issues) + tenacity `AsyncRetrying` for per-call retry. `CircuitBreaker` is a plain in-memory counter: opens after `failure_threshold` consecutive failures (defaults to 5), enters half-open after `recovery_timeout` seconds (defaults to 30 s) and allows one probe through. `ConnectorSettings` reads from env (`DIGICORE_` prefix) via pydantic-settings. The mock Digicore server in `infra/compose/mocks/digicore/main.py` is the integration target.

**Tech Stack:** Python 3.12, httpx>=0.27, tenacity>=8.3, pydantic>=2.9, pydantic-settings>=2.3, pytest>=8, pytest-asyncio>=0.23, respx>=0.21 (unit HTTP mocking).

> **Invariant note:** `DecisionRequest.tenant_id` has `min_length=1`. A blank tenant_id raises `ValidationError` _before_ `httpx` is called — enforcing invariant #5 (tenant-scoped, every call). Tests MUST prove that constructing a `DecisionRequest` with `tenant_id=""` raises `ValidationError`.

**Depends on:** None. This is a standalone package; it does not import from `enstellar-workflow` or any other service package.

---

## Background (read before touching code)

All work is under `services/integration-connectors/`. The package name is `enstellar_connectors`.

**Mock Digicore server** (already running in `infra/compose/mocks/digicore/main.py`):
- Local stack: `http://mock-digicore:8000` (Docker) or `http://localhost:8090` (host)
- `POST /api/v1/decisions` — accepts a JSON body with `case_id`, `service_code`, `member_id`, `plan_id`, `tenant_id` (and optional `context: {}`). Always returns:
  ```json
  {
    "decision": "approved",
    "requirements": [],
    "structured_trace": {
      "artifact": "mock-policy-stub-v1",
      "version": "1.0.0",
      "source": "mock-digicore",
      "logic_branch": "auto-approve-stub"
    }
  }
  ```

**Test conventions for this package:**
- `asyncio_mode = "auto"` in `pyproject.toml` — use `@pytest.mark.asyncio` on each async test
- Unit tests use `respx` to mock the HTTP layer — no network calls, no external service
- Integration test is gated by `DIGICORE_INTEGRATION=1` env variable and calls the real mock server at `http://localhost:8090`
- Run unit tests: `cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"`
- Run with integration: `DIGICORE_INTEGRATION=1 uv run pytest tests/ -v`

**Circuit breaker semantics:**
- A "failure" is one call to `evaluate_request` where all retry attempts are exhausted and the final exception is transient (502/503/504 or network error).
- A "success" resets the failure counter to 0.
- After `failure_threshold` consecutive failures, `is_open()` returns True. New calls raise `CircuitOpenError` immediately without touching the network.
- After `recovery_timeout` seconds, `is_open()` returns False for one probe (half-open). If the probe succeeds, the breaker closes. If it fails, it re-opens.

**Retry semantics (tenacity `AsyncRetrying`):**
- 3 attempts total (1 original + 2 retries)
- Exponential backoff: wait min 1 s, max 30 s, multiplier 1
- Retried errors: `httpx.HTTPStatusError` with status 502/503/504; `httpx.ConnectError`; `httpx.TimeoutException`
- Non-transient 4xx errors or 5xx other than 502/503/504 are NOT retried and propagate immediately
- `reraise=True` so the original exception propagates after exhausted retries

---

## File Map

**New files:**

| File | Responsibility |
|---|---|
| `services/integration-connectors/pyproject.toml` | Package manifest with `enstellar-connectors` name, deps, pytest config |
| `services/integration-connectors/enstellar_connectors/__init__.py` | Package marker; re-exports `DigiCoreClient`, `CircuitOpenError`, `DecisionRequest`, `DecisionResponse` |
| `services/integration-connectors/enstellar_connectors/config.py` | `ConnectorSettings` (pydantic-settings, `DIGICORE_` prefix), `get_settings()` singleton |
| `services/integration-connectors/enstellar_connectors/digicore/__init__.py` | Sub-package marker; re-exports client and models |
| `services/integration-connectors/enstellar_connectors/digicore/models.py` | `DecisionRequest`, `StructuredTrace`, `DecisionResponse` (Pydantic v2) |
| `services/integration-connectors/enstellar_connectors/digicore/client.py` | `CircuitBreaker`, `CircuitOpenError`, `DigiCoreClient` |
| `services/integration-connectors/tests/__init__.py` | Test package marker |
| `services/integration-connectors/tests/conftest.py` | `reset_settings` autouse fixture to clear singleton between tests |
| `services/integration-connectors/tests/test_digicore_models.py` | Unit tests for Pydantic models (no HTTP) |
| `services/integration-connectors/tests/test_digicore_client.py` | Unit tests with respx + integration tests |

**Modified files:**

| File | Change |
|---|---|
| `Makefile` | Add `test-connectors` target; include connectors in `test` target |
| `.claude/task-graph.md` | Mark T09 as `[x]` |

---

## Task 1: Project Scaffold

**Files:**
- Create: `services/integration-connectors/pyproject.toml`
- Create: `services/integration-connectors/enstellar_connectors/__init__.py`
- Create: `services/integration-connectors/enstellar_connectors/digicore/__init__.py`
- Create: `services/integration-connectors/tests/__init__.py`

- [ ] **Step 1.1: Verify the directory exists and contains only `.gitkeep`**

```bash
ls services/integration-connectors/
```

Expected output:
```
.gitkeep
```

- [ ] **Step 1.2: Create `pyproject.toml`**

Create `services/integration-connectors/pyproject.toml`:

```toml
[project]
name = "enstellar-connectors"
version = "0.1.0"
description = "Enstellar integration connectors — Digicore, Revital, terminology clients"
requires-python = ">=3.12"
dependencies = [
    "httpx>=0.27",
    "pydantic>=2.9",
    "pydantic-settings>=2.3",
    "tenacity>=8.3",
]

[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "respx>=0.21",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"
markers = [
    "integration: marks tests that require a running Digicore server (deselect with '-m not integration')",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["enstellar_connectors"]

[tool.ruff]
line-length = 100
target-version = "py312"
```

- [ ] **Step 1.3: Create the package directories and `__init__.py` files**

Create `services/integration-connectors/enstellar_connectors/__init__.py`:

```python
"""Enstellar integration connectors — Digicore, Revital, terminology."""
from .digicore.client import CircuitOpenError, DigiCoreClient
from .digicore.models import DecisionRequest, DecisionResponse, StructuredTrace

__all__ = [
    "CircuitOpenError",
    "DigiCoreClient",
    "DecisionRequest",
    "DecisionResponse",
    "StructuredTrace",
]
```

Create `services/integration-connectors/enstellar_connectors/digicore/__init__.py`:

```python
"""Digicore sub-package — client and Pydantic models."""
from .client import CircuitOpenError, DigiCoreClient
from .models import DecisionRequest, DecisionResponse, StructuredTrace

__init__ = [
    "CircuitOpenError",
    "DigiCoreClient",
    "DecisionRequest",
    "DecisionResponse",
    "StructuredTrace",
]
```

Create `services/integration-connectors/tests/__init__.py`:

```python
```

- [ ] **Step 1.4: Install dependencies with uv**

```bash
cd services/integration-connectors
uv sync --dev
```

Expected output ends with:
```
Resolved X packages in Xs
Installed X packages in Xs
```

- [ ] **Step 1.5: Confirm the virtualenv is usable**

```bash
cd services/integration-connectors
uv run python -c "import httpx, tenacity, pydantic, pydantic_settings; print('ok')"
```

Expected output:
```
ok
```

- [ ] **Step 1.6: Commit**

```bash
cd services/integration-connectors
git add pyproject.toml enstellar_connectors/__init__.py enstellar_connectors/digicore/__init__.py tests/__init__.py
git commit -m "feat(connectors): scaffold enstellar-connectors package — pyproject.toml + dirs"
```

---

## Task 2: Pydantic Models + Failing Model Tests

**Files:**
- Create: `services/integration-connectors/enstellar_connectors/digicore/models.py`
- Create: `services/integration-connectors/tests/test_digicore_models.py`

- [ ] **Step 2.1: Write the failing model tests first**

Create `services/integration-connectors/tests/test_digicore_models.py`:

```python
"""Unit tests for Digicore Pydantic models — no HTTP, no network."""
import pytest
from pydantic import ValidationError

from enstellar_connectors.digicore.models import (
    DecisionRequest,
    DecisionResponse,
    StructuredTrace,
)


# ─── DecisionRequest ────────────────────────────────────────────────────────


def test_decision_request_happy_path():
    req = DecisionRequest(
        case_id="case-001",
        service_code="99213",
        member_id="member-001",
        plan_id="PLAN-001",
        tenant_id="tenant-alpha",
    )
    assert req.case_id == "case-001"
    assert req.tenant_id == "tenant-alpha"


def test_decision_request_model_dump_includes_all_fields():
    req = DecisionRequest(
        case_id="case-002",
        service_code="99214",
        member_id="m-002",
        plan_id="P-002",
        tenant_id="tenant-beta",
    )
    data = req.model_dump()
    assert data["case_id"] == "case-002"
    assert data["service_code"] == "99214"
    assert data["member_id"] == "m-002"
    assert data["plan_id"] == "P-002"
    assert data["tenant_id"] == "tenant-beta"


# ─── INVARIANT: tenant_id must not be blank ──────────────────────────────────


def test_decision_request_missing_tenant_id_raises_validation_error():
    """INVARIANT #5: tenant_id is required. Omitting it raises ValidationError before any HTTP call."""
    with pytest.raises(ValidationError) as exc_info:
        DecisionRequest(
            case_id="case-003",
            service_code="99213",
            member_id="m-003",
            plan_id="P-003",
            # tenant_id intentionally omitted
        )
    errors = exc_info.value.errors()
    assert any(e["loc"] == ("tenant_id",) for e in errors)


def test_decision_request_blank_tenant_id_raises_validation_error():
    """INVARIANT #5: tenant_id must not be blank (min_length=1)."""
    with pytest.raises(ValidationError) as exc_info:
        DecisionRequest(
            case_id="case-004",
            service_code="99213",
            member_id="m-004",
            plan_id="P-004",
            tenant_id="",
        )
    errors = exc_info.value.errors()
    assert any(e["loc"] == ("tenant_id",) for e in errors)


def test_decision_request_whitespace_only_tenant_id_raises_validation_error():
    """INVARIANT #5: tenant_id that is only whitespace must be rejected."""
    with pytest.raises(ValidationError):
        DecisionRequest(
            case_id="case-005",
            service_code="99213",
            member_id="m-005",
            plan_id="P-005",
            tenant_id="   ",
        )


# ─── StructuredTrace ────────────────────────────────────────────────────────


def test_structured_trace_roundtrip():
    trace = StructuredTrace(
        artifact="mock-policy-stub-v1",
        version="1.0.0",
        source="mock-digicore",
        logic_branch="auto-approve-stub",
    )
    dumped = trace.model_dump()
    restored = StructuredTrace.model_validate(dumped)
    assert restored == trace


# ─── DecisionResponse ───────────────────────────────────────────────────────


def test_decision_response_approved():
    resp = DecisionResponse(
        decision="approved",
        requirements=[],
        structured_trace=StructuredTrace(
            artifact="art-1",
            version="1.0.0",
            source="digicore",
            logic_branch="main",
        ),
    )
    assert resp.decision == "approved"
    assert resp.requirements == []


def test_decision_response_pending_review():
    resp = DecisionResponse(
        decision="pending_review",
        requirements=["clinical-notes"],
        structured_trace=StructuredTrace(
            artifact="art-1",
            version="1.0.0",
            source="digicore",
            logic_branch="needs-review",
        ),
    )
    assert resp.decision == "pending_review"
    assert "clinical-notes" in resp.requirements


def test_decision_response_denied():
    resp = DecisionResponse(
        decision="denied",
        requirements=[],
        structured_trace=StructuredTrace(
            artifact="art-1",
            version="1.0.0",
            source="digicore",
            logic_branch="denial-branch",
        ),
    )
    assert resp.decision == "denied"


def test_decision_response_invalid_decision_value_raises():
    """'not_a_real_outcome' is not a valid decision literal."""
    with pytest.raises(ValidationError):
        DecisionResponse(
            decision="not_a_real_outcome",
            requirements=[],
            structured_trace=StructuredTrace(
                artifact="art-1",
                version="1.0.0",
                source="digicore",
                logic_branch="main",
            ),
        )


def test_decision_response_validates_from_mock_digicore_json():
    """Validate against the exact JSON the mock Digicore server returns."""
    raw = {
        "decision": "approved",
        "requirements": [],
        "structured_trace": {
            "artifact": "mock-policy-stub-v1",
            "version": "1.0.0",
            "source": "mock-digicore",
            "logic_branch": "auto-approve-stub",
        },
    }
    resp = DecisionResponse.model_validate(raw)
    assert resp.decision == "approved"
    assert resp.structured_trace.artifact == "mock-policy-stub-v1"
    assert resp.structured_trace.version == "1.0.0"
    assert resp.structured_trace.source == "mock-digicore"
    assert resp.structured_trace.logic_branch == "auto-approve-stub"
```

- [ ] **Step 2.2: Run tests to confirm they fail (module not found)**

```bash
cd services/integration-connectors
uv run pytest tests/test_digicore_models.py -v
```

Expected output:
```
ERROR tests/test_digicore_models.py - ModuleNotFoundError: No module named 'enstellar_connectors.digicore.models'
```

- [ ] **Step 2.3: Create `models.py`**

Create `services/integration-connectors/enstellar_connectors/digicore/models.py`:

```python
"""Pydantic models for the Digicore decision API.

DecisionRequest — outbound request body.
DecisionResponse — response from POST /api/v1/decisions.
StructuredTrace — embedded in DecisionResponse; used to pin rule artifact + version.

INVARIANT #5: DecisionRequest.tenant_id has min_length=1 and must be non-blank.
A blank or missing tenant_id raises ValidationError *before* any HTTP call is made.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class DecisionRequest(BaseModel):
    """Outbound request body for POST /api/v1/decisions."""

    case_id: str = Field(min_length=1)
    service_code: str = Field(min_length=1)
    member_id: str = Field(min_length=1)
    plan_id: str = Field(min_length=1)
    tenant_id: str = Field(
        min_length=1,
        description="Required: tenant owning this request — invariant #5",
    )

    @field_validator("tenant_id")
    @classmethod
    def tenant_id_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("tenant_id must not be blank — invariant #5")
        return v


class StructuredTrace(BaseModel):
    """Rules trace pinned to the Digicore artifact + version at decision time."""

    artifact: str
    version: str
    source: str
    logic_branch: str


class DecisionResponse(BaseModel):
    """Response from POST /api/v1/decisions."""

    decision: Literal["approved", "pending_review", "denied"]
    requirements: list[str]
    structured_trace: StructuredTrace
```

- [ ] **Step 2.4: Run tests to confirm they pass**

```bash
cd services/integration-connectors
uv run pytest tests/test_digicore_models.py -v
```

Expected output:
```
tests/test_digicore_models.py::test_decision_request_happy_path PASSED
tests/test_digicore_models.py::test_decision_request_model_dump_includes_all_fields PASSED
tests/test_digicore_models.py::test_decision_request_missing_tenant_id_raises_validation_error PASSED
tests/test_digicore_models.py::test_decision_request_blank_tenant_id_raises_validation_error PASSED
tests/test_digicore_models.py::test_decision_request_whitespace_only_tenant_id_raises_validation_error PASSED
tests/test_digicore_models.py::test_structured_trace_roundtrip PASSED
tests/test_digicore_models.py::test_decision_response_approved PASSED
tests/test_digicore_models.py::test_decision_response_pending_review PASSED
tests/test_digicore_models.py::test_decision_response_denied PASSED
tests/test_digicore_models.py::test_decision_response_invalid_decision_value_raises PASSED
tests/test_digicore_models.py::test_decision_response_validates_from_mock_digicore_json PASSED

============ 11 passed in 0.Xs ============
```

- [ ] **Step 2.5: Commit**

```bash
cd services/integration-connectors
git add enstellar_connectors/digicore/models.py tests/test_digicore_models.py
git commit -m "feat(connectors): DecisionRequest/Response/StructuredTrace Pydantic models — invariant #5 on tenant_id"
```

---

## Task 3: `ConnectorSettings` + `config.py`

**Files:**
- Create: `services/integration-connectors/enstellar_connectors/config.py`

- [ ] **Step 3.1: Create `config.py`**

Create `services/integration-connectors/enstellar_connectors/config.py`:

```python
"""ConnectorSettings — reads from env variables with DIGICORE_ prefix.

All Digicore-specific settings live here. Settings are loaded once and
cached in a module-level singleton. Tests that change env vars must call
reset_settings() to clear the cache, or use the conftest autouse fixture.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class ConnectorSettings(BaseSettings):
    """All settings for integration-connectors.

    Environment variable prefix: DIGICORE_
    Example: DIGICORE_BASE_URL=http://mock-digicore:8000

    Pydantic-settings converts env var names to lowercase field names
    after stripping the prefix. DIGICORE_BASE_URL → base_url.
    """

    model_config = SettingsConfigDict(
        env_prefix="DIGICORE_",
        case_sensitive=False,
    )

    base_url: str = "http://localhost:8090"
    """Base URL for the Digicore API. Override with DIGICORE_BASE_URL."""

    circuit_breaker_threshold: int = 5
    """Number of consecutive call failures before the circuit opens."""

    circuit_breaker_recovery_seconds: float = 30.0
    """Seconds to wait before the circuit enters half-open state."""

    request_timeout_seconds: float = 10.0
    """Per-call HTTP timeout in seconds (applied to each retry attempt)."""

    retry_max_attempts: int = 3
    """Total number of attempts per call (1 original + N-1 retries)."""


_settings: ConnectorSettings | None = None


def get_settings() -> ConnectorSettings:
    """Return the module-level settings singleton. Instantiated on first call."""
    global _settings
    if _settings is None:
        _settings = ConnectorSettings()
    return _settings


def reset_settings() -> None:
    """Clear the cached settings singleton. Used in tests that patch env vars."""
    global _settings
    _settings = None
```

- [ ] **Step 3.2: Verify `config.py` imports cleanly**

```bash
cd services/integration-connectors
uv run python -c "from enstellar_connectors.config import get_settings; s = get_settings(); print(s.base_url)"
```

Expected output:
```
http://localhost:8090
```

- [ ] **Step 3.3: Verify env override works**

```bash
cd services/integration-connectors
DIGICORE_BASE_URL=http://custom-host:9999 uv run python -c "
from enstellar_connectors.config import get_settings, reset_settings
reset_settings()
s = get_settings()
print(s.base_url)
"
```

Expected output:
```
http://custom-host:9999
```

- [ ] **Step 3.4: Commit**

```bash
cd services/integration-connectors
git add enstellar_connectors/config.py
git commit -m "feat(connectors): ConnectorSettings — pydantic-settings with DIGICORE_ prefix"
```

---

## Task 4: `CircuitBreaker` + `DigiCoreClient` Full Implementation

**Files:**
- Create: `services/integration-connectors/enstellar_connectors/digicore/client.py`

- [ ] **Step 4.1: Create `client.py` with the full implementation**

Create `services/integration-connectors/enstellar_connectors/digicore/client.py`:

```python
"""DigiCoreClient — async httpx client for the Digicore decision API.

Design:
- httpx.AsyncClient (one per call; avoids connection-pool lifecycle edge cases in tests)
- tenacity AsyncRetrying: 3 attempts, exponential backoff 1–30 s
- Transient errors: 502/503/504, httpx.ConnectError, httpx.TimeoutException
- CircuitBreaker: opens after failure_threshold consecutive call failures (default 5)
- Half-open after recovery_timeout seconds (default 30 s) — one probe allowed through

INVARIANT #5: Callers must supply a non-blank tenant_id on DecisionRequest;
this is validated by Pydantic before any HTTP call is attempted.
"""
from __future__ import annotations

import logging
import time

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from ..config import get_settings
from .models import DecisionRequest, DecisionResponse

logger = logging.getLogger(__name__)


def _is_transient(exc: BaseException) -> bool:
    """Return True if the exception represents a transient error worth retrying."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in {502, 503, 504}
    return isinstance(exc, (httpx.ConnectError, httpx.TimeoutException))


class CircuitOpenError(Exception):
    """Raised when the circuit breaker is open and no call should be attempted."""


class CircuitBreaker:
    """Simple in-memory circuit breaker.

    State transitions:
      CLOSED  → (failure_threshold consecutive failures) → OPEN
      OPEN    → (recovery_timeout elapsed)               → HALF-OPEN (one probe)
      HALF-OPEN → (probe succeeds)                       → CLOSED
      HALF-OPEN → (probe fails)                          → OPEN

    Thread-safety: not thread-safe. DigiCoreClient is intended to be used
    in a single-event-loop context (asyncio); no locking is required.
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
    ) -> None:
        self._threshold = failure_threshold
        self._recovery = recovery_timeout
        self._failures = 0
        self._open_at: float | None = None

    def is_open(self) -> bool:
        """Return True if new calls should be blocked."""
        if self._open_at is None:
            return False
        elapsed = time.monotonic() - self._open_at
        if elapsed >= self._recovery:
            # Recovery window elapsed → enter half-open; allow one probe
            self._open_at = None
            logger.info("circuit_breaker=half_open recovery_elapsed=%.1fs", elapsed)
            return False
        return True

    def record_success(self) -> None:
        """Record a successful call. Resets the failure counter and closes the circuit."""
        if self._failures > 0 or self._open_at is not None:
            logger.info(
                "circuit_breaker=closed was_failures=%d", self._failures
            )
        self._failures = 0
        self._open_at = None

    def record_failure(self) -> None:
        """Record a call failure. Opens the circuit if the threshold is reached."""
        self._failures += 1
        logger.warning(
            "circuit_breaker failure_count=%d threshold=%d",
            self._failures,
            self._threshold,
        )
        if self._failures >= self._threshold:
            self._open_at = time.monotonic()
            logger.error(
                "circuit_breaker=open failures=%d threshold=%d",
                self._failures,
                self._threshold,
            )

    @property
    def failure_count(self) -> int:
        """Current consecutive failure count (for testing/observability)."""
        return self._failures


class DigiCoreClient:
    """Async client for the Digicore decision engine.

    Instantiate once per application lifecycle (or per test that needs an
    isolated circuit breaker state). Not thread-safe — use within a single
    asyncio event loop.

    Usage::

        client = DigiCoreClient()
        req = DecisionRequest(
            case_id="...", service_code="99213",
            member_id="...", plan_id="...", tenant_id="tenant-1",
        )
        resp = await client.evaluate_request(req)
        print(resp.decision)  # 'approved' | 'pending_review' | 'denied'
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._base_url = settings.base_url
        self._timeout = settings.request_timeout_seconds
        self._max_attempts = settings.retry_max_attempts
        self._circuit = CircuitBreaker(
            failure_threshold=settings.circuit_breaker_threshold,
            recovery_timeout=settings.circuit_breaker_recovery_seconds,
        )

    async def evaluate_request(self, req: DecisionRequest) -> DecisionResponse:
        """Call POST /api/v1/decisions. Retries on transient errors.

        Raises:
            CircuitOpenError: if the circuit is open (too many recent failures).
            httpx.HTTPStatusError: on non-retried HTTP errors (e.g. 400, 500).
            httpx.ConnectError: if connection fails after all retries.
            httpx.TimeoutException: if the request times out after all retries.
        """
        if self._circuit.is_open():
            raise CircuitOpenError(
                f"Digicore circuit breaker is open after {self._circuit.failure_count} "
                f"consecutive failures"
            )

        try:
            result = await self._call_with_retry(req)
        except Exception as exc:
            if _is_transient(exc):
                self._circuit.record_failure()
            raise
        else:
            self._circuit.record_success()
            return result

    async def _call_with_retry(self, req: DecisionRequest) -> DecisionResponse:
        """Inner call wrapped with tenacity retry logic."""
        async for attempt in AsyncRetrying(
            retry=retry_if_exception(_is_transient),
            stop=stop_after_attempt(self._max_attempts),
            wait=wait_exponential(multiplier=1, min=1, max=30),
            reraise=True,
        ):
            with attempt:
                return await self._single_call(req)
        # unreachable; AsyncRetrying with reraise=True always raises on exhaustion
        raise RuntimeError("Unreachable: tenacity loop exited without return or raise")

    async def _single_call(self, req: DecisionRequest) -> DecisionResponse:
        """Execute a single HTTP POST with no retry logic."""
        async with httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout,
        ) as client:
            resp = await client.post(
                "/api/v1/decisions",
                json=req.model_dump(),
            )
            resp.raise_for_status()
            return DecisionResponse.model_validate(resp.json())
```

- [ ] **Step 4.2: Verify the module imports without error**

```bash
cd services/integration-connectors
uv run python -c "
from enstellar_connectors import DigiCoreClient, CircuitOpenError, DecisionRequest
print('DigiCoreClient:', DigiCoreClient)
print('CircuitOpenError:', CircuitOpenError)
"
```

Expected output:
```
DigiCoreClient: <class 'enstellar_connectors.digicore.client.DigiCoreClient'>
CircuitOpenError: <class 'enstellar_connectors.digicore.client.CircuitOpenError'>
```

- [ ] **Step 4.3: Commit**

```bash
cd services/integration-connectors
git add enstellar_connectors/digicore/client.py
git commit -m "feat(connectors): DigiCoreClient — httpx + tenacity retry + CircuitBreaker"
```

---

## Task 5: Unit Tests with `respx` (All Passing)

**Files:**
- Create: `services/integration-connectors/tests/conftest.py`
- Create: `services/integration-connectors/tests/test_digicore_client.py`

- [ ] **Step 5.1: Create `tests/conftest.py`**

Create `services/integration-connectors/tests/conftest.py`:

```python
"""Shared pytest fixtures for enstellar-connectors tests."""
import pytest

from enstellar_connectors.config import reset_settings


@pytest.fixture(autouse=True)
def clear_settings_singleton():
    """Reset the settings singleton before every test.

    Ensures that env-var patches in one test don't leak into the next.
    """
    reset_settings()
    yield
    reset_settings()
```

- [ ] **Step 5.2: Write `test_digicore_client.py` (failing imports first)**

Create `services/integration-connectors/tests/test_digicore_client.py`:

```python
"""Unit tests for DigiCoreClient using respx HTTP mocking.

Integration tests (requiring a live Digicore server at localhost:8090) are
marked with @pytest.mark.integration and skipped unless DIGICORE_INTEGRATION=1.
"""
from __future__ import annotations

import os
import time
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx

from enstellar_connectors import DigiCoreClient, DecisionRequest, DecisionResponse
from enstellar_connectors.digicore.client import CircuitBreaker, CircuitOpenError
from enstellar_connectors.digicore.models import StructuredTrace

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MOCK_TRACE = {
    "artifact": "mock-policy-stub-v1",
    "version": "1.0.0",
    "source": "mock-digicore",
    "logic_branch": "auto-approve-stub",
}

MOCK_APPROVED_RESPONSE = {
    "decision": "approved",
    "requirements": [],
    "structured_trace": MOCK_TRACE,
}

MOCK_PENDING_RESPONSE = {
    "decision": "pending_review",
    "requirements": ["clinical-notes"],
    "structured_trace": MOCK_TRACE,
}

MOCK_DENIED_RESPONSE = {
    "decision": "denied",
    "requirements": [],
    "structured_trace": MOCK_TRACE,
}


def make_request(tenant_id: str = "tenant-t09") -> DecisionRequest:
    return DecisionRequest(
        case_id="case-001",
        service_code="99213",
        member_id="member-001",
        plan_id="PLAN-001",
        tenant_id=tenant_id,
    )


# ---------------------------------------------------------------------------
# CircuitBreaker unit tests (pure logic, no HTTP)
# ---------------------------------------------------------------------------


def test_circuit_breaker_starts_closed():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    assert cb.is_open() is False


def test_circuit_breaker_opens_after_threshold():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    for _ in range(5):
        cb.record_failure()
    assert cb.is_open() is True


def test_circuit_breaker_does_not_open_before_threshold():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    for _ in range(4):
        cb.record_failure()
    assert cb.is_open() is False


def test_circuit_breaker_closes_after_success():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    for _ in range(5):
        cb.record_failure()
    assert cb.is_open() is True
    cb.record_success()
    assert cb.is_open() is False
    assert cb.failure_count == 0


def test_circuit_breaker_half_open_after_recovery_timeout():
    """After recovery_timeout seconds, is_open() returns False (half-open probe allowed)."""
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=5.0)
    for _ in range(3):
        cb.record_failure()
    assert cb.is_open() is True

    # Simulate time passing beyond recovery_timeout
    with patch("enstellar_connectors.digicore.client.time") as mock_time:
        mock_time.monotonic.side_effect = [
            # First call: when circuit opened (captured by record_failure)
            # We bypass that — _open_at is already set; just mock the is_open check
            # is_open reads time.monotonic() once for the elapsed check
            cb._open_at + 6.0,  # 6 s > 5 s recovery
        ]
        assert cb.is_open() is False


def test_circuit_breaker_failure_count_resets_on_success():
    cb = CircuitBreaker(failure_threshold=5)
    cb.record_failure()
    cb.record_failure()
    cb.record_success()
    assert cb.failure_count == 0


# ---------------------------------------------------------------------------
# DigiCoreClient — happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_evaluate_request_approved(monkeypatch):
    monkeypatch.setenv("DIGICORE_BASE_URL", "http://mock-digicore-test")
    respx.post("http://mock-digicore-test/api/v1/decisions").mock(
        return_value=httpx.Response(200, json=MOCK_APPROVED_RESPONSE)
    )

    client = DigiCoreClient()
    req = make_request()
    resp = await client.evaluate_request(req)

    assert isinstance(resp, DecisionResponse)
    assert resp.decision == "approved"
    assert resp.requirements == []
    assert resp.structured_trace.artifact == "mock-policy-stub-v1"
    assert resp.structured_trace.version == "1.0.0"
    assert resp.structured_trace.source == "mock-digicore"
    assert resp.structured_trace.logic_branch == "auto-approve-stub"


@pytest.mark.asyncio
@respx.mock
async def test_evaluate_request_pending_review(monkeypatch):
    monkeypatch.setenv("DIGICORE_BASE_URL", "http://mock-digicore-test")
    respx.post("http://mock-digicore-test/api/v1/decisions").mock(
        return_value=httpx.Response(200, json=MOCK_PENDING_RESPONSE)
    )

    client = DigiCoreClient()
    resp = await client.evaluate_request(make_request())

    assert resp.decision == "pending_review"
    assert "clinical-notes" in resp.requirements


@pytest.mark.asyncio
@respx.mock
async def test_evaluate_request_sends_correct_body(monkeypatch):
    """Verify the request body includes all required fields including tenant_id."""
    monkeypatch.setenv("DIGICORE_BASE_URL", "http://mock-digicore-test")
    route = respx.post("http://mock-digicore-test/api/v1/decisions").mock(
        return_value=httpx.Response(200, json=MOCK_APPROVED_RESPONSE)
    )

    client = DigiCoreClient()
    req = DecisionRequest(
        case_id="case-body-check",
        service_code="99215",
        member_id="m-body-check",
        plan_id="P-body",
        tenant_id="tenant-body",
    )
    await client.evaluate_request(req)

    assert route.called
    sent_body = route.calls.last.request.content
    import json as _json
    body = _json.loads(sent_body)
    assert body["case_id"] == "case-body-check"
    assert body["service_code"] == "99215"
    assert body["tenant_id"] == "tenant-body"


@pytest.mark.asyncio
@respx.mock
async def test_successful_call_resets_circuit_breaker(monkeypatch):
    """A successful call after failures must reset the failure counter."""
    monkeypatch.setenv("DIGICORE_BASE_URL", "http://mock-digicore-test")
    respx.post("http://mock-digicore-test/api/v1/decisions").mock(
        return_value=httpx.Response(200, json=MOCK_APPROVED_RESPONSE)
    )

    client = DigiCoreClient()
    # Inject 3 pre-existing failures (below threshold of 5)
    client._circuit._failures = 3

    await client.evaluate_request(make_request())

    assert client._circuit.failure_count == 0
    assert client._circuit.is_open() is False


# ---------------------------------------------------------------------------
# DigiCoreClient — retry on transient errors
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_retries_on_503_then_succeeds(monkeypatch):
    """Client retries on 503 and succeeds on the second attempt."""
    monkeypatch.setenv("DIGICORE_BASE_URL", "http://mock-digicore-test")
    # First call returns 503, second returns 200
    respx.post("http://mock-digicore-test/api/v1/decisions").mock(
        side_effect=[
            httpx.Response(503, json={"detail": "service unavailable"}),
            httpx.Response(200, json=MOCK_APPROVED_RESPONSE),
        ]
    )

    client = DigiCoreClient()
    # Disable wait to speed up tests
    with patch("enstellar_connectors.digicore.client.wait_exponential", return_value=lambda _: 0):
        resp = await client.evaluate_request(make_request())

    assert resp.decision == "approved"


@pytest.mark.asyncio
@respx.mock
async def test_retries_on_502_then_succeeds(monkeypatch):
    """Client retries on 502."""
    monkeypatch.setenv("DIGICORE_BASE_URL", "http://mock-digicore-test")
    respx.post("http://mock-digicore-test/api/v1/decisions").mock(
        side_effect=[
            httpx.Response(502, json={}),
            httpx.Response(200, json=MOCK_APPROVED_RESPONSE),
        ]
    )

    client = DigiCoreClient()
    with patch("enstellar_connectors.digicore.client.wait_exponential", return_value=lambda _: 0):
        resp = await client.evaluate_request(make_request())

    assert resp.decision == "approved"


@pytest.mark.asyncio
@respx.mock
async def test_does_not_retry_on_400(monkeypatch):
    """400 Bad Request is not transient — must not be retried."""
    monkeypatch.setenv("DIGICORE_BASE_URL", "http://mock-digicore-test")
    route = respx.post("http://mock-digicore-test/api/v1/decisions").mock(
        return_value=httpx.Response(400, json={"detail": "bad request"})
    )

    client = DigiCoreClient()
    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        await client.evaluate_request(make_request())

    assert exc_info.value.response.status_code == 400
    # Called exactly once — no retries for 4xx
    assert route.call_count == 1


@pytest.mark.asyncio
@respx.mock
async def test_does_not_retry_on_500(monkeypatch):
    """500 Internal Server Error is not in the transient set — must not be retried."""
    monkeypatch.setenv("DIGICORE_BASE_URL", "http://mock-digicore-test")
    route = respx.post("http://mock-digicore-test/api/v1/decisions").mock(
        return_value=httpx.Response(500, json={"detail": "server error"})
    )

    client = DigiCoreClient()
    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        await client.evaluate_request(make_request())

    assert exc_info.value.response.status_code == 500
    assert route.call_count == 1


# ---------------------------------------------------------------------------
# DigiCoreClient — circuit breaker integration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_circuit_opens_after_5_consecutive_failures(monkeypatch):
    """INVARIANT: after 5 consecutive failing calls, the circuit opens."""
    monkeypatch.setenv("DIGICORE_BASE_URL", "http://mock-digicore-test")
    monkeypatch.setenv("DIGICORE_RETRY_MAX_ATTEMPTS", "1")  # 1 attempt = no retry delay
    respx.post("http://mock-digicore-test/api/v1/decisions").mock(
        return_value=httpx.Response(503, json={})
    )

    client = DigiCoreClient()

    for i in range(5):
        with pytest.raises(httpx.HTTPStatusError):
            await client.evaluate_request(make_request())

    assert client._circuit.is_open() is True
    assert client._circuit.failure_count >= 5


@pytest.mark.asyncio
@respx.mock
async def test_circuit_open_raises_circuit_open_error_without_http_call(monkeypatch):
    """When circuit is open, evaluate_request raises CircuitOpenError immediately."""
    monkeypatch.setenv("DIGICORE_BASE_URL", "http://mock-digicore-test")
    route = respx.post("http://mock-digicore-test/api/v1/decisions").mock(
        return_value=httpx.Response(200, json=MOCK_APPROVED_RESPONSE)
    )

    client = DigiCoreClient()
    # Force the circuit open
    client._circuit._failures = 5
    client._circuit._open_at = time.monotonic()

    with pytest.raises(CircuitOpenError):
        await client.evaluate_request(make_request())

    # Must not have made any HTTP call
    assert route.call_count == 0


@pytest.mark.asyncio
@respx.mock
async def test_circuit_does_not_open_on_4_failures(monkeypatch):
    """4 consecutive failures must not open the circuit (threshold is 5)."""
    monkeypatch.setenv("DIGICORE_BASE_URL", "http://mock-digicore-test")
    monkeypatch.setenv("DIGICORE_RETRY_MAX_ATTEMPTS", "1")
    respx.post("http://mock-digicore-test/api/v1/decisions").mock(
        return_value=httpx.Response(503, json={})
    )

    client = DigiCoreClient()
    for _ in range(4):
        with pytest.raises(httpx.HTTPStatusError):
            await client.evaluate_request(make_request())

    assert client._circuit.is_open() is False


@pytest.mark.asyncio
@respx.mock
async def test_successful_call_after_4_failures_does_not_open_circuit(monkeypatch):
    """A success at failure_count=4 resets counter; subsequent failure won't open immediately."""
    monkeypatch.setenv("DIGICORE_BASE_URL", "http://mock-digicore-test")
    monkeypatch.setenv("DIGICORE_RETRY_MAX_ATTEMPTS", "1")
    route = respx.post("http://mock-digicore-test/api/v1/decisions")
    route.mock(
        side_effect=[
            httpx.Response(503, json={}),
            httpx.Response(503, json={}),
            httpx.Response(503, json={}),
            httpx.Response(503, json={}),
            httpx.Response(200, json=MOCK_APPROVED_RESPONSE),  # 5th call succeeds
            httpx.Response(503, json={}),  # 6th call fails — circuit should NOT open
        ]
    )

    client = DigiCoreClient()

    # 4 failures
    for _ in range(4):
        with pytest.raises(httpx.HTTPStatusError):
            await client.evaluate_request(make_request())

    # Success — resets counter
    resp = await client.evaluate_request(make_request())
    assert resp.decision == "approved"
    assert client._circuit.failure_count == 0

    # One more failure — failure_count is 1 now, circuit still closed
    with pytest.raises(httpx.HTTPStatusError):
        await client.evaluate_request(make_request())

    assert client._circuit.is_open() is False
    assert client._circuit.failure_count == 1


# ---------------------------------------------------------------------------
# Integration tests — skipped unless DIGICORE_INTEGRATION=1
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.integration
async def test_integration_evaluate_request_against_mock_server():
    """Integration test: calls the real mock Digicore at http://localhost:8090.

    Run with: DIGICORE_INTEGRATION=1 uv run pytest tests/ -v -m integration
    Requires: `make up` or the mock server running at localhost:8090.
    """
    if not os.environ.get("DIGICORE_INTEGRATION"):
        pytest.skip("Set DIGICORE_INTEGRATION=1 to run integration tests")

    import os as _os
    _os.environ["DIGICORE_BASE_URL"] = "http://localhost:8090"

    client = DigiCoreClient()
    req = DecisionRequest(
        case_id="integration-case-001",
        service_code="99213",
        member_id="m-integration-001",
        plan_id="PLAN-INTEG",
        tenant_id="tenant-integration",
    )
    resp = await client.evaluate_request(req)

    assert resp.decision == "approved"
    assert resp.structured_trace.artifact == "mock-policy-stub-v1"
    assert resp.structured_trace.version == "1.0.0"
    assert resp.structured_trace.source == "mock-digicore"
    assert resp.structured_trace.logic_branch == "auto-approve-stub"
```

- [ ] **Step 5.3: Run the unit tests (non-integration) to confirm they pass**

```bash
cd services/integration-connectors
uv run pytest tests/test_digicore_client.py -v -m "not integration"
```

Expected output (abridged):
```
tests/test_digicore_client.py::test_circuit_breaker_starts_closed PASSED
tests/test_digicore_client.py::test_circuit_breaker_opens_after_threshold PASSED
tests/test_digicore_client.py::test_circuit_breaker_does_not_open_before_threshold PASSED
tests/test_digicore_client.py::test_circuit_breaker_closes_after_success PASSED
tests/test_digicore_client.py::test_circuit_breaker_half_open_after_recovery_timeout PASSED
tests/test_digicore_client.py::test_circuit_breaker_failure_count_resets_on_success PASSED
tests/test_digicore_client.py::test_evaluate_request_approved PASSED
tests/test_digicore_client.py::test_evaluate_request_pending_review PASSED
tests/test_digicore_client.py::test_evaluate_request_sends_correct_body PASSED
tests/test_digicore_client.py::test_successful_call_resets_circuit_breaker PASSED
tests/test_digicore_client.py::test_retries_on_503_then_succeeds PASSED
tests/test_digicore_client.py::test_retries_on_502_then_succeeds PASSED
tests/test_digicore_client.py::test_does_not_retry_on_400 PASSED
tests/test_digicore_client.py::test_does_not_retry_on_500 PASSED
tests/test_digicore_client.py::test_circuit_opens_after_5_consecutive_failures PASSED
tests/test_digicore_client.py::test_circuit_open_raises_circuit_open_error_without_http_call PASSED
tests/test_digicore_client.py::test_circuit_does_not_open_on_4_failures PASSED
tests/test_digicore_client.py::test_successful_call_after_4_failures_does_not_open_circuit PASSED
tests/test_digicore_client.py::test_integration_evaluate_request_against_mock_server SKIPPED (Set DIGICORE_INTEGRATION=1 to run integration tests)

============ 18 passed, 1 skipped in X.Xs ============
```

- [ ] **Step 5.4: Run the full test suite for this package (all non-integration tests)**

```bash
cd services/integration-connectors
uv run pytest tests/ -v -m "not integration"
```

Expected output:
```
============ 29 passed, 1 skipped in X.Xs ============
```

- [ ] **Step 5.5: Commit**

```bash
cd services/integration-connectors
git add tests/conftest.py tests/test_digicore_client.py
git commit -m "feat(connectors): DigiCoreClient unit tests — happy path, retry, circuit breaker (respx)"
```

---

## Task 6: Wire into Makefile + CI; Mark T09 Done

**Files:**
- Modify: `Makefile`
- Modify: `.claude/task-graph.md`

- [ ] **Step 6.1: Add `test-connectors` target to `Makefile`**

Edit `Makefile`. Add the following target after the `test-workflow` target:

```makefile
## Run integration-connectors tests only (unit; no external services required).
test-connectors:
	cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"
```

Also update the `test` target to include connectors:

Before:
```makefile
## Run unit, contract, and integration tests across all services.
test:
	cd packages/canonical-model && uv run pytest tests/python/ -v
	cd packages/canonical-model && npm test
	cd packages/canonical-model && ./gradlew test
	cd services/workflow-engine && uv run pytest -v
```

After:
```makefile
## Run unit, contract, and integration tests across all services.
test:
	cd packages/canonical-model && uv run pytest tests/python/ -v
	cd packages/canonical-model && npm test
	cd packages/canonical-model && ./gradlew test
	cd services/workflow-engine && uv run pytest -v
	cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"
```

- [ ] **Step 6.2: Verify the new target runs**

```bash
make test-connectors
```

Expected output ends with:
```
============ 29 passed, 1 skipped in X.Xs ============
```

- [ ] **Step 6.3: Mark T09 done in the task graph**

Edit `.claude/task-graph.md`. Change:
```
| T09 Digicore client + decision call | Py | T08 | standard | `[ ]` |
```
to:
```
| T09 Digicore client + decision call | Py | T08 | standard | `[x]` |
```

- [ ] **Step 6.4: Final commit**

```bash
git add Makefile .claude/task-graph.md
git commit -m "feat(connectors): wire T09 into Makefile test target; mark T09 done"
```

---

## Verification Checklist

Before marking the PR ready:

- [ ] `cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"` — all 29 tests pass, 1 skipped
- [ ] `make test-connectors` — exits 0
- [ ] `make test` — exits 0 (all services pass)
- [ ] `DecisionRequest(tenant_id="")` raises `ValidationError` — proved by `test_decision_request_blank_tenant_id_raises_validation_error`
- [ ] Circuit opens after exactly 5 failures — proved by `test_circuit_opens_after_5_consecutive_failures`
- [ ] Circuit open raises `CircuitOpenError` with zero HTTP calls — proved by `test_circuit_open_raises_circuit_open_error_without_http_call`
- [ ] 503 retried, 500 not retried — proved by respective tests
- [ ] `DIGICORE_BASE_URL` env override works — proved by `test_evaluate_request_approved` (uses `monkeypatch`)
- [ ] T09 marked `[x]` in `.claude/task-graph.md`
