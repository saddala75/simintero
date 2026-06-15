# T15 — Revital Client (Advisory) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `RevitalClient` to `services/integration-connectors/` so the agent-layer can call Revital's clinical summarization API (`POST /api/v1/summarize`), with PHI minimization enforced before every call, circuit-breaker/retry resilience, and an advisory-only failure contract that never blocks the case workflow.

**Architecture:** `RevitalClient` mirrors the resilience pattern of `DigiCoreClient` (T09) — `httpx.AsyncClient` + tenacity `AsyncRetrying` (3 attempts, exponential backoff 1–30 s) + `CircuitBreaker` (5 consecutive failures → open; 30 s → half-open). `CircuitBreaker` is extracted from `digicore/client.py` into a shared `circuit_breaker.py` module in Task 1 so both clients can use it. PHI minimization lives in `phi_minimizer.py` and is the **caller's responsibility** before constructing `SummarizeRequest` — `RevitalClient` never sees raw PHI fields. Provenance recording is the caller's (agent-layer's) responsibility; `RevitalClient` is a pure HTTP adapter.

**Tech Stack:** Python 3.12, httpx, tenacity, Pydantic v2, pydantic-settings, respx (test HTTP mocking), pytest-asyncio.

> **Sensitive task (AI/PHI):** Mandatory senior engineer review per CLAUDE.md for all changes in this PR. PHI minimization must be verified by test. `RevitalUnavailableError` must be caught at every call site — a Revital outage must never block case workflow (invariant #2 in integration-connectors spec). The no-autonomous-adverse invariant is not directly in scope here but is upstream; do not add any code that would let `SummarizeResponse` influence a coverage determination without human sign-off.

**Depends on:** T09 (DigiCoreClient, `CircuitBreaker`, `ConnectorSettings`, `pyproject.toml` scaffold already present), T14 (agent-layer calls `RevitalClient.summarize()`).

**Provenance design note:** `RevitalClient` is a pure HTTP adapter. It does not write to any outbox or database. The agent-layer (`CompletenessAgent`) records the `agent.assist.produced` provenance event after receiving `SummarizeResponse` — including `model_version`, `inputs_hash`, `confidence`, `abstained`. No DB coupling lives inside `RevitalClient`.

---

## Background (read before touching code)

All work is under `services/integration-connectors/`. The package name is `enstellar_connectors`.

**Expected T09 structure (must exist before this plan runs):**

```
services/integration-connectors/
  pyproject.toml
  enstellar_connectors/
    __init__.py           # re-exports DigiCoreClient, CircuitOpenError, etc.
    config.py             # ConnectorSettings (env_prefix="DIGICORE_"), get_settings(), reset_settings()
    digicore/
      __init__.py
      client.py           # DigiCoreClient + CircuitBreaker + CircuitOpenError + _is_transient()
      models.py           # DecisionRequest, StructuredTrace, DecisionResponse
  tests/
    __init__.py
    conftest.py           # reset_settings() autouse fixture
    test_digicore_models.py
    test_digicore_client.py
```

**Task 1 will extract `CircuitBreaker` and `CircuitOpenError` from `digicore/client.py` into a new `circuit_breaker.py` module.** This is necessary because `RevitalClient` needs `CircuitBreaker` without importing from a sibling package. The extraction is backward-compatible: `digicore/client.py` will import both from `..circuit_breaker`, and the existing T09 tests will continue to pass after a one-line patch-target update.

**Mock Revital server (already running in compose):** `infra/compose/mocks/revital/main.py` is a FastAPI stub at `http://mock-revital:8000` (compose) / `http://localhost:8091` (host). Its current response model shape differs from the spec's `SummarizeResponse` (`citations: list[Citation]`, `completeness: dict`, `triage: TriageSuggestion`). Task 5 updates the mock to match the spec's flat types (`citations: list[str]`, `completeness: float`, `triage: str`). The `mock-revital` compose service already exists — Task 5 does NOT add a new service.

**Config note:** `ConnectorSettings` uses `env_prefix="DIGICORE_"`. Adding `revital_base_url` with `validation_alias="REVITAL_BASE_URL"` bypasses the prefix for that field only, so the env var is `REVITAL_BASE_URL` (not `DIGICORE_REVITAL_BASE_URL`). The `reset_settings()` / `get_settings()` singleton pattern from T09 is unchanged.

**Retry note:** `_call()` uses `AsyncRetrying` (not the `@retry` decorator) to allow instance-level `retry_attempts` injection — tests pass `retry_attempts=1` to `RevitalClient.__init__()` to avoid sleep delays and keep circuit-breaker tests at 5 HTTP calls instead of 15.

**Test conventions (match T09):**
- `asyncio_mode = "auto"` in `pyproject.toml` — all async tests use `@pytest.mark.asyncio`
- Unit tests use `respx` for HTTP mocking — no network calls
- Integration tests are gated by `REVITAL_INTEGRATION=1` and call `http://localhost:8091`
- Run unit tests: `cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"`

---

## File Map

**New files:**

| File | Responsibility |
|---|---|
| `services/integration-connectors/enstellar_connectors/circuit_breaker.py` | `CircuitBreaker`, `CircuitOpenError` — extracted from `digicore/client.py`; shared by all connector clients |
| `services/integration-connectors/enstellar_connectors/revital/__init__.py` | Sub-package marker; re-exports `RevitalClient`, models, `minimize_for_revital` |
| `services/integration-connectors/enstellar_connectors/revital/models.py` | `SummarizeRequest`, `SummarizeResponse`, `RevitalUnavailableError` |
| `services/integration-connectors/enstellar_connectors/revital/client.py` | `RevitalClient` — async httpx + tenacity retry + `CircuitBreaker` |
| `services/integration-connectors/enstellar_connectors/revital/phi_minimizer.py` | `minimize_for_revital(case_data)` — strips PHI fields before `SummarizeRequest` construction |
| `services/integration-connectors/tests/test_revital_models.py` | Unit tests for Pydantic models and `RevitalUnavailableError` |
| `services/integration-connectors/tests/test_revital_client.py` | Unit tests for `RevitalClient` with respx + circuit breaker logic |
| `services/integration-connectors/tests/test_phi_minimizer.py` | Unit tests for `minimize_for_revital` |

**Modified files:**

| File | Change |
|---|---|
| `services/integration-connectors/enstellar_connectors/digicore/client.py` | Replace local `CircuitBreaker`/`CircuitOpenError` class definitions with `from ..circuit_breaker import CircuitBreaker, CircuitOpenError`; remove `import time` |
| `services/integration-connectors/enstellar_connectors/__init__.py` | Add `CircuitBreaker` re-export from `.circuit_breaker`; add all Revital re-exports |
| `services/integration-connectors/enstellar_connectors/config.py` | Add `revital_base_url` field with `validation_alias="REVITAL_BASE_URL"` |
| `services/integration-connectors/tests/test_digicore_client.py` | Update `patch("enstellar_connectors.digicore.client.time")` → `patch("enstellar_connectors.circuit_breaker.time")` |
| `services/integration-connectors/pyproject.toml` | Update `markers` description to mention both Digicore and Revital integration tests |
| `infra/compose/mocks/revital/main.py` | Update `SummarizeRequest` fields and `SummarizeResponse` types to match spec |
| `Makefile` | Add `test-revital` target; `test` target already runs all connectors tests |
| `.github/workflows/ci.yml` | Add `test-revital-client` job |
| `.claude/task-graph.md` | Mark T15 `[x]` |

---

## Task 1: Extract CircuitBreaker + scaffold Revital package + models

**Files:**
- Create: `services/integration-connectors/enstellar_connectors/circuit_breaker.py`
- Create: `services/integration-connectors/enstellar_connectors/revital/__init__.py`
- Create: `services/integration-connectors/enstellar_connectors/revital/models.py`
- Create: `services/integration-connectors/tests/test_revital_models.py`
- Modify: `services/integration-connectors/enstellar_connectors/digicore/client.py`
- Modify: `services/integration-connectors/enstellar_connectors/__init__.py`
- Modify: `services/integration-connectors/tests/test_digicore_client.py`

- [ ] **Step 1.1: Verify T09 is complete**

```bash
ls services/integration-connectors/enstellar_connectors/
```

Expected: you see `__init__.py  config.py  digicore/` (plus possibly other files). If only `.gitkeep` is present, T09 has not been implemented — stop and complete T09 first.

```bash
grep -n "class CircuitBreaker" services/integration-connectors/enstellar_connectors/digicore/client.py
```

Expected: a line number with `class CircuitBreaker`. If this grep returns nothing, `CircuitBreaker` is already in a separate file — skip Step 1.2–1.5 and go straight to Step 1.6.

- [ ] **Step 1.2: Create `circuit_breaker.py`**

Create `services/integration-connectors/enstellar_connectors/circuit_breaker.py`:

```python
"""In-memory circuit breaker shared by all integration connector clients.

Used by DigiCoreClient, RevitalClient, and any future connector to prevent
repeated calls to a failing downstream service.

State transitions:
  CLOSED    → (failure_threshold consecutive failures) → OPEN
  OPEN      → (recovery_timeout elapsed)               → HALF-OPEN (one probe)
  HALF-OPEN → (probe succeeds)                         → CLOSED
  HALF-OPEN → (probe fails)                            → OPEN

Thread-safety: not thread-safe. All clients are intended for use within
a single asyncio event loop; no locking is required.
"""
from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)


class CircuitOpenError(Exception):
    """Raised when the circuit breaker is open and no call should be attempted."""


class CircuitBreaker:
    """Simple in-memory circuit breaker."""

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
            logger.info("circuit_breaker=closed was_failures=%d", self._failures)
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
```

- [ ] **Step 1.3: Update `digicore/client.py` to import from `circuit_breaker`**

In `services/integration-connectors/enstellar_connectors/digicore/client.py`, find the block that defines `CircuitOpenError` and `CircuitBreaker` (the two class definitions). Replace those class definitions and any `import time` that exists only for them. Add an import at the top of the file instead:

The top of the file should have:
```python
from ..circuit_breaker import CircuitBreaker, CircuitOpenError
```

Remove the `import time` line if `time` is no longer used by anything else in `client.py` after the classes are removed. Keep all other code (`_is_transient`, `DigiCoreClient`, other imports) unchanged.

- [ ] **Step 1.4: Update `enstellar_connectors/__init__.py` to re-export `CircuitBreaker`**

In `services/integration-connectors/enstellar_connectors/__init__.py`, change the import that was:

```python
from .digicore.client import CircuitOpenError, DigiCoreClient
```

to:

```python
from .circuit_breaker import CircuitBreaker, CircuitOpenError
from .digicore.client import DigiCoreClient
```

Also add `"CircuitBreaker"` to the `__all__` list.

- [ ] **Step 1.5: Update T09 test patch target**

In `services/integration-connectors/tests/test_digicore_client.py`, find the test named `test_circuit_breaker_half_open_after_recovery_timeout`. Update its `patch()` call:

Before:
```python
with patch("enstellar_connectors.digicore.client.time") as mock_time:
```

After:
```python
with patch("enstellar_connectors.circuit_breaker.time") as mock_time:
```

- [ ] **Step 1.6: Run existing T09 tests to confirm extraction is backward-compatible**

```bash
cd services/integration-connectors && uv run pytest tests/test_digicore_models.py tests/test_digicore_client.py -v -m "not integration"
```

Expected output ends with:
```
============ 29 passed, 1 skipped in X.Xs ============
```

If any test fails, fix the import paths before proceeding.

- [ ] **Step 1.7: Write failing Revital model tests**

Create `services/integration-connectors/tests/test_revital_models.py`:

```python
"""Unit tests for Revital Pydantic models — no HTTP, no network.

Key invariants checked:
- INVARIANT #5: SummarizeRequest.tenant_id must be non-blank (ValidationError before any HTTP call).
- INVARIANT #3 (PHI): SummarizeRequest schema must not define PHI fields.
- RevitalUnavailableError is a plain Exception that callers can catch.
"""
import pytest
from pydantic import ValidationError

from enstellar_connectors.revital.models import (
    RevitalUnavailableError,
    SummarizeRequest,
    SummarizeResponse,
)


# ─── SummarizeRequest ────────────────────────────────────────────────────────


def test_summarize_request_happy_path():
    req = SummarizeRequest(
        case_id="case-001",
        tenant_id="tenant-alpha",
        service_codes=["99213"],
        diagnosis_codes=["J45.50"],
        lob="commercial",
        urgency="standard",
        doc_requirements=["clinical-notes"],
    )
    assert req.case_id == "case-001"
    assert req.tenant_id == "tenant-alpha"
    assert req.service_codes == ["99213"]


def test_summarize_request_model_dump_round_trip():
    req = SummarizeRequest(
        case_id="case-rt",
        tenant_id="tenant-rt",
        service_codes=["99213", "99214"],
        diagnosis_codes=["Z00.00"],
        lob="medicare",
        urgency="expedited",
        doc_requirements=["lab-results"],
    )
    restored = SummarizeRequest.model_validate(req.model_dump())
    assert restored == req


# ─── INVARIANT #5: tenant_id must not be blank ───────────────────────────────


def test_summarize_request_missing_tenant_id_raises():
    """INVARIANT #5: omitting tenant_id raises ValidationError before any HTTP call."""
    with pytest.raises(ValidationError) as exc_info:
        SummarizeRequest(
            case_id="case-001",
            # tenant_id intentionally omitted
            service_codes=["99213"],
            diagnosis_codes=["J45.50"],
            lob="commercial",
            urgency="standard",
            doc_requirements=[],
        )
    errors = exc_info.value.errors()
    assert any(e["loc"] == ("tenant_id",) for e in errors)


def test_summarize_request_blank_tenant_id_raises():
    """INVARIANT #5: empty string tenant_id (min_length=1) raises ValidationError."""
    with pytest.raises(ValidationError) as exc_info:
        SummarizeRequest(
            case_id="case-001",
            tenant_id="",
            service_codes=["99213"],
            diagnosis_codes=["J45.50"],
            lob="commercial",
            urgency="standard",
            doc_requirements=[],
        )
    errors = exc_info.value.errors()
    assert any(e["loc"] == ("tenant_id",) for e in errors)


def test_summarize_request_whitespace_only_tenant_id_raises():
    """INVARIANT #5: whitespace-only tenant_id is rejected by the field validator."""
    with pytest.raises(ValidationError):
        SummarizeRequest(
            case_id="case-001",
            tenant_id="   ",
            service_codes=["99213"],
            diagnosis_codes=["J45.50"],
            lob="commercial",
            urgency="standard",
            doc_requirements=[],
        )


# ─── INVARIANT #3 (PHI): SummarizeRequest must not define PHI fields ─────────


def test_summarize_request_schema_has_no_phi_fields():
    """PHI contract: SummarizeRequest schema must not contain any PHI field names.

    If this test fails, a developer added a PHI field to SummarizeRequest — that
    is a hard invariant violation. Remove the field immediately and use
    minimize_for_revital() to strip PHI before construction.
    """
    phi_fields = {
        "member_name", "first_name", "last_name", "middle_name",
        "dob", "date_of_birth",
        "ssn", "social_security_number",
        "address", "street_address", "city", "state", "zip", "zip_code",
        "phone", "phone_number",
        "email", "email_address",
        "member_id_raw",
    }
    schema_fields = set(SummarizeRequest.model_fields.keys())
    overlap = phi_fields & schema_fields
    assert not overlap, (
        f"PHI fields found in SummarizeRequest schema: {overlap}. "
        "Remove them — callers must use minimize_for_revital() first."
    )


# ─── SummarizeResponse ───────────────────────────────────────────────────────


def test_summarize_response_round_trip():
    resp = SummarizeResponse(
        summary="Advisory summary for case 001.",
        citations=["doc-001:span-1", "doc-002:span-3"],
        extracted_entities=[{"type": "diagnosis", "value": "asthma", "source": "notes"}],
        completeness=0.85,
        triage="standard",
        abstained=False,
        model_version="revital-v1.2.3",
    )
    restored = SummarizeResponse.model_validate(resp.model_dump())
    assert restored == resp


def test_summarize_response_abstained_flag():
    resp = SummarizeResponse(
        summary="",
        citations=[],
        extracted_entities=[],
        completeness=0.0,
        triage="escalate",
        abstained=True,
        model_version="revital-v1.2.3",
    )
    assert resp.abstained is True
    assert resp.triage == "escalate"


def test_summarize_response_validates_from_updated_mock_json():
    """Validate against the exact JSON the updated mock server (Task 5) will return."""
    raw = {
        "summary": "[Mock] Advisory summary for case test-001.",
        "citations": ["doc-mock-001:full"],
        "extracted_entities": [],
        "completeness": 0.95,
        "triage": "routine_review",
        "abstained": False,
        "model_version": "mock-v0.0.1",
    }
    resp = SummarizeResponse.model_validate(raw)
    assert resp.model_version == "mock-v0.0.1"
    assert resp.completeness == 0.95
    assert resp.abstained is False
    assert resp.citations == ["doc-mock-001:full"]


# ─── RevitalUnavailableError ─────────────────────────────────────────────────


def test_revital_unavailable_error_is_exception():
    err = RevitalUnavailableError("circuit open")
    assert isinstance(err, Exception)
    assert str(err) == "circuit open"


def test_revital_unavailable_error_can_be_caught_as_exception():
    """Advisory contract: callers catch Exception (or RevitalUnavailableError) to fall back."""
    with pytest.raises(Exception):
        raise RevitalUnavailableError("test fallback")


def test_revital_unavailable_error_preserves_cause():
    import httpx
    original = httpx.ConnectError("connection refused")
    wrapped = RevitalUnavailableError("revital unreachable") 
    wrapped.__cause__ = original
    assert wrapped.__cause__ is original
```

- [ ] **Step 1.8: Run the model tests to confirm they fail (module not found)**

```bash
cd services/integration-connectors && uv run pytest tests/test_revital_models.py -v
```

Expected:
```
ERROR tests/test_revital_models.py - ModuleNotFoundError: No module named 'enstellar_connectors.revital'
```

- [ ] **Step 1.9: Create `revital/__init__.py` (empty for now)**

Create `services/integration-connectors/enstellar_connectors/revital/__init__.py`:

```python
"""Revital sub-package — client, models, and PHI minimizer."""
```

- [ ] **Step 1.10: Create `revital/models.py`**

Create `services/integration-connectors/enstellar_connectors/revital/models.py`:

```python
"""Pydantic models for the Revital clinical summarization API.

SummarizeRequest — PHI-minimized outbound request body.
SummarizeResponse — advisory output from POST /api/v1/summarize.
RevitalUnavailableError — raised when Revital is unreachable; callers MUST catch it.

INVARIANT #3 (PHI minimum-necessary): SummarizeRequest defines only PHI-safe
fields. PHI fields (member_name, dob, ssn, etc.) must never appear in this model.
Enforced by test_summarize_request_schema_has_no_phi_fields.

INVARIANT #5: tenant_id has min_length=1 with a blank-check validator. A blank
or missing tenant_id raises ValidationError *before* any HTTP call is made.

ADVISORY ONLY: SummarizeResponse output must never be used to make or directly
influence a coverage determination without human sign-off (invariant #1).
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class SummarizeRequest(BaseModel):
    """PHI-minimized request body for POST /api/v1/summarize.

    Callers MUST call minimize_for_revital() before constructing this model.
    This class MUST NOT gain PHI fields (member_name, dob, ssn, address, etc.).
    Adding PHI fields will fail test_summarize_request_schema_has_no_phi_fields.
    """

    case_id: str = Field(min_length=1)
    tenant_id: str = Field(
        min_length=1,
        description="Required: tenant owning this request — invariant #5",
    )
    service_codes: list[str]
    diagnosis_codes: list[str]
    lob: str = Field(min_length=1)
    urgency: str = Field(min_length=1)
    doc_requirements: list[str]

    @field_validator("tenant_id")
    @classmethod
    def tenant_id_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("tenant_id must not be blank — invariant #5")
        return v


class SummarizeResponse(BaseModel):
    """Advisory response from POST /api/v1/summarize.

    ADVISORY ONLY: no code path may use this output to commit a coverage
    determination without recorded human sign-off (invariant #1).
    """

    summary: str
    citations: list[str]
    extracted_entities: list[dict[str, Any]]
    completeness: float  # 0.0–1.0
    triage: str          # e.g. "standard" | "escalate" | "expedited" | "routine_review"
    abstained: bool
    model_version: str


class RevitalUnavailableError(Exception):
    """Raised when the circuit breaker is open or all retries are exhausted.

    Callers MUST catch this and fall back to human-only review.
    A Revital outage must never block the case workflow.

    Example::

        try:
            resp = await client.summarize(req)
        except RevitalUnavailableError:
            logger.warning("revital_unavailable case_id=%s — routing to human review", case_id)
            # continue workflow without advisory summary
    """
```

- [ ] **Step 1.11: Run model tests to confirm they pass**

```bash
cd services/integration-connectors && uv run pytest tests/test_revital_models.py -v
```

Expected output:
```
tests/test_revital_models.py::test_summarize_request_happy_path PASSED
tests/test_revital_models.py::test_summarize_request_model_dump_round_trip PASSED
tests/test_revital_models.py::test_summarize_request_missing_tenant_id_raises PASSED
tests/test_revital_models.py::test_summarize_request_blank_tenant_id_raises PASSED
tests/test_revital_models.py::test_summarize_request_whitespace_only_tenant_id_raises PASSED
tests/test_revital_models.py::test_summarize_request_schema_has_no_phi_fields PASSED
tests/test_revital_models.py::test_summarize_response_round_trip PASSED
tests/test_revital_models.py::test_summarize_response_abstained_flag PASSED
tests/test_revital_models.py::test_summarize_response_validates_from_updated_mock_json PASSED
tests/test_revital_models.py::test_revital_unavailable_error_is_exception PASSED
tests/test_revital_models.py::test_revital_unavailable_error_can_be_caught_as_exception PASSED
tests/test_revital_models.py::test_revital_unavailable_error_preserves_cause PASSED

============ 12 passed in 0.Xs ============
```

- [ ] **Step 1.12: Confirm full test suite (including T09 tests) still passes**

```bash
cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"
```

Expected output ends with:
```
============ 41 passed, 1 skipped in X.Xs ============
```

(29 T09 tests + 12 new model tests = 41 passed)

- [ ] **Step 1.13: Commit**

```bash
cd services/integration-connectors
git add enstellar_connectors/circuit_breaker.py \
        enstellar_connectors/digicore/client.py \
        enstellar_connectors/__init__.py \
        enstellar_connectors/revital/__init__.py \
        enstellar_connectors/revital/models.py \
        tests/test_digicore_client.py \
        tests/test_revital_models.py
git commit -m "feat(connectors): extract CircuitBreaker; add Revital models — SummarizeRequest, SummarizeResponse, RevitalUnavailableError"
```

---

## Task 2: Extend `ConnectorSettings` with `revital_base_url`

**Files:**
- Modify: `services/integration-connectors/enstellar_connectors/config.py`

- [ ] **Step 2.1: Add the config test inline (in `tests/test_digicore_client.py` or a new file)**

The config already has tests for DigiCore settings from T09. Add the Revital config tests to the bottom of `services/integration-connectors/tests/test_digicore_client.py`:

```python
# ─── RevitalSettings in ConnectorSettings ───────────────────────────────────


def test_revital_base_url_default(monkeypatch):
    """Default value for revital_base_url points to the compose mock."""
    monkeypatch.delenv("REVITAL_BASE_URL", raising=False)
    reset_settings()
    s = get_settings()
    assert s.revital_base_url == "http://mock-revital:8000"


def test_revital_base_url_env_override(monkeypatch):
    """REVITAL_BASE_URL env var overrides the default (bypasses DIGICORE_ prefix)."""
    monkeypatch.setenv("REVITAL_BASE_URL", "http://custom-revital:9999")
    reset_settings()
    s = get_settings()
    assert s.revital_base_url == "http://custom-revital:9999"


def test_revital_base_url_does_not_use_digicore_prefix(monkeypatch):
    """Setting DIGICORE_REVITAL_BASE_URL must NOT override revital_base_url.

    The field uses validation_alias='REVITAL_BASE_URL' which bypasses env_prefix.
    """
    monkeypatch.setenv("DIGICORE_REVITAL_BASE_URL", "http://wrong-prefix:1111")
    monkeypatch.delenv("REVITAL_BASE_URL", raising=False)
    reset_settings()
    s = get_settings()
    assert s.revital_base_url == "http://mock-revital:8000"
```

You also need to add these imports at the top of `test_digicore_client.py` (if not already present):

```python
from enstellar_connectors.config import get_settings, reset_settings
```

- [ ] **Step 2.2: Run the new config tests to confirm they fail**

```bash
cd services/integration-connectors && uv run pytest tests/test_digicore_client.py::test_revital_base_url_default tests/test_digicore_client.py::test_revital_base_url_env_override tests/test_digicore_client.py::test_revital_base_url_does_not_use_digicore_prefix -v
```

Expected:
```
FAILED tests/test_digicore_client.py::test_revital_base_url_default - AttributeError: 'ConnectorSettings' object has no attribute 'revital_base_url'
```

- [ ] **Step 2.3: Update `config.py` to add `revital_base_url`**

Open `services/integration-connectors/enstellar_connectors/config.py`. Add the `revital_base_url` field to `ConnectorSettings` and add `Field` to the imports.

The updated import line becomes:
```python
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
```

Add the following field to `ConnectorSettings` after all the existing DigiCore fields (before the `_settings` singleton):

```python
    # Revital settings
    # validation_alias bypasses the DIGICORE_ env_prefix — reads REVITAL_BASE_URL directly.
    revital_base_url: str = Field(
        default="http://mock-revital:8000",
        validation_alias="REVITAL_BASE_URL",
        description="Base URL for the Revital summarization API. Override with REVITAL_BASE_URL.",
    )
```

The final `ConnectorSettings` class should look like this (existing DigiCore fields shown for context):

```python
class ConnectorSettings(BaseSettings):
    """All settings for integration-connectors.

    Environment variables:
      DIGICORE_BASE_URL                       → base_url
      DIGICORE_CIRCUIT_BREAKER_THRESHOLD      → circuit_breaker_threshold
      DIGICORE_CIRCUIT_BREAKER_RECOVERY_SECONDS → circuit_breaker_recovery_seconds
      DIGICORE_REQUEST_TIMEOUT_SECONDS        → request_timeout_seconds
      DIGICORE_RETRY_MAX_ATTEMPTS             → retry_max_attempts
      REVITAL_BASE_URL                        → revital_base_url (alias bypasses prefix)
    """

    model_config = SettingsConfigDict(
        env_prefix="DIGICORE_",
        case_sensitive=False,
    )

    # DigiCore
    base_url: str = "http://localhost:8090"
    circuit_breaker_threshold: int = 5
    circuit_breaker_recovery_seconds: float = 30.0
    request_timeout_seconds: float = 10.0
    retry_max_attempts: int = 3

    # Revital — validation_alias bypasses DIGICORE_ prefix for this field only
    revital_base_url: str = Field(
        default="http://mock-revital:8000",
        validation_alias="REVITAL_BASE_URL",
        description="Base URL for the Revital summarization API. Override with REVITAL_BASE_URL.",
    )
```

- [ ] **Step 2.4: Run the config tests to confirm they pass**

```bash
cd services/integration-connectors && uv run pytest tests/test_digicore_client.py::test_revital_base_url_default tests/test_digicore_client.py::test_revital_base_url_env_override tests/test_digicore_client.py::test_revital_base_url_does_not_use_digicore_prefix -v
```

Expected:
```
PASSED tests/test_digicore_client.py::test_revital_base_url_default
PASSED tests/test_digicore_client.py::test_revital_base_url_env_override
PASSED tests/test_digicore_client.py::test_revital_base_url_does_not_use_digicore_prefix
```

- [ ] **Step 2.5: Run full test suite to confirm no regressions**

```bash
cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"
```

Expected: all tests pass.

- [ ] **Step 2.6: Commit**

```bash
cd services/integration-connectors
git add enstellar_connectors/config.py tests/test_digicore_client.py
git commit -m "feat(connectors): add revital_base_url to ConnectorSettings — reads REVITAL_BASE_URL env var"
```

---

## Task 3: Implement `RevitalClient`

**Files:**
- Create: `services/integration-connectors/enstellar_connectors/revital/client.py`
- Create: `services/integration-connectors/tests/test_revital_client.py`
- Modify: `services/integration-connectors/enstellar_connectors/revital/__init__.py`
- Modify: `services/integration-connectors/enstellar_connectors/__init__.py`

- [ ] **Step 3.1: Write the failing client tests**

Create `services/integration-connectors/tests/test_revital_client.py`:

```python
"""Unit tests for RevitalClient using respx HTTP mocking.

Integration tests (requiring a live Revital server at localhost:8091) are
marked with @pytest.mark.integration and skipped unless REVITAL_INTEGRATION=1.
"""
from __future__ import annotations

import time
from unittest.mock import patch

import httpx
import pytest
import respx

from enstellar_connectors.circuit_breaker import CircuitBreaker
from enstellar_connectors.revital.client import RevitalClient
from enstellar_connectors.revital.models import (
    RevitalUnavailableError,
    SummarizeRequest,
    SummarizeResponse,
)

# ─── Test helpers ────────────────────────────────────────────────────────────

REVITAL_TEST_URL = "http://mock-revital-test"

MOCK_RESPONSE = {
    "summary": "[Mock] Advisory summary for case-001.",
    "citations": ["doc-mock-001:full"],
    "extracted_entities": [],
    "completeness": 0.95,
    "triage": "routine_review",
    "abstained": False,
    "model_version": "mock-v0.0.1",
}


def make_request(tenant_id: str = "tenant-t15") -> SummarizeRequest:
    return SummarizeRequest(
        case_id="case-001",
        tenant_id=tenant_id,
        service_codes=["99213"],
        diagnosis_codes=["J45.50"],
        lob="commercial",
        urgency="standard",
        doc_requirements=["clinical-notes"],
    )


def make_client() -> RevitalClient:
    """Return a RevitalClient with retry_attempts=1 so tests need no sleep/wait."""
    return RevitalClient(retry_attempts=1)


# ─── CircuitBreaker unit tests (pure logic; no HTTP) ─────────────────────────


def test_cb_starts_closed():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    assert cb.is_open() is False


def test_cb_opens_after_threshold():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    for _ in range(5):
        cb.record_failure()
    assert cb.is_open() is True


def test_cb_does_not_open_before_threshold():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    for _ in range(4):
        cb.record_failure()
    assert cb.is_open() is False


def test_cb_success_resets_failure_count():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    for _ in range(5):
        cb.record_failure()
    cb.record_success()
    assert cb.is_open() is False
    assert cb.failure_count == 0


def test_cb_half_open_after_recovery_timeout():
    """After recovery_timeout elapses, is_open() returns False (half-open probe allowed)."""
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=5.0)
    for _ in range(3):
        cb.record_failure()
    assert cb.is_open() is True

    with patch("enstellar_connectors.circuit_breaker.time") as mock_time:
        mock_time.monotonic.return_value = cb._open_at + 6.0  # 6 s > 5 s recovery
        assert cb.is_open() is False


def test_cb_failure_count_resets_on_success():
    cb = CircuitBreaker(failure_threshold=5)
    cb.record_failure()
    cb.record_failure()
    cb.record_success()
    assert cb.failure_count == 0


# ─── Happy path ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@respx.mock
async def test_summarize_happy_path(monkeypatch):
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.post(f"{REVITAL_TEST_URL}/api/v1/summarize").mock(
        return_value=httpx.Response(200, json=MOCK_RESPONSE)
    )

    client = make_client()
    resp = await client.summarize(make_request())

    assert isinstance(resp, SummarizeResponse)
    assert resp.summary == "[Mock] Advisory summary for case-001."
    assert resp.completeness == 0.95
    assert resp.abstained is False
    assert resp.model_version == "mock-v0.0.1"
    assert resp.citations == ["doc-mock-001:full"]


@pytest.mark.asyncio
@respx.mock
async def test_summarize_sends_x_tenant_id_header(monkeypatch):
    """INVARIANT #5: X-Tenant-Id header must be present on every request."""
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    route = respx.post(f"{REVITAL_TEST_URL}/api/v1/summarize").mock(
        return_value=httpx.Response(200, json=MOCK_RESPONSE)
    )

    client = make_client()
    await client.summarize(make_request(tenant_id="tenant-hdr-check"))

    assert route.called
    sent_headers = route.calls.last.request.headers
    assert sent_headers.get("x-tenant-id") == "tenant-hdr-check"


@pytest.mark.asyncio
@respx.mock
async def test_summarize_sends_correct_body_with_no_phi(monkeypatch):
    """POST body must match SummarizeRequest.model_dump() and must not contain PHI fields."""
    import json as _json
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    route = respx.post(f"{REVITAL_TEST_URL}/api/v1/summarize").mock(
        return_value=httpx.Response(200, json=MOCK_RESPONSE)
    )

    req = SummarizeRequest(
        case_id="case-body",
        tenant_id="tenant-body",
        service_codes=["99215"],
        diagnosis_codes=["Z00.00"],
        lob="medicaid",
        urgency="expedited",
        doc_requirements=["lab-results"],
    )
    client = make_client()
    await client.summarize(req)

    body = _json.loads(route.calls.last.request.content)
    assert body["case_id"] == "case-body"
    assert body["service_codes"] == ["99215"]
    assert body["tenant_id"] == "tenant-body"
    # PHI contract: no raw PHI fields in the request body
    for phi_field in ("member_name", "dob", "ssn", "date_of_birth", "social_security_number"):
        assert phi_field not in body, (
            f"PHI field '{phi_field}' must not appear in the Revital request body"
        )


@pytest.mark.asyncio
@respx.mock
async def test_successful_call_resets_circuit_breaker(monkeypatch):
    """A successful call after partial failures must reset the failure counter."""
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.post(f"{REVITAL_TEST_URL}/api/v1/summarize").mock(
        return_value=httpx.Response(200, json=MOCK_RESPONSE)
    )

    client = make_client()
    client._cb._failures = 3  # inject 3 pre-existing failures (below threshold)

    await client.summarize(make_request())

    assert client._cb.failure_count == 0
    assert client._cb.is_open() is False


# ─── Circuit breaker ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
@respx.mock
async def test_circuit_opens_after_5_consecutive_failures(monkeypatch):
    """INVARIANT: after 5 consecutive failing summarize() calls, the circuit opens."""
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    # Always return 503; retry_attempts=1 means exactly 1 HTTP call per summarize()
    respx.post(f"{REVITAL_TEST_URL}/api/v1/summarize").mock(
        return_value=httpx.Response(503, json={})
    )

    client = make_client()  # retry_attempts=1

    for _ in range(5):
        with pytest.raises(RevitalUnavailableError):
            await client.summarize(make_request())

    assert client._cb.is_open() is True
    assert client._cb.failure_count >= 5


@pytest.mark.asyncio
@respx.mock
async def test_circuit_open_raises_unavailable_without_http_call(monkeypatch):
    """When circuit is open, summarize() raises RevitalUnavailableError immediately.
    No HTTP call must be made (verified by checking route.call_count == 0).
    """
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    route = respx.post(f"{REVITAL_TEST_URL}/api/v1/summarize").mock(
        return_value=httpx.Response(200, json=MOCK_RESPONSE)
    )

    client = make_client()
    # Force the circuit open
    client._cb._failures = 5
    client._cb._open_at = time.monotonic()

    with pytest.raises(RevitalUnavailableError) as exc_info:
        await client.summarize(make_request())

    assert "circuit breaker" in str(exc_info.value).lower()
    assert route.call_count == 0  # no HTTP calls made


@pytest.mark.asyncio
@respx.mock
async def test_circuit_does_not_open_on_4_failures(monkeypatch):
    """4 consecutive failures must not open the circuit (threshold is 5)."""
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.post(f"{REVITAL_TEST_URL}/api/v1/summarize").mock(
        return_value=httpx.Response(503, json={})
    )

    client = make_client()  # retry_attempts=1
    for _ in range(4):
        with pytest.raises(RevitalUnavailableError):
            await client.summarize(make_request())

    assert client._cb.is_open() is False


# ─── Retry behavior ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
@respx.mock
async def test_retries_on_503_then_succeeds(monkeypatch):
    """Client retries on 503 and succeeds on the second attempt."""
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.post(f"{REVITAL_TEST_URL}/api/v1/summarize").mock(
        side_effect=[
            httpx.Response(503, json={"detail": "service unavailable"}),
            httpx.Response(200, json=MOCK_RESPONSE),
        ]
    )

    client = RevitalClient(retry_attempts=2)  # 1 original + 1 retry
    resp = await client.summarize(make_request())
    assert resp.completeness == 0.95


# ─── Advisory contract ───────────────────────────────────────────────────────


@pytest.mark.asyncio
@respx.mock
async def test_revital_unavailable_does_not_block_workflow(monkeypatch):
    """Advisory contract: catching RevitalUnavailableError lets the workflow continue.

    This test simulates a Revital outage and verifies that the case workflow
    can continue (human-only review) without the advisory summary.
    """
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.post(f"{REVITAL_TEST_URL}/api/v1/summarize").mock(
        return_value=httpx.Response(503, json={})
    )

    client = make_client()
    workflow_continued = False

    try:
        await client.summarize(make_request())
    except RevitalUnavailableError:
        workflow_continued = True  # gracefully fell back to human review

    assert workflow_continued, (
        "RevitalUnavailableError must be catchable so the case workflow can "
        "continue without the advisory summary (human-only review fallback)."
    )


# ─── Integration test (skipped unless REVITAL_INTEGRATION=1) ─────────────────


@pytest.mark.asyncio
@pytest.mark.integration
async def test_integration_summarize_against_mock_server():
    """Calls the real mock Revital at http://localhost:8091.

    Run with: REVITAL_INTEGRATION=1 uv run pytest tests/ -v -m integration
    Requires: make up (compose stack healthy; mock-revital reachable at :8091).
    """
    import os
    if not os.environ.get("REVITAL_INTEGRATION"):
        pytest.skip("Set REVITAL_INTEGRATION=1 to run integration tests")

    os.environ["REVITAL_BASE_URL"] = "http://localhost:8091"
    from enstellar_connectors.config import reset_settings
    reset_settings()

    client = RevitalClient()
    req = SummarizeRequest(
        case_id="integration-case-001",
        tenant_id="tenant-integration",
        service_codes=["99213"],
        diagnosis_codes=["J45.50"],
        lob="commercial",
        urgency="standard",
        doc_requirements=["clinical-notes"],
    )
    resp = await client.summarize(req)

    assert resp.model_version == "mock-v0.0.1"
    assert resp.abstained is False
    assert isinstance(resp.completeness, float)
    assert 0.0 <= resp.completeness <= 1.0
```

- [ ] **Step 3.2: Run the client tests to confirm they fail (module not found)**

```bash
cd services/integration-connectors && uv run pytest tests/test_revital_client.py -v -m "not integration"
```

Expected:
```
ERROR tests/test_revital_client.py - ImportError: cannot import name 'RevitalClient' from 'enstellar_connectors.revital.client'
```

- [ ] **Step 3.3: Create `revital/client.py`**

Create `services/integration-connectors/enstellar_connectors/revital/client.py`:

```python
"""RevitalClient — async httpx client for Revital clinical summarization API.

Design:
- httpx.AsyncClient (long-lived; one instance per RevitalClient, reuses connection pool)
- tenacity AsyncRetrying: configurable attempts (default 3), exponential backoff 1–30 s
- Retried errors: httpx.TransportError (ConnectError, TimeoutException, etc.)
  and httpx.HTTPStatusError (all non-2xx). Revital is advisory-only; aggressive
  retry is safe because failure degrades to human review, not workflow blockage.
- CircuitBreaker: opens after 5 consecutive call failures; half-open after 30 s

INVARIANT #3 (PHI minimum-necessary):
  RevitalClient never receives raw PHI fields. Callers MUST construct
  SummarizeRequest AFTER calling minimize_for_revital() — this is a caller
  contract, not a runtime check in this module.

ADVISORY ONLY:
  RevitalUnavailableError MUST be caught by callers. A Revital outage must
  never block the case workflow. Callers fall back to human-only review.

PROVENANCE:
  Recording provenance (agent.assist.produced event) is the agent-layer's
  responsibility after receiving SummarizeResponse. RevitalClient is a pure
  HTTP adapter — it has no database or outbox dependency.
"""
from __future__ import annotations

import logging

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from ..circuit_breaker import CircuitBreaker
from ..config import get_settings
from .models import RevitalUnavailableError, SummarizeRequest, SummarizeResponse

logger = logging.getLogger(__name__)


class RevitalClient:
    """Async client for Revital clinical summarization.

    Instantiate once per application lifecycle. Not thread-safe — use within
    a single asyncio event loop.

    Advisory contract — callers must handle RevitalUnavailableError::

        client = RevitalClient()
        try:
            resp = await client.summarize(req)
            # use resp.summary, resp.citations, resp.abstained, etc.
        except RevitalUnavailableError:
            logger.warning("revital_unavailable case_id=%s — routing to human review", req.case_id)
            # continue workflow without advisory summary
    """

    def __init__(self, *, retry_attempts: int = 3) -> None:
        """Create a RevitalClient.

        Args:
            retry_attempts: Total HTTP attempts per summarize() call (1 original +
                N-1 retries). Production default is 3. Pass 1 in tests to avoid
                backoff sleep delays and keep circuit-breaker tests at exactly 5
                HTTP calls (rather than 5 × 3 = 15).
        """
        settings = get_settings()
        self._http = httpx.AsyncClient(
            base_url=settings.revital_base_url,
            timeout=30.0,
        )
        self._cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
        self._retry_attempts = retry_attempts

    async def summarize(self, req: SummarizeRequest) -> SummarizeResponse:
        """Call POST /api/v1/summarize with retry and circuit-breaker protection.

        Args:
            req: PHI-minimized request. Caller is responsible for running
                 minimize_for_revital() before constructing this.

        Returns:
            SummarizeResponse — advisory output only. Never use this to make
            a coverage determination without human sign-off.

        Raises:
            RevitalUnavailableError: if the circuit breaker is open OR if all
                retry attempts are exhausted. Callers MUST catch this and fall
                back to human-only review.
        """
        if self._cb.is_open():
            raise RevitalUnavailableError(
                f"Revital circuit breaker is open after "
                f"{self._cb.failure_count} consecutive failures"
            )

        try:
            result = await self._call(req)
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            self._cb.record_failure()
            raise RevitalUnavailableError(
                f"Revital call failed after {self._retry_attempts} attempt(s): {exc}"
            ) from exc
        else:
            self._cb.record_success()
            return result

    async def _call(self, req: SummarizeRequest) -> SummarizeResponse:
        """Execute POST /api/v1/summarize with retry on transient errors.

        Uses tenacity AsyncRetrying context manager (not the @retry decorator)
        so that retry_attempts can be configured per-instance — essential for
        test isolation without mocking sleep.
        """
        async for attempt in AsyncRetrying(
            retry=retry_if_exception_type((httpx.TransportError, httpx.HTTPStatusError)),
            stop=stop_after_attempt(self._retry_attempts),
            wait=wait_exponential(multiplier=1, min=1, max=30),
            reraise=True,
        ):
            with attempt:
                r = await self._http.post(
                    "/api/v1/summarize",
                    json=req.model_dump(),
                    headers={"X-Tenant-Id": req.tenant_id},
                )
                r.raise_for_status()
                return SummarizeResponse.model_validate(r.json())
        # Unreachable: AsyncRetrying with reraise=True always raises on exhaustion.
        raise RuntimeError("Unreachable: tenacity loop exited without return or raise")
```

- [ ] **Step 3.4: Update `revital/__init__.py` to re-export the client**

Replace the content of `services/integration-connectors/enstellar_connectors/revital/__init__.py`:

```python
"""Revital sub-package — client, models, and PHI minimizer."""
from .client import RevitalClient
from .models import RevitalUnavailableError, SummarizeRequest, SummarizeResponse

__all__ = [
    "RevitalClient",
    "RevitalUnavailableError",
    "SummarizeRequest",
    "SummarizeResponse",
]
```

(The `phi_minimizer` export is added in Task 4.)

- [ ] **Step 3.5: Update top-level `enstellar_connectors/__init__.py` to re-export Revital symbols**

Add the Revital imports to `services/integration-connectors/enstellar_connectors/__init__.py`. The file should now look like this (keep all existing DigiCore exports, add below):

```python
"""Enstellar integration connectors — Digicore, Revital, terminology."""
from .circuit_breaker import CircuitBreaker, CircuitOpenError
from .digicore.client import DigiCoreClient
from .digicore.models import DecisionRequest, DecisionResponse, StructuredTrace
from .revital.client import RevitalClient
from .revital.models import RevitalUnavailableError, SummarizeRequest, SummarizeResponse

__all__ = [
    "CircuitBreaker",
    "CircuitOpenError",
    "DigiCoreClient",
    "DecisionRequest",
    "DecisionResponse",
    "StructuredTrace",
    "RevitalClient",
    "RevitalUnavailableError",
    "SummarizeRequest",
    "SummarizeResponse",
]
```

(`minimize_for_revital` is added to `__all__` in Task 4.)

- [ ] **Step 3.6: Run the client tests**

```bash
cd services/integration-connectors && uv run pytest tests/test_revital_client.py -v -m "not integration"
```

Expected output:
```
tests/test_revital_client.py::test_cb_starts_closed PASSED
tests/test_revital_client.py::test_cb_opens_after_threshold PASSED
tests/test_revital_client.py::test_cb_does_not_open_before_threshold PASSED
tests/test_revital_client.py::test_cb_success_resets_failure_count PASSED
tests/test_revital_client.py::test_cb_half_open_after_recovery_timeout PASSED
tests/test_revital_client.py::test_cb_failure_count_resets_on_success PASSED
tests/test_revital_client.py::test_summarize_happy_path PASSED
tests/test_revital_client.py::test_summarize_sends_x_tenant_id_header PASSED
tests/test_revital_client.py::test_summarize_sends_correct_body_with_no_phi PASSED
tests/test_revital_client.py::test_successful_call_resets_circuit_breaker PASSED
tests/test_revital_client.py::test_circuit_opens_after_5_consecutive_failures PASSED
tests/test_revital_client.py::test_circuit_open_raises_unavailable_without_http_call PASSED
tests/test_revital_client.py::test_circuit_does_not_open_on_4_failures PASSED
tests/test_revital_client.py::test_retries_on_503_then_succeeds PASSED
tests/test_revital_client.py::test_revital_unavailable_does_not_block_workflow PASSED
tests/test_revital_client.py::test_integration_summarize_against_mock_server SKIPPED (...)

============ 15 passed, 1 skipped in X.Xs ============
```

- [ ] **Step 3.7: Run the full test suite to confirm no regressions**

```bash
cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"
```

Expected: all tests pass (44 T09 + config tests, plus 12 model tests, plus 15 client tests = ~71 total).

- [ ] **Step 3.8: Commit**

```bash
cd services/integration-connectors
git add enstellar_connectors/revital/client.py \
        enstellar_connectors/revital/__init__.py \
        enstellar_connectors/__init__.py \
        tests/test_revital_client.py
git commit -m "feat(connectors): RevitalClient — httpx + tenacity retry + CircuitBreaker; advisory contract enforced"
```

---

## Task 4: Implement PHI Minimizer

**Files:**
- Create: `services/integration-connectors/enstellar_connectors/revital/phi_minimizer.py`
- Create: `services/integration-connectors/tests/test_phi_minimizer.py`
- Modify: `services/integration-connectors/enstellar_connectors/revital/__init__.py`
- Modify: `services/integration-connectors/enstellar_connectors/__init__.py`

- [ ] **Step 4.1: Write the failing PHI minimizer tests**

Create `services/integration-connectors/tests/test_phi_minimizer.py`:

```python
"""Unit tests for minimize_for_revital — PHI stripping before Revital calls.

INVARIANT #3 (PHI minimum-necessary): case data must be minimized before any
call to RevitalClient.summarize(). These tests verify:
1. All PHI field names in _PHI_FIELDS are stripped from the member sub-dict.
2. Non-PHI fields are preserved unchanged.
3. Top-level PHI fields are also stripped.
4. The original case_data is NOT mutated (returns a copy).
5. An end-to-end check: minimize_for_revital() → SummarizeRequest has no PHI.
"""
import pytest

from enstellar_connectors.revital.models import SummarizeRequest
from enstellar_connectors.revital.phi_minimizer import _PHI_FIELDS, minimize_for_revital


# ─── Core stripping behavior ─────────────────────────────────────────────────


def test_phi_fields_stripped_from_member_sub_dict():
    """The three most critical PHI fields must be removed from member sub-dict."""
    case_data = {
        "case_id": "case-001",
        "tenant_id": "tenant-alpha",
        "member": {
            "member_name": "John Doe",
            "dob": "1970-01-01",
            "ssn": "123-45-6789",
            "plan_id": "PLAN-001",
        },
    }
    result = minimize_for_revital(case_data)
    assert "member_name" not in result["member"]
    assert "dob" not in result["member"]
    assert "ssn" not in result["member"]


def test_non_phi_fields_in_member_preserved():
    """Fields that are not PHI must survive minimization unchanged."""
    case_data = {
        "case_id": "case-002",
        "member": {
            "plan_id": "PLAN-002",
            "lob": "commercial",
            "member_name": "Jane Smith",
        },
    }
    result = minimize_for_revital(case_data)
    assert result["member"]["plan_id"] == "PLAN-002"
    assert result["member"]["lob"] == "commercial"
    assert "member_name" not in result["member"]


def test_top_level_phi_fields_stripped():
    """PHI fields at the top level of case_data (not in a member sub-dict) are also removed."""
    case_data = {
        "case_id": "case-003",
        "tenant_id": "tenant-beta",
        "member_name": "Top Level PHI",
        "ssn": "999-99-9999",
        "service_codes": ["99213"],
    }
    result = minimize_for_revital(case_data)
    assert "member_name" not in result
    assert "ssn" not in result
    assert result["service_codes"] == ["99213"]
    assert result["case_id"] == "case-003"


def test_case_without_member_dict_unchanged():
    """If case_data has no 'member' key, the rest of the dict passes through."""
    case_data = {
        "case_id": "case-004",
        "tenant_id": "tenant-gamma",
        "service_codes": ["99215"],
        "diagnosis_codes": ["Z00.00"],
    }
    result = minimize_for_revital(case_data)
    assert result == case_data


def test_original_case_data_not_mutated():
    """minimize_for_revital must return a copy — the original must not be modified."""
    original = {
        "case_id": "case-005",
        "member": {"member_name": "Alice", "plan_id": "P-001"},
    }
    _ = minimize_for_revital(original)
    # Original must be untouched
    assert original["member"]["member_name"] == "Alice"


def test_member_none_does_not_crash():
    """If member is present but None, minimize_for_revital must not raise."""
    case_data = {"case_id": "case-006", "member": None}
    result = minimize_for_revital(case_data)
    assert result["member"] is None


def test_all_phi_field_names_stripped_from_member():
    """Every name in _PHI_FIELDS must be stripped — validates _PHI_FIELDS is complete."""
    member_with_all_phi = {field: "sensitive_value" for field in _PHI_FIELDS}
    member_with_all_phi["plan_id"] = "PLAN-SAFE"  # must survive
    case_data = {"case_id": "case-phi-all", "member": member_with_all_phi}

    result = minimize_for_revital(case_data)

    for phi_field in _PHI_FIELDS:
        assert phi_field not in result["member"], (
            f"PHI field '{phi_field}' not stripped by minimize_for_revital. "
            f"Add it to _PHI_FIELDS in phi_minimizer.py."
        )
    assert result["member"]["plan_id"] == "PLAN-SAFE"


# ─── End-to-end PHI contract ─────────────────────────────────────────────────


def test_summarize_request_built_from_minimized_dict_has_no_phi():
    """End-to-end: minimize_for_revital() → SummarizeRequest dump has no PHI fields.

    This is the definitive test for the caller contract described in
    integration-connectors spec under 'PHI rule'.
    """
    raw_case = {
        "case_id": "case-e2e-phi",
        "tenant_id": "tenant-phi-test",
        "service_codes": ["99213"],
        "diagnosis_codes": ["J45.50"],
        "lob": "commercial",
        "urgency": "standard",
        "doc_requirements": ["clinical-notes"],
        "member": {
            "member_name": "Alice Smith",
            "dob": "1980-05-15",
            "ssn": "000-00-0000",
            "date_of_birth": "1980-05-15",
            "plan_id": "PLAN-007",
        },
    }
    minimized = minimize_for_revital(raw_case)

    req = SummarizeRequest(
        case_id=minimized["case_id"],
        tenant_id=minimized["tenant_id"],
        service_codes=minimized["service_codes"],
        diagnosis_codes=minimized["diagnosis_codes"],
        lob=minimized["lob"],
        urgency=minimized["urgency"],
        doc_requirements=minimized["doc_requirements"],
    )
    dumped = req.model_dump()

    for phi_field in ("member_name", "dob", "ssn", "date_of_birth"):
        assert phi_field not in dumped, (
            f"PHI field '{phi_field}' leaked into SummarizeRequest body. "
            "Revital must never receive raw PHI fields (invariant #3)."
        )
    assert dumped["case_id"] == "case-e2e-phi"
    assert dumped["service_codes"] == ["99213"]
```

- [ ] **Step 4.2: Run the tests to confirm they fail (module not found)**

```bash
cd services/integration-connectors && uv run pytest tests/test_phi_minimizer.py -v
```

Expected:
```
ERROR tests/test_phi_minimizer.py - ModuleNotFoundError: No module named 'enstellar_connectors.revital.phi_minimizer'
```

- [ ] **Step 4.3: Create `phi_minimizer.py`**

Create `services/integration-connectors/enstellar_connectors/revital/phi_minimizer.py`:

```python
"""PHI minimizer for Revital requests.

minimize_for_revital(case_data) returns a copy of case_data with PHI fields
removed, safe for use when constructing a SummarizeRequest.

This enforces invariant #3 (PHI minimum-necessary): raw member data must
never reach the Revital inference endpoint. The minimizer removes PHI from
both the top-level dict and from the nested 'member' sub-dict.

Usage (in agent-layer, before calling RevitalClient)::

    minimized = minimize_for_revital(case_data)
    req = SummarizeRequest(
        case_id=minimized["case_id"],
        tenant_id=minimized["tenant_id"],
        service_codes=minimized.get("service_codes", []),
        diagnosis_codes=minimized.get("diagnosis_codes", []),
        lob=minimized.get("lob", ""),
        urgency=minimized.get("urgency", ""),
        doc_requirements=minimized.get("doc_requirements", []),
    )
    resp = await revital_client.summarize(req)

Never pass `case_data` directly to SummarizeRequest or RevitalClient.
"""
from __future__ import annotations

# PHI field names that must never appear in a SummarizeRequest.
# Extend this frozenset if new PHI field names are identified in canonical-model.
_PHI_FIELDS: frozenset[str] = frozenset({
    "member_name",
    "first_name",
    "last_name",
    "middle_name",
    "dob",
    "date_of_birth",
    "ssn",
    "social_security_number",
    "address",
    "street_address",
    "city",
    "state",
    "zip",
    "zip_code",
    "phone",
    "phone_number",
    "email",
    "email_address",
    "member_id_raw",
})


def minimize_for_revital(case_data: dict) -> dict:
    """Return a shallow copy of case_data with PHI fields removed.

    PHI fields are stripped from both the top-level dict and from the nested
    ``member`` sub-dict (if present and if it is a dict). All other top-level
    keys and values are preserved unchanged. The original case_data is never
    mutated.

    Args:
        case_data: Raw case dict. May contain PHI at the top level and/or
                   inside a ``member`` sub-dict.

    Returns:
        A new dict with PHI fields removed, safe for use in SummarizeRequest
        construction.
    """
    result = {k: v for k, v in case_data.items() if k not in _PHI_FIELDS}
    if "member" in result and isinstance(result["member"], dict):
        result["member"] = {
            k: v for k, v in result["member"].items() if k not in _PHI_FIELDS
        }
    return result
```

- [ ] **Step 4.4: Run the PHI minimizer tests**

```bash
cd services/integration-connectors && uv run pytest tests/test_phi_minimizer.py -v
```

Expected output:
```
tests/test_phi_minimizer.py::test_phi_fields_stripped_from_member_sub_dict PASSED
tests/test_phi_minimizer.py::test_non_phi_fields_in_member_preserved PASSED
tests/test_phi_minimizer.py::test_top_level_phi_fields_stripped PASSED
tests/test_phi_minimizer.py::test_case_without_member_dict_unchanged PASSED
tests/test_phi_minimizer.py::test_original_case_data_not_mutated PASSED
tests/test_phi_minimizer.py::test_member_none_does_not_crash PASSED
tests/test_phi_minimizer.py::test_all_phi_field_names_stripped_from_member PASSED
tests/test_phi_minimizer.py::test_summarize_request_built_from_minimized_dict_has_no_phi PASSED

============ 8 passed in 0.Xs ============
```

- [ ] **Step 4.5: Add `minimize_for_revital` to `revital/__init__.py` and top-level `__init__.py`**

Update `services/integration-connectors/enstellar_connectors/revital/__init__.py`:

```python
"""Revital sub-package — client, models, and PHI minimizer."""
from .client import RevitalClient
from .models import RevitalUnavailableError, SummarizeRequest, SummarizeResponse
from .phi_minimizer import minimize_for_revital

__all__ = [
    "RevitalClient",
    "RevitalUnavailableError",
    "SummarizeRequest",
    "SummarizeResponse",
    "minimize_for_revital",
]
```

Add `minimize_for_revital` to the import and `__all__` in `enstellar_connectors/__init__.py`:

```python
"""Enstellar integration connectors — Digicore, Revital, terminology."""
from .circuit_breaker import CircuitBreaker, CircuitOpenError
from .digicore.client import DigiCoreClient
from .digicore.models import DecisionRequest, DecisionResponse, StructuredTrace
from .revital.client import RevitalClient
from .revital.models import RevitalUnavailableError, SummarizeRequest, SummarizeResponse
from .revital.phi_minimizer import minimize_for_revital

__all__ = [
    "CircuitBreaker",
    "CircuitOpenError",
    "DigiCoreClient",
    "DecisionRequest",
    "DecisionResponse",
    "StructuredTrace",
    "RevitalClient",
    "RevitalUnavailableError",
    "SummarizeRequest",
    "SummarizeResponse",
    "minimize_for_revital",
]
```

- [ ] **Step 4.6: Verify top-level imports work**

```bash
cd services/integration-connectors && uv run python -c "
from enstellar_connectors import RevitalClient, SummarizeRequest, RevitalUnavailableError, minimize_for_revital
print('RevitalClient:', RevitalClient)
print('minimize_for_revital:', minimize_for_revital)
"
```

Expected:
```
RevitalClient: <class 'enstellar_connectors.revital.client.RevitalClient'>
minimize_for_revital: <function minimize_for_revital at 0x...>
```

- [ ] **Step 4.7: Run the complete test suite**

```bash
cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"
```

Expected: all unit tests pass, 1 integration test skipped.

- [ ] **Step 4.8: Commit**

```bash
cd services/integration-connectors
git add enstellar_connectors/revital/phi_minimizer.py \
        enstellar_connectors/revital/__init__.py \
        enstellar_connectors/__init__.py \
        tests/test_phi_minimizer.py
git commit -m "feat(connectors): PHI minimizer — minimize_for_revital strips PHI before SummarizeRequest construction"
```

---

## Task 5: Update mock server, Makefile, CI, and task graph

**Files:**
- Modify: `infra/compose/mocks/revital/main.py`
- Modify: `services/integration-connectors/pyproject.toml`
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`
- Modify: `.claude/task-graph.md`

- [ ] **Step 5.1: Update the mock Revital server to match the spec model shapes**

The existing mock at `infra/compose/mocks/revital/main.py` returns `citations: list[Citation]`, `completeness: dict`, and `triage: TriageSuggestion`. These differ from the spec's `list[str]`, `float`, and `str`. Update the file so the response matches what `SummarizeResponse.model_validate()` expects.

Replace the entire contents of `infra/compose/mocks/revital/main.py`:

```python
"""Mock Revital server for local development.

Returns spec-conformant SummarizeResponse shapes:
  - citations: list[str]
  - completeness: float (0.0–1.0)
  - triage: str

Run via docker compose (make up) at http://mock-revital:8000 (compose) /
http://localhost:8091 (host). Used by RevitalClient integration tests.
"""
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(
    title="Mock Revital",
    description="Stub for local development — returns advisory summaries matching spec",
)


class SummarizeRequest(BaseModel):
    case_id: str
    tenant_id: str
    service_codes: list[str] = []
    diagnosis_codes: list[str] = []
    lob: str = ""
    urgency: str = ""
    doc_requirements: list[str] = []


class SummarizeResponse(BaseModel):
    summary: str
    citations: list[str]
    extracted_entities: list[dict[str, Any]]
    completeness: float          # 0.0–1.0
    triage: str                  # "standard" | "escalate" | "expedited" | "routine_review"
    abstained: bool
    model_version: str


@app.post("/api/v1/summarize", response_model=SummarizeResponse)
async def summarize(req: SummarizeRequest) -> SummarizeResponse:
    return SummarizeResponse(
        summary=f"[Mock] Advisory summary for case {req.case_id}. No real documents were analyzed.",
        citations=["doc-mock-001:full"],
        extracted_entities=[],
        completeness=0.95,
        triage="routine_review",
        abstained=False,
        model_version="mock-v0.0.1",
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "mock-revital"}
```

- [ ] **Step 5.2: Lint the updated mock server**

```bash
ruff check infra/compose/mocks/revital/main.py
```

Expected: no output (no lint errors). If there are errors, fix them before proceeding.

- [ ] **Step 5.3: Validate docker-compose config is still valid**

```bash
docker compose -f infra/compose/docker-compose.yml config --quiet
```

Expected: exits 0 with no errors. (The compose service `mock-revital` is already configured and unchanged.)

- [ ] **Step 5.4: Update the `pyproject.toml` markers description**

In `services/integration-connectors/pyproject.toml`, update the `markers` list to mention both Digicore and Revital:

Before:
```toml
markers = [
    "integration: marks tests that require a running Digicore server (deselect with '-m not integration')",
]
```

After:
```toml
markers = [
    "integration: marks tests requiring a live external service (Digicore or Revital); deselect with '-m not integration'",
]
```

- [ ] **Step 5.5: Add `test-revital` target to `Makefile`**

Open `Makefile`. Add the following target after the `test-connectors` target:

```makefile
## Run Revital client tests only (unit; no external services required).
test-revital:
	cd services/integration-connectors && uv run pytest tests/test_revital_models.py tests/test_revital_client.py tests/test_phi_minimizer.py -v -m "not integration"
```

The `test` target already runs `cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"` (added in T09), which covers all connector tests including the new Revital tests. No change to the `test` target is needed.

- [ ] **Step 5.6: Verify the new Makefile target**

```bash
make test-revital
```

Expected output ends with:
```
============ 35 passed in X.Xs ============
```

(12 model tests + 15 client tests + 8 phi minimizer tests = 35)

- [ ] **Step 5.7: Add the `test-revital-client` job to CI**

Open `.github/workflows/ci.yml`. Add the following job at the end of the `jobs:` block:

```yaml
  test-revital-client:
    name: integration-connectors — Revital client (advisory)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install uv
        run: pip install uv
      - name: Test
        working-directory: services/integration-connectors
        run: |
          uv sync
          uv run pytest tests/test_revital_models.py tests/test_revital_client.py tests/test_phi_minimizer.py -v -m "not integration"
```

- [ ] **Step 5.8: Validate CI YAML syntax**

```bash
docker compose -f infra/compose/docker-compose.yml config --quiet && echo "compose ok"
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('ci.yml ok')"
```

Expected:
```
compose ok
ci.yml ok
```

- [ ] **Step 5.9: Mark T15 done in the task graph**

Open `.claude/task-graph.md`. Change:

```
| T15 Revital client (advisory) | Py | T14 | **sensitive (AI/PHI)** | `[ ]` |
```

to:

```
| T15 Revital client (advisory) | Py | T14 | **sensitive (AI/PHI)** | `[x]` |
```

- [ ] **Step 5.10: Final commit**

```bash
git add infra/compose/mocks/revital/main.py \
        services/integration-connectors/pyproject.toml \
        Makefile \
        .github/workflows/ci.yml \
        .claude/task-graph.md
git commit -m "feat(connectors): T15 complete — update Revital mock, add test-revital target, add CI job, mark T15 done"
```

---

## Verification Checklist

Before marking the PR ready for review, confirm all of the following:

- [ ] `cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"` — all tests pass, 1 integration skipped
- [ ] `make test-revital` — exits 0
- [ ] `make test` — exits 0 (all services pass)
- [ ] `docker compose -f infra/compose/docker-compose.yml config --quiet` — exits 0
- [ ] `ruff check infra/compose/mocks/revital/main.py` — no errors
- [ ] **PHI invariant:** `SummarizeRequest` schema has no PHI fields — proved by `test_summarize_request_schema_has_no_phi_fields`
- [ ] **PHI invariant:** `test_summarize_request_built_from_minimized_dict_has_no_phi` passes
- [ ] **Tenant invariant:** `SummarizeRequest(tenant_id="")` raises `ValidationError` — proved by `test_summarize_request_blank_tenant_id_raises`
- [ ] **Tenant invariant:** `X-Tenant-Id` header on every request — proved by `test_summarize_sends_x_tenant_id_header`
- [ ] **Circuit breaker:** opens after exactly 5 failures — proved by `test_circuit_opens_after_5_consecutive_failures`
- [ ] **Circuit breaker:** open circuit raises `RevitalUnavailableError` with zero HTTP calls — proved by `test_circuit_open_raises_unavailable_without_http_call`
- [ ] **Advisory contract:** `RevitalUnavailableError` catchable; workflow continues — proved by `test_revital_unavailable_does_not_block_workflow`
- [ ] `REVITAL_BASE_URL` env override works — proved by `test_summarize_happy_path` (uses `monkeypatch`)
- [ ] `REVITAL_BASE_URL` is NOT affected by `DIGICORE_` prefix — proved by `test_revital_base_url_does_not_use_digicore_prefix`
- [ ] T15 marked `[x]` in `.claude/task-graph.md`
- [ ] Senior engineer review completed (mandatory per CLAUDE.md for sensitive AI/PHI tasks)
