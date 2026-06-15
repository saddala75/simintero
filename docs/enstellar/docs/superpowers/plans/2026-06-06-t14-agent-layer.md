# T14 — Agent Layer + Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `services/agent-layer/` with a Completeness & RFI assist agent (LangGraph typed graph), a guardrail engine (7 rules, hard-block on adverse language), and a model-access layer (Anthropic commercial + Ollama local), exposing `POST /assist/completeness` that advisory reviewers call from the BFF.

**Architecture:** Agents are advisory tools only — they produce `AgentOutput` (confidence, citations, abstained flag, provenance) but CANNOT commit state transitions. All agent outputs pass through `GuardrailEngine` before leaving the service. No LLM call is on the coverage-determination path. PHI is minimized to `case_summary` dict before any model call — raw Case fields never reach the model. Model selection is config, not code (`ENSTELLAR_MODEL_PROVIDER`).

**Tech Stack:** Python 3.12, FastAPI, LangGraph, Anthropic SDK, httpx (Ollama), Pydantic v2, pytest.

> **Sensitive task (AI):** Mandatory senior engineer review per CLAUDE.md for all changes to the guardrail engine and model-access layer. The no-autonomous-adverse rule in `GuardrailEngine` is sacred — do not weaken or remove it. Agents that abstain are correct behavior; do not "fix" abstention by lowering thresholds.

**Depends on:** T13 (pend/RFI workflow state, which triggers completeness assist invocation), T03 (auth, for BFF-to-agent-layer service calls).

---

## Background (read before touching code)

All work is under `services/agent-layer/`. The Python package is `enstellar_agents`.

**Currently exists:**
- `services/agent-layer/.gitkeep` — placeholder only; the directory is otherwise empty.

**Key invariants (NEVER weaken their tests):**
1. No code path may issue or be the sole basis for an adverse determination without recorded human sign-off. The `rule_no_autonomous_adverse` guard enforces this in the agent layer.
2. No LLM call participates in a coverage determination. Agents produce advisory output; the workflow-engine remains the system of record.
3. PHI minimum-necessary: `case_summary` is a minimized dict (procedure codes, diagnosis codes, urgency, lob) — it must never contain member name, SSN, DOB, or full addresses. The guardrail engine checks for SSN/DOB patterns in output.
5. `tenant_id` propagates on every call, event, and log line.

**Upstream services (read-only from agent-layer):**
- `services/workflow-engine/` — REST at `http://workflow-engine:8000`; agent-layer only reads from it, never writes state.
- `packages/canonical-model/generated/python/canonical_model/` — `Case`, `Status`, `ServiceLine`, etc. (agent-layer does NOT import these; the BFF/workflow-engine translates to `case_summary: dict` before calling the agent).
- `packages/event-contracts/enstellar_events/` — `Topics.AGENT_ASSIST_PRODUCED = "agent.assist.produced"` (for future event emission; not wired in T14).

**Project conventions (match what workflow-engine already does):**
- `pydantic-settings` with env prefix `ENSTELLAR_` and `get_settings()` singleton pattern.
- FastAPI, structured JSON logging, `asyncio_mode = "auto"` in pytest.
- Run tests: `cd services/agent-layer && uv run pytest -v`
- `uv sync` installs from `pyproject.toml`; no manual pip install.

---

## File Map

**New files (all created from scratch):**

| File | Responsibility |
|---|---|
| `services/agent-layer/pyproject.toml` | Package manifest, dependencies, pytest config |
| `services/agent-layer/enstellar_agents/__init__.py` | Package marker |
| `services/agent-layer/enstellar_agents/config.py` | `AgentSettings` (pydantic-settings, `ENSTELLAR_` prefix); `get_settings()` singleton |
| `services/agent-layer/enstellar_agents/models.py` | `AgentInput`, `AgentOutput`, `GuardrailResult`, `CompletionGap`, `RfiDraft` |
| `services/agent-layer/enstellar_agents/guardrails/__init__.py` | Package marker; re-exports `GuardrailEngine`, `GuardrailResult` |
| `services/agent-layer/enstellar_agents/guardrails/rules.py` | 7 rule functions; each returns `str | None` (None = pass) |
| `services/agent-layer/enstellar_agents/guardrails/engine.py` | `GuardrailEngine.check()` — runs all 7 rules, returns `GuardrailResult` |
| `services/agent-layer/enstellar_agents/model_access/__init__.py` | Package marker; re-exports `ModelAdapter`, `get_adapter` |
| `services/agent-layer/enstellar_agents/model_access/base.py` | `ModelAdapter` ABC: `complete()`, `model_name()` |
| `services/agent-layer/enstellar_agents/model_access/anthropic_adapter.py` | `AnthropicAdapter(ModelAdapter)` — wraps `anthropic.AsyncAnthropic` |
| `services/agent-layer/enstellar_agents/model_access/ollama_adapter.py` | `OllamaAdapter(ModelAdapter)` — wraps httpx POST to Ollama `/api/generate` |
| `services/agent-layer/enstellar_agents/model_access/factory.py` | `get_adapter(settings)` — selects adapter from `ENSTELLAR_MODEL_PROVIDER` |
| `services/agent-layer/enstellar_agents/agents/__init__.py` | Package marker |
| `services/agent-layer/enstellar_agents/agents/completeness.py` | `CompletenessState` TypedDict, `build_graph(adapter)` — LangGraph typed graph with 3 nodes |
| `services/agent-layer/enstellar_agents/routers/__init__.py` | Package marker |
| `services/agent-layer/enstellar_agents/routers/assist.py` | `POST /assist/completeness` FastAPI router |
| `services/agent-layer/enstellar_agents/main.py` | FastAPI `app`, `GET /healthz`, includes `assist_router` (added in Task 8) |
| `services/agent-layer/tests/__init__.py` | Package marker |
| `services/agent-layer/tests/conftest.py` | Shared fixtures: env var setup, settings reset, `MockAdapter`, sample inputs |
| `services/agent-layer/tests/test_main.py` | `GET /healthz` → 200 |
| `services/agent-layer/tests/test_models.py` | Round-trip serialize/deserialize for all 5 model types; field validation |
| `services/agent-layer/tests/test_guardrails.py` | Parametrized tests for all 7 rules + `GuardrailEngine` integration |
| `services/agent-layer/tests/test_adapters.py` | OllamaAdapter (respx mock), AnthropicAdapter (unittest.mock patch), factory |
| `services/agent-layer/tests/test_completeness_agent.py` | LangGraph graph: valid JSON, invalid JSON (→ abstained), low confidence (→ abstained), adverse (→ guardrail blocks) |
| `services/agent-layer/tests/test_assist_router.py` | `POST /assist/completeness` via `httpx.AsyncClient` + `ASGITransport` |
| `services/agent-layer/evals/__init__.py` | Package marker |
| `services/agent-layer/evals/test_completeness_eval.py` | Groundedness ≥ 0.8, gap-detection precision ≥ 0.75, abstention rate ≥ 0.6 |

**Modified files:**

| File | Change |
|---|---|
| `Makefile` | Add `test-agents` target |
| `.github/workflows/ci.yml` | Add `test-agent-layer` job |

---

## Task 1: Scaffold + config

**Files:**
- Create: `services/agent-layer/pyproject.toml`
- Create: `services/agent-layer/enstellar_agents/__init__.py`
- Create: `services/agent-layer/enstellar_agents/config.py`
- Create: `services/agent-layer/enstellar_agents/main.py`
- Create: `services/agent-layer/tests/__init__.py`
- Create: `services/agent-layer/tests/conftest.py`
- Create: `services/agent-layer/tests/test_main.py`

- [ ] **Step 1: Create directory structure**

```bash
cd /path/to/repo
mkdir -p services/agent-layer/enstellar_agents/guardrails
mkdir -p services/agent-layer/enstellar_agents/model_access
mkdir -p services/agent-layer/enstellar_agents/agents
mkdir -p services/agent-layer/enstellar_agents/routers
mkdir -p services/agent-layer/tests
mkdir -p services/agent-layer/evals
rm services/agent-layer/.gitkeep
```

- [ ] **Step 2: Create `pyproject.toml`**

`services/agent-layer/pyproject.toml`:
```toml
[project]
name = "enstellar-agents"
version = "0.1.0"
description = "Enstellar agent layer — advisory completeness and RFI assist agents"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
    "langgraph>=0.2",
    "anthropic>=0.34",
    "httpx>=0.27",
    "pydantic>=2.9",
    "pydantic-settings>=2.3",
]

[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "pytest-mock>=3.12",
    "respx>=0.21",
    "ruff>=0.4",
    "mypy>=1.10",
]

[tool.pytest.ini_options]
testpaths = ["tests", "evals"]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 3: Create `enstellar_agents/__init__.py`**

```python
```
(empty file — package marker only)

- [ ] **Step 4: Write the failing test for healthz**

`services/agent-layer/tests/test_main.py`:
```python
"""Tests for FastAPI application entry point."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient


async def test_healthz_returns_ok() -> None:
    from enstellar_agents.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/healthz")

    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 5: Run the failing test to confirm it fails**

```bash
cd services/agent-layer && uv run pytest tests/test_main.py -v
```
Expected: `ModuleNotFoundError: No module named 'enstellar_agents'` (module not yet created).

- [ ] **Step 6: Create `enstellar_agents/config.py`**

`services/agent-layer/enstellar_agents/config.py`:
```python
"""Agent layer settings — loaded from environment variables."""
from __future__ import annotations

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AgentSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ENSTELLAR_", case_sensitive=False)

    model_provider: str = "ollama"          # "anthropic" | "ollama"
    model_name: str = "llama3"
    anthropic_api_key: str | None = None
    ollama_base_url: str = "http://ollama:11434"

    @model_validator(mode="after")
    def _require_api_key_for_anthropic(self) -> "AgentSettings":
        if self.model_provider == "anthropic" and not self.anthropic_api_key:
            raise ValueError(
                "ENSTELLAR_ANTHROPIC_API_KEY is required when ENSTELLAR_MODEL_PROVIDER=anthropic"
            )
        return self


_settings: AgentSettings | None = None


def get_settings() -> AgentSettings:
    global _settings
    if _settings is None:
        _settings = AgentSettings()
    return _settings
```

- [ ] **Step 7: Create `enstellar_agents/main.py`**

`services/agent-layer/enstellar_agents/main.py`:
```python
"""Enstellar Agent Layer — FastAPI application entry point.

Start with:
    uvicorn enstellar_agents.main:app --host 0.0.0.0 --port 8001 --reload
"""
from __future__ import annotations

import logging
import sys

from fastapi import FastAPI

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": "%(message)s"}',
)

app = FastAPI(
    title="Enstellar Agent Layer",
    version="0.1.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 8: Create `tests/__init__.py` and `tests/conftest.py`**

`services/agent-layer/tests/__init__.py`:
```python
```
(empty)

`services/agent-layer/tests/conftest.py`:
```python
"""Shared fixtures for enstellar-agents tests."""
from __future__ import annotations

import json
import os
from uuid import uuid4

import pytest

# Default env vars — no real API keys needed in unit/integration tests.
os.environ.setdefault("ENSTELLAR_MODEL_PROVIDER", "ollama")
os.environ.setdefault("ENSTELLAR_MODEL_NAME", "llama3")
os.environ.setdefault("ENSTELLAR_OLLAMA_BASE_URL", "http://localhost:11434")


@pytest.fixture(autouse=True)
def _reset_agent_settings() -> None:
    """Reset settings singleton before/after each test for env-var isolation."""
    import enstellar_agents.config as _cfg

    _cfg._settings = None
    yield
    _cfg._settings = None


class MockAdapter:
    """In-process mock adapter — returns a pre-set string without any HTTP call."""

    def __init__(self, response: str, model: str = "test-model") -> None:
        self._response = response
        self._model = model

    async def complete(self, system_prompt: str, user_message: str) -> str:  # noqa: ARG002
        return self._response

    def model_name(self) -> str:
        return self._model


VALID_RESPONSE = json.dumps(
    {
        "gaps": [
            {
                "description": "Missing operative report for primary procedure",
                "required_document_type": "operative_report",
                "citation": "CriteriaCorp SR-2024",
            }
        ],
        "rfi_draft": {
            "subject": "Documentation Request — Operative Report",
            "body": "Please provide the operative report for the procedure dated in your submission.",
            "required_documents": ["operative_report"],
            "due_date_days": 14,
        },
        "confidence": 0.85,
        "citations": ["CriteriaCorp SR-2024"],
    }
)

INVALID_JSON_RESPONSE = "definitely not valid json {{ broken"

LOW_CONFIDENCE_RESPONSE = json.dumps(
    {
        "gaps": [],
        "rfi_draft": {
            "subject": "",
            "body": "",
            "required_documents": [],
            "due_date_days": 14,
        },
        "confidence": 0.3,
        "citations": [],
    }
)

# Confidence is high enough to pass the abstention threshold (≥0.4) but
# the rfi body contains "denied" — triggers rule_no_autonomous_adverse.
ADVERSE_RESPONSE = json.dumps(
    {
        "gaps": [
            {
                "description": "Service not medically necessary per review",
                "required_document_type": "clinical_notes",
                "citation": "CriteriaCorp SR-2024",
            }
        ],
        "rfi_draft": {
            "subject": "Adverse Notice",
            "body": "Based on review, the service appears denied as not medically necessary.",
            "required_documents": [],
            "due_date_days": 14,
        },
        "confidence": 0.9,
        "citations": ["CriteriaCorp SR-2024"],
    }
)


@pytest.fixture
def mock_adapter_valid() -> MockAdapter:
    return MockAdapter(VALID_RESPONSE)


@pytest.fixture
def mock_adapter_invalid_json() -> MockAdapter:
    return MockAdapter(INVALID_JSON_RESPONSE)


@pytest.fixture
def mock_adapter_low_confidence() -> MockAdapter:
    return MockAdapter(LOW_CONFIDENCE_RESPONSE)


@pytest.fixture
def mock_adapter_adverse() -> MockAdapter:
    return MockAdapter(ADVERSE_RESPONSE)


@pytest.fixture
def sample_input_dict() -> dict:
    return {
        "tenant_id": "tenant-abc",
        "case_id": str(uuid4()),
        "case_summary": {
            "procedure_code": "27447",
            "diagnosis_codes": ["M17.11"],
            "urgency": "standard",
            "lob": "commercial",
        },
        "doc_requirements": ["operative_report", "clinical_notes"],
        "correlation_id": "corr-001",
    }
```

- [ ] **Step 9: Install dependencies and run the test**

```bash
cd services/agent-layer && uv sync && uv run pytest tests/test_main.py -v
```
Expected:
```
PASSED tests/test_main.py::test_healthz_returns_ok
1 passed in Xs
```

- [ ] **Step 10: Commit**

```bash
git add services/agent-layer/
git commit -m "feat(agent-layer): scaffold service — pyproject.toml, config, FastAPI /healthz"
```

---

## Task 2: models.py

**Files:**
- Create: `services/agent-layer/enstellar_agents/models.py`
- Create: `services/agent-layer/tests/test_models.py`

- [ ] **Step 1: Write the failing tests**

`services/agent-layer/tests/test_models.py`:
```python
"""Unit tests for all Pydantic models in enstellar_agents.models."""
from __future__ import annotations

import pytest
from pydantic import ValidationError
from uuid import UUID, uuid4


def _sample_agent_input_data() -> dict:
    return {
        "tenant_id": "tenant-xyz",
        "case_id": str(uuid4()),
        "case_summary": {"procedure_code": "27447", "diagnosis_codes": ["M17.11"]},
        "doc_requirements": ["operative_report"],
        "correlation_id": "corr-999",
    }


def _sample_agent_output_data(case_id: str) -> dict:
    return {
        "agent_id": "completeness-v1",
        "tenant_id": "tenant-xyz",
        "case_id": case_id,
        "confidence": 0.85,
        "citations": ["CriteriaCorp SR-2024"],
        "abstained": False,
        "abstention_reason": None,
        "result": {"gaps": []},
        "provenance": {
            "model_name": "llama3",
            "input_hash": "abc123def456",
            "timestamp": "2026-06-06T00:00:00+00:00",
        },
    }


def test_agent_input_round_trip() -> None:
    from enstellar_agents.models import AgentInput

    data = _sample_agent_input_data()
    obj = AgentInput.model_validate(data)
    assert obj.tenant_id == "tenant-xyz"
    assert isinstance(obj.case_id, UUID)
    assert obj.doc_requirements == ["operative_report"]
    # Round-trip through JSON
    assert AgentInput.model_validate_json(obj.model_dump_json()).tenant_id == "tenant-xyz"


def test_agent_input_blank_tenant_id_raises() -> None:
    from enstellar_agents.models import AgentInput

    data = _sample_agent_input_data()
    data["tenant_id"] = ""
    with pytest.raises(ValidationError, match="tenant_id"):
        AgentInput.model_validate(data)


def test_agent_output_round_trip() -> None:
    from enstellar_agents.models import AgentOutput

    case_id = str(uuid4())
    data = _sample_agent_output_data(case_id)
    obj = AgentOutput.model_validate(data)
    assert obj.abstained is False
    assert obj.confidence == 0.85
    assert obj.citations == ["CriteriaCorp SR-2024"]
    assert AgentOutput.model_validate_json(obj.model_dump_json()).agent_id == "completeness-v1"


def test_agent_output_abstained_has_no_result() -> None:
    from enstellar_agents.models import AgentOutput

    case_id = str(uuid4())
    data = _sample_agent_output_data(case_id)
    data["abstained"] = True
    data["abstention_reason"] = "low confidence"
    data["result"] = None
    obj = AgentOutput.model_validate(data)
    assert obj.result is None
    assert obj.abstention_reason == "low confidence"


def test_guardrail_result_passed_round_trip() -> None:
    from enstellar_agents.models import GuardrailResult

    obj = GuardrailResult(passed=True, violations=[])
    assert GuardrailResult.model_validate_json(obj.model_dump_json()).passed is True


def test_guardrail_result_failed_preserves_violations() -> None:
    from enstellar_agents.models import GuardrailResult

    obj = GuardrailResult(passed=False, violations=["no_autonomous_adverse: found 'denied'"])
    assert obj.violations[0].startswith("no_autonomous_adverse")


def test_completion_gap_round_trip() -> None:
    from enstellar_agents.models import CompletionGap

    obj = CompletionGap(
        gap_id="gap-1",
        description="Missing operative report",
        required_document_type="operative_report",
        citations=["CriteriaCorp SR-2024"],
    )
    assert CompletionGap.model_validate_json(obj.model_dump_json()).gap_id == "gap-1"


def test_rfi_draft_round_trip() -> None:
    from enstellar_agents.models import RfiDraft

    obj = RfiDraft(
        subject="Documentation Request",
        body="Please provide the requested documents.",
        required_documents=["operative_report"],
        due_date_days=14,
    )
    assert RfiDraft.model_validate_json(obj.model_dump_json()).due_date_days == 14
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd services/agent-layer && uv run pytest tests/test_models.py -v
```
Expected: `ModuleNotFoundError: No module named 'enstellar_agents.models'`

- [ ] **Step 3: Create `enstellar_agents/models.py`**

`services/agent-layer/enstellar_agents/models.py`:
```python
"""Typed Pydantic models for agent I/O, guardrail results, and domain objects."""
from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class CompletionGap(BaseModel):
    """A single documentation gap identified by the completeness agent."""

    gap_id: str
    description: str
    required_document_type: str
    citations: list[str]  # references to Digicore doc rules or clinical criteria


class RfiDraft(BaseModel):
    """Draft RFI text produced by the completeness agent."""

    subject: str
    body: str
    required_documents: list[str]
    due_date_days: int


class AgentInput(BaseModel):
    """Input to any agent — always includes tenant_id and PHI-minimized case fields."""

    tenant_id: str = Field(min_length=1)
    case_id: UUID
    case_summary: dict[str, Any]  # PHI-minimized: procedure_code, diagnosis_codes, urgency, lob only
    doc_requirements: list[str]   # from Digicore structured_trace
    correlation_id: str


class AgentOutput(BaseModel):
    """Output from any agent — advisory only; must pass GuardrailEngine before leaving the service."""

    agent_id: str
    tenant_id: str
    case_id: UUID
    confidence: float              # 0.0–1.0; agent's self-reported confidence
    citations: list[str]
    abstained: bool
    abstention_reason: str | None = None
    result: dict[str, Any] | None = None  # None when abstained=True
    provenance: dict[str, Any]            # model_name, input_hash, timestamp


class GuardrailResult(BaseModel):
    """Result from GuardrailEngine.check() — passed=False means the output must not be used."""

    passed: bool
    violations: list[str]  # human-readable rule names that fired
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd services/agent-layer && uv run pytest tests/test_models.py -v
```
Expected:
```
PASSED tests/test_models.py::test_agent_input_round_trip
PASSED tests/test_models.py::test_agent_input_blank_tenant_id_raises
PASSED tests/test_models.py::test_agent_output_round_trip
PASSED tests/test_models.py::test_agent_output_abstained_has_no_result
PASSED tests/test_models.py::test_guardrail_result_passed_round_trip
PASSED tests/test_models.py::test_guardrail_result_failed_preserves_violations
PASSED tests/test_models.py::test_completion_gap_round_trip
PASSED tests/test_models.py::test_rfi_draft_round_trip
8 passed in Xs
```

- [ ] **Step 5: Commit**

```bash
git add services/agent-layer/enstellar_agents/models.py services/agent-layer/tests/test_models.py
git commit -m "feat(agent-layer): add Pydantic models — AgentInput, AgentOutput, GuardrailResult, CompletionGap, RfiDraft"
```

---

## Task 3: Guardrail rules

**Files:**
- Create: `services/agent-layer/enstellar_agents/guardrails/__init__.py`
- Create: `services/agent-layer/enstellar_agents/guardrails/rules.py`
- Create: `services/agent-layer/tests/test_guardrails.py` (partial — rules only; engine added in Task 4)

- [ ] **Step 1: Write the failing tests for each rule**

`services/agent-layer/tests/test_guardrails.py`:
```python
"""Tests for guardrail rules and GuardrailEngine.

Each rule has two test cases: a passing case and a failing case.
Tests marked INVARIANT must never be deleted or weakened.
"""
from __future__ import annotations

import pytest
from uuid import uuid4


def _make_output(**overrides):
    """Create a minimal valid AgentOutput for testing."""
    from enstellar_agents.models import AgentOutput

    defaults = {
        "agent_id": "completeness-v1",
        "tenant_id": "tenant-abc",
        "case_id": uuid4(),
        "confidence": 0.85,
        "citations": ["CriteriaCorp SR-2024"],
        "abstained": False,
        "abstention_reason": None,
        "result": {"gaps": [], "rfi_draft": {"body": "Please provide documents."}},
        "provenance": {"model_name": "llama3", "timestamp": "2026-06-06T00:00:00+00:00"},
    }
    defaults.update(overrides)
    return AgentOutput.model_validate(defaults)


# ──────────────────────────────────────────────
# rule_no_autonomous_adverse  [INVARIANT]
# ──────────────────────────────────────────────

def test_rule_no_autonomous_adverse_passes_clean_output() -> None:
    from enstellar_agents.guardrails.rules import rule_no_autonomous_adverse

    output = _make_output(result={"gaps": [], "rfi_draft": {"body": "Please provide the missing documents."}})
    assert rule_no_autonomous_adverse(output) is None


@pytest.mark.parametrize("keyword", ["denied", "deny", "denial", "adverse",
                                      "not medically necessary", "experimental", "investigational"])
def test_rule_no_autonomous_adverse_blocks_adverse_keyword(keyword: str) -> None:
    """INVARIANT: Any adverse keyword in output must be blocked. Never remove this test."""
    from enstellar_agents.guardrails.rules import rule_no_autonomous_adverse

    output = _make_output(result={"text": f"The claim is {keyword}."})
    violation = rule_no_autonomous_adverse(output)
    assert violation is not None
    assert "no_autonomous_adverse" in violation


# ──────────────────────────────────────────────
# rule_citations_required
# ──────────────────────────────────────────────

def test_rule_citations_required_passes_non_abstained_with_citations() -> None:
    from enstellar_agents.guardrails.rules import rule_citations_required

    output = _make_output(abstained=False, citations=["CriteriaCorp SR-2024"])
    assert rule_citations_required(output) is None


def test_rule_citations_required_blocks_non_abstained_no_citations() -> None:
    from enstellar_agents.guardrails.rules import rule_citations_required

    output = _make_output(abstained=False, citations=[])
    violation = rule_citations_required(output)
    assert violation is not None
    assert "citations_required" in violation


def test_rule_citations_required_passes_abstained_with_no_citations() -> None:
    """Abstained outputs are exempt from the citations requirement."""
    from enstellar_agents.guardrails.rules import rule_citations_required

    output = _make_output(abstained=True, citations=[], result=None)
    assert rule_citations_required(output) is None


# ──────────────────────────────────────────────
# rule_confidence_threshold
# ──────────────────────────────────────────────

def test_rule_confidence_threshold_passes_at_threshold() -> None:
    from enstellar_agents.guardrails.rules import rule_confidence_threshold

    output = _make_output(confidence=0.7, abstained=False)
    assert rule_confidence_threshold(output) is None


def test_rule_confidence_threshold_blocks_below_threshold() -> None:
    from enstellar_agents.guardrails.rules import rule_confidence_threshold

    output = _make_output(confidence=0.65, abstained=False)
    violation = rule_confidence_threshold(output)
    assert violation is not None
    assert "confidence_threshold" in violation


def test_rule_confidence_threshold_passes_abstained_low_confidence() -> None:
    """Abstained outputs are exempt — low confidence + abstained=True is correct behaviour."""
    from enstellar_agents.guardrails.rules import rule_confidence_threshold

    output = _make_output(confidence=0.2, abstained=True, result=None)
    assert rule_confidence_threshold(output) is None


# ──────────────────────────────────────────────
# rule_schema_validity
# ──────────────────────────────────────────────

def test_rule_schema_validity_passes_valid_output() -> None:
    from enstellar_agents.guardrails.rules import rule_schema_validity

    output = _make_output()
    assert rule_schema_validity(output) is None


# ──────────────────────────────────────────────
# rule_tenant_isolation  [INVARIANT]
# ──────────────────────────────────────────────

def test_rule_tenant_isolation_passes_matching_tenant() -> None:
    from enstellar_agents.guardrails.rules import rule_tenant_isolation

    output = _make_output(tenant_id="tenant-abc")
    assert rule_tenant_isolation(output, "tenant-abc") is None


def test_rule_tenant_isolation_blocks_mismatched_tenant() -> None:
    """INVARIANT: Cross-tenant output must be blocked. Never remove this test."""
    from enstellar_agents.guardrails.rules import rule_tenant_isolation

    output = _make_output(tenant_id="tenant-abc")
    violation = rule_tenant_isolation(output, "tenant-xyz")
    assert violation is not None
    assert "tenant_isolation" in violation


# ──────────────────────────────────────────────
# rule_phi_minimization  [INVARIANT]
# ──────────────────────────────────────────────

def test_rule_phi_minimization_passes_clean_output() -> None:
    from enstellar_agents.guardrails.rules import rule_phi_minimization

    output = _make_output(result={"gaps": [], "notes": "procedure code 27447"})
    assert rule_phi_minimization(output) is None


def test_rule_phi_minimization_blocks_ssn_pattern() -> None:
    """INVARIANT: SSN-like pattern in output must be blocked. Never remove this test."""
    from enstellar_agents.guardrails.rules import rule_phi_minimization

    output = _make_output(result={"text": "Member SSN: 123-45-6789"})
    violation = rule_phi_minimization(output)
    assert violation is not None
    assert "phi_minimization" in violation


def test_rule_phi_minimization_blocks_probable_dob() -> None:
    """INVARIANT: DOB pattern in output must be blocked. Never remove this test."""
    from enstellar_agents.guardrails.rules import rule_phi_minimization

    output = _make_output(result={"text": "Member dob: 1980-04-15"})
    violation = rule_phi_minimization(output)
    assert violation is not None
    assert "phi_minimization" in violation


# ──────────────────────────────────────────────
# rule_abstention_on_low_confidence
# ──────────────────────────────────────────────

def test_rule_abstention_passes_high_confidence_not_abstained() -> None:
    from enstellar_agents.guardrails.rules import rule_abstention_on_low_confidence

    output = _make_output(confidence=0.85, abstained=False)
    assert rule_abstention_on_low_confidence(output) is None


def test_rule_abstention_blocks_low_confidence_not_abstained() -> None:
    from enstellar_agents.guardrails.rules import rule_abstention_on_low_confidence

    output = _make_output(confidence=0.35, abstained=False)
    violation = rule_abstention_on_low_confidence(output)
    assert violation is not None
    assert "abstention_required" in violation


def test_rule_abstention_passes_low_confidence_already_abstained() -> None:
    """Low confidence + abstained=True is the correct outcome; rule must not re-fire."""
    from enstellar_agents.guardrails.rules import rule_abstention_on_low_confidence

    output = _make_output(confidence=0.1, abstained=True, result=None)
    assert rule_abstention_on_low_confidence(output) is None
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd services/agent-layer && uv run pytest tests/test_guardrails.py -v -k "rule_"
```
Expected: `ModuleNotFoundError: No module named 'enstellar_agents.guardrails'`

- [ ] **Step 3: Create `guardrails/__init__.py`**

`services/agent-layer/enstellar_agents/guardrails/__init__.py`:
```python
```
(empty)

- [ ] **Step 4: Create `guardrails/rules.py`**

`services/agent-layer/enstellar_agents/guardrails/rules.py`:
```python
"""Individual guardrail rule functions.

Each rule takes an AgentOutput (and optional extra args) and returns:
  - None   → rule passed
  - str    → rule failed; the string is a human-readable violation message

Rules are called by GuardrailEngine.check(); do not call them directly in
application code.

INVARIANT RULES (never weaken or remove):
  - rule_no_autonomous_adverse
  - rule_tenant_isolation
  - rule_phi_minimization
"""
from __future__ import annotations

import re

from enstellar_agents.models import AgentOutput

ADVERSE_KEYWORDS: frozenset[str] = frozenset(
    [
        "denied",
        "deny",
        "denial",
        "adverse",
        "not medically necessary",
        "experimental",
        "investigational",
    ]
)


def rule_no_autonomous_adverse(output: AgentOutput) -> str | None:
    """INVARIANT: Agent output must never contain adverse-determination language.

    Any match blocks the output regardless of other fields.
    """
    text = str(output.result or "").lower()
    for kw in ADVERSE_KEYWORDS:
        if kw in text:
            return f"no_autonomous_adverse: found '{kw}' in output"
    return None


def rule_citations_required(output: AgentOutput) -> str | None:
    """Non-abstained output must cite at least one source."""
    if not output.abstained and not output.citations:
        return "citations_required: non-abstained output has no citations"
    return None


def rule_confidence_threshold(output: AgentOutput, threshold: float = 0.7) -> str | None:
    """Non-abstained output must meet the minimum confidence threshold."""
    if not output.abstained and output.confidence < threshold:
        return f"confidence_threshold: {output.confidence:.2f} < {threshold}"
    return None


def rule_schema_validity(output: AgentOutput) -> str | None:
    """Output must be re-parseable from its own serialization."""
    try:
        AgentOutput.model_validate(output.model_dump())
        return None
    except Exception as exc:
        return f"schema_validity: {exc}"


def rule_tenant_isolation(output: AgentOutput, expected_tenant_id: str) -> str | None:
    """INVARIANT: Output tenant_id must match the request tenant_id (no cross-tenant leakage)."""
    if output.tenant_id != expected_tenant_id:
        return "tenant_isolation: output tenant_id mismatch"
    return None


def rule_phi_minimization(output: AgentOutput) -> str | None:
    """INVARIANT: Heuristic check — reject output containing SSN or DOB patterns."""
    text = str(output.result or "")
    if re.search(r"\b\d{3}-\d{2}-\d{4}\b", text):
        return "phi_minimization: SSN-like pattern in output"
    if re.search(r"\b\d{4}-\d{2}-\d{2}\b", text) and "dob" in text.lower():
        return "phi_minimization: probable DOB in output"
    return None


def rule_abstention_on_low_confidence(output: AgentOutput, threshold: float = 0.4) -> str | None:
    """Output with confidence below the abstention threshold must have abstained=True."""
    if output.confidence < threshold and not output.abstained:
        return (
            f"abstention_required: confidence {output.confidence:.2f} < {threshold},"
            " output must set abstained=True"
        )
    return None
```

- [ ] **Step 5: Run the rule tests to confirm they pass**

```bash
cd services/agent-layer && uv run pytest tests/test_guardrails.py -v -k "rule_"
```
Expected: All 17 rule tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/agent-layer/enstellar_agents/guardrails/ services/agent-layer/tests/test_guardrails.py
git commit -m "feat(agent-layer): add 7 guardrail rule functions with passing/failing parametrized tests"
```

---

## Task 4: GuardrailEngine

**Files:**
- Create: `services/agent-layer/enstellar_agents/guardrails/engine.py`
- Modify: `services/agent-layer/enstellar_agents/guardrails/__init__.py`
- Extend: `services/agent-layer/tests/test_guardrails.py` (add engine tests at the bottom)

- [ ] **Step 1: Write the failing engine tests (append to test_guardrails.py)**

Append to the bottom of `services/agent-layer/tests/test_guardrails.py`:
```python
# ──────────────────────────────────────────────
# GuardrailEngine integration tests
# ──────────────────────────────────────────────

def test_engine_passes_clean_output() -> None:
    from enstellar_agents.guardrails.engine import GuardrailEngine

    output = _make_output(
        tenant_id="tenant-abc",
        confidence=0.85,
        citations=["CriteriaCorp SR-2024"],
        abstained=False,
        result={"gaps": [], "rfi_draft": {"body": "Please provide the operative report."}},
    )
    result = GuardrailEngine().check(output, "tenant-abc")
    assert result.passed is True
    assert result.violations == []


def test_engine_blocks_adverse_keyword() -> None:
    """INVARIANT: GuardrailEngine must block adverse language. Never remove this test."""
    from enstellar_agents.guardrails.engine import GuardrailEngine

    output = _make_output(
        result={"gaps": [], "rfi_draft": {"body": "The claim is denied."}},
        citations=["CriteriaCorp SR-2024"],
        confidence=0.85,
    )
    result = GuardrailEngine().check(output, "tenant-abc")
    assert result.passed is False
    assert any("no_autonomous_adverse" in v for v in result.violations)


def test_engine_blocks_missing_citations() -> None:
    from enstellar_agents.guardrails.engine import GuardrailEngine

    output = _make_output(citations=[], abstained=False, confidence=0.85)
    result = GuardrailEngine().check(output, "tenant-abc")
    assert result.passed is False
    assert any("citations_required" in v for v in result.violations)


def test_engine_blocks_low_confidence_non_abstained() -> None:
    from enstellar_agents.guardrails.engine import GuardrailEngine

    # confidence=0.65 is below the 0.7 threshold but above the 0.4 abstention threshold
    output = _make_output(confidence=0.65, abstained=False, citations=["SR-2024"])
    result = GuardrailEngine().check(output, "tenant-abc")
    assert result.passed is False
    assert any("confidence_threshold" in v for v in result.violations)


def test_engine_collects_multiple_violations() -> None:
    from enstellar_agents.guardrails.engine import GuardrailEngine

    output = _make_output(
        confidence=0.65,
        citations=[],   # triggers citations_required AND confidence_threshold
        abstained=False,
    )
    result = GuardrailEngine().check(output, "tenant-abc")
    assert result.passed is False
    assert len(result.violations) >= 2


def test_engine_passes_abstained_output_with_no_citations() -> None:
    """Abstained outputs are always advisory-safe: citations and confidence checks are skipped."""
    from enstellar_agents.guardrails.engine import GuardrailEngine

    output = _make_output(
        abstained=True,
        abstention_reason="low confidence",
        result=None,
        citations=[],
        confidence=0.1,
    )
    result = GuardrailEngine().check(output, "tenant-abc")
    # abstained output with no adverse content, correct tenant → must pass
    assert result.passed is True
```

- [ ] **Step 2: Run to confirm new engine tests fail**

```bash
cd services/agent-layer && uv run pytest tests/test_guardrails.py -v -k "engine"
```
Expected: `ModuleNotFoundError: No module named 'enstellar_agents.guardrails.engine'`

- [ ] **Step 3: Create `guardrails/engine.py`**

`services/agent-layer/enstellar_agents/guardrails/engine.py`:
```python
"""GuardrailEngine — runs all 7 rules and returns a GuardrailResult.

Import pattern:
    from enstellar_agents.guardrails import GuardrailEngine
"""
from __future__ import annotations

from enstellar_agents.guardrails.rules import (
    rule_abstention_on_low_confidence,
    rule_citations_required,
    rule_confidence_threshold,
    rule_no_autonomous_adverse,
    rule_phi_minimization,
    rule_schema_validity,
    rule_tenant_isolation,
)
from enstellar_agents.models import AgentOutput, GuardrailResult


class GuardrailEngine:
    """Stateless engine that evaluates all guardrail rules against an AgentOutput.

    Usage::
        result = GuardrailEngine().check(output, expected_tenant_id="tenant-abc")
        if not result.passed:
            # output must not be returned to the caller
    """

    def check(self, output: AgentOutput, expected_tenant_id: str) -> GuardrailResult:
        """Run all 7 rules; return GuardrailResult with passed=False if any rule fires."""
        violations = [
            v
            for v in [
                rule_no_autonomous_adverse(output),
                rule_citations_required(output),
                rule_confidence_threshold(output),
                rule_schema_validity(output),
                rule_tenant_isolation(output, expected_tenant_id),
                rule_phi_minimization(output),
                rule_abstention_on_low_confidence(output),
            ]
            if v is not None
        ]
        return GuardrailResult(passed=len(violations) == 0, violations=violations)
```

- [ ] **Step 4: Update `guardrails/__init__.py` to re-export**

`services/agent-layer/enstellar_agents/guardrails/__init__.py`:
```python
"""Guardrail engine and rule functions."""
from enstellar_agents.guardrails.engine import GuardrailEngine
from enstellar_agents.models import GuardrailResult

__all__ = ["GuardrailEngine", "GuardrailResult"]
```

- [ ] **Step 5: Run all guardrail tests to confirm they pass**

```bash
cd services/agent-layer && uv run pytest tests/test_guardrails.py -v
```
Expected: All tests pass (17 rule tests + 6 engine tests = 23 total).

- [ ] **Step 6: Commit**

```bash
git add services/agent-layer/enstellar_agents/guardrails/ services/agent-layer/tests/test_guardrails.py
git commit -m "feat(agent-layer): add GuardrailEngine wiring all 7 rules — adverse block is invariant-tested"
```

---

## Task 5: ModelAdapter ABC + OllamaAdapter + factory

**Files:**
- Create: `services/agent-layer/enstellar_agents/model_access/__init__.py`
- Create: `services/agent-layer/enstellar_agents/model_access/base.py`
- Create: `services/agent-layer/enstellar_agents/model_access/ollama_adapter.py`
- Create: `services/agent-layer/enstellar_agents/model_access/factory.py`
- Create: `services/agent-layer/tests/test_adapters.py`

- [ ] **Step 1: Write the failing tests**

`services/agent-layer/tests/test_adapters.py`:
```python
"""Tests for ModelAdapter ABC, OllamaAdapter (respx mock), AnthropicAdapter, and factory."""
from __future__ import annotations

import pytest
import respx
import httpx
from unittest.mock import AsyncMock, MagicMock, patch


# ──────────────────────────────────────────────
# OllamaAdapter
# ──────────────────────────────────────────────

@respx.mock
async def test_ollama_adapter_complete_success() -> None:
    from enstellar_agents.model_access.ollama_adapter import OllamaAdapter

    respx.post("http://test-ollama:11434/api/generate").mock(
        return_value=httpx.Response(200, json={"response": "Gap analysis result here."})
    )
    adapter = OllamaAdapter(base_url="http://test-ollama:11434", model="llama3")
    result = await adapter.complete("system prompt", "user message")
    assert result == "Gap analysis result here."


@respx.mock
async def test_ollama_adapter_raises_on_http_error() -> None:
    from enstellar_agents.model_access.ollama_adapter import OllamaAdapter

    respx.post("http://test-ollama:11434/api/generate").mock(
        return_value=httpx.Response(500, text="Internal Server Error")
    )
    adapter = OllamaAdapter(base_url="http://test-ollama:11434", model="llama3")
    with pytest.raises(httpx.HTTPStatusError):
        await adapter.complete("system", "user message")


def test_ollama_adapter_model_name() -> None:
    from enstellar_agents.model_access.ollama_adapter import OllamaAdapter

    adapter = OllamaAdapter(base_url="http://ollama:11434", model="llama3")
    assert adapter.model_name() == "llama3"


# ──────────────────────────────────────────────
# factory
# ──────────────────────────────────────────────

def test_factory_returns_ollama_adapter(monkeypatch) -> None:
    from enstellar_agents.config import AgentSettings
    from enstellar_agents.model_access.factory import get_adapter
    from enstellar_agents.model_access.ollama_adapter import OllamaAdapter

    monkeypatch.setenv("ENSTELLAR_MODEL_PROVIDER", "ollama")
    monkeypatch.setenv("ENSTELLAR_MODEL_NAME", "llama3")
    settings = AgentSettings()
    adapter = get_adapter(settings)
    assert isinstance(adapter, OllamaAdapter)
    assert adapter.model_name() == "llama3"


def test_factory_raises_on_unknown_provider() -> None:
    from enstellar_agents.config import AgentSettings
    from enstellar_agents.model_access.factory import get_adapter

    # model_construct bypasses validators so we can inject "unknown"
    settings = AgentSettings.model_construct(
        model_provider="unknown",
        model_name="test",
        anthropic_api_key=None,
        ollama_base_url="http://localhost:11434",
    )
    with pytest.raises(ValueError, match="Unknown model_provider"):
        get_adapter(settings)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd services/agent-layer && uv run pytest tests/test_adapters.py -v -k "ollama or factory"
```
Expected: `ModuleNotFoundError: No module named 'enstellar_agents.model_access'`

- [ ] **Step 3: Create `model_access/__init__.py`**

`services/agent-layer/enstellar_agents/model_access/__init__.py`:
```python
"""Model-access layer — adapters for Anthropic (commercial) and Ollama (local dev)."""
from enstellar_agents.model_access.base import ModelAdapter
from enstellar_agents.model_access.factory import get_adapter

__all__ = ["ModelAdapter", "get_adapter"]
```

- [ ] **Step 4: Create `model_access/base.py`**

`services/agent-layer/enstellar_agents/model_access/base.py`:
```python
"""Abstract base class for all model adapters."""
from __future__ import annotations

from abc import ABC, abstractmethod


class ModelAdapter(ABC):
    """Thin interface that all model backends must implement.

    Implementations must be async-safe and stateless (no request-scoped state).
    """

    @abstractmethod
    async def complete(self, system_prompt: str, user_message: str) -> str:
        """Send a prompt to the model and return the response text.

        Args:
            system_prompt: Task instructions. Must not contain PHI.
            user_message:  Case-specific input. Must contain only PHI-minimized fields.

        Returns:
            Raw string response from the model — caller is responsible for parsing.
        """

    @abstractmethod
    def model_name(self) -> str:
        """Return the canonical model identifier (used in provenance records)."""
```

- [ ] **Step 5: Create `model_access/ollama_adapter.py`**

`services/agent-layer/enstellar_agents/model_access/ollama_adapter.py`:
```python
"""OllamaAdapter — calls a local Ollama server via HTTP.

Used in local development and boundary deployments where the commercial API is
not available. Configured by ENSTELLAR_OLLAMA_BASE_URL and ENSTELLAR_MODEL_NAME.
"""
from __future__ import annotations

import httpx

from enstellar_agents.model_access.base import ModelAdapter


class OllamaAdapter(ModelAdapter):
    def __init__(
        self,
        base_url: str = "http://ollama:11434",
        model: str = "llama3",
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model

    async def complete(self, system_prompt: str, user_message: str) -> str:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self._base_url}/api/generate",
                json={
                    "model": self._model,
                    "prompt": f"{system_prompt}\n\n{user_message}",
                    "stream": False,
                },
                timeout=60.0,
            )
            r.raise_for_status()
            return r.json()["response"]

    def model_name(self) -> str:
        return self._model
```

- [ ] **Step 6: Create `model_access/factory.py`**

`services/agent-layer/enstellar_agents/model_access/factory.py`:
```python
"""Factory function to select the correct ModelAdapter from settings."""
from __future__ import annotations

from enstellar_agents.config import AgentSettings
from enstellar_agents.model_access.base import ModelAdapter


def get_adapter(settings: AgentSettings) -> ModelAdapter:
    """Return the configured ModelAdapter.

    Raises:
        ValueError: If ENSTELLAR_MODEL_PROVIDER is not "anthropic" or "ollama".
    """
    if settings.model_provider == "anthropic":
        from enstellar_agents.model_access.anthropic_adapter import AnthropicAdapter

        return AnthropicAdapter(
            api_key=settings.anthropic_api_key,  # type: ignore[arg-type]
            model=settings.model_name,
        )
    if settings.model_provider == "ollama":
        from enstellar_agents.model_access.ollama_adapter import OllamaAdapter

        return OllamaAdapter(base_url=settings.ollama_base_url, model=settings.model_name)
    raise ValueError(
        f"Unknown model_provider: {settings.model_provider!r}."
        " Must be 'anthropic' or 'ollama'."
    )
```

- [ ] **Step 7: Run the OllamaAdapter and factory tests**

```bash
cd services/agent-layer && uv run pytest tests/test_adapters.py -v -k "ollama or factory"
```
Expected: 4 tests pass.

- [ ] **Step 8: Commit**

```bash
git add services/agent-layer/enstellar_agents/model_access/ services/agent-layer/tests/test_adapters.py
git commit -m "feat(agent-layer): add ModelAdapter ABC, OllamaAdapter, and get_adapter factory"
```

---

## Task 6: AnthropicAdapter

**Files:**
- Create: `services/agent-layer/enstellar_agents/model_access/anthropic_adapter.py`
- Extend: `services/agent-layer/tests/test_adapters.py` (append Anthropic tests)

- [ ] **Step 1: Append the failing Anthropic tests to `test_adapters.py`**

Append to the bottom of `services/agent-layer/tests/test_adapters.py`:
```python
# ──────────────────────────────────────────────
# AnthropicAdapter
# ──────────────────────────────────────────────

async def test_anthropic_adapter_complete_success() -> None:
    from enstellar_agents.model_access.anthropic_adapter import AnthropicAdapter

    # Build the mock return value — AsyncAnthropic.messages.create returns a Message
    mock_text_block = MagicMock()
    mock_text_block.text = "Here are the identified documentation gaps."
    mock_message = MagicMock()
    mock_message.content = [mock_text_block]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_message)

    with patch(
        "enstellar_agents.model_access.anthropic_adapter.anthropic.AsyncAnthropic",
        return_value=mock_client,
    ):
        adapter = AnthropicAdapter(api_key="test-key-001", model="claude-opus-4-8")
        result = await adapter.complete("system prompt", "user message")

    assert result == "Here are the identified documentation gaps."
    mock_client.messages.create.assert_called_once_with(
        model="claude-opus-4-8",
        max_tokens=2048,
        system="system prompt",
        messages=[{"role": "user", "content": "user message"}],
    )


def test_anthropic_adapter_model_name() -> None:
    from enstellar_agents.model_access.anthropic_adapter import AnthropicAdapter

    with patch("enstellar_agents.model_access.anthropic_adapter.anthropic.AsyncAnthropic"):
        adapter = AnthropicAdapter(api_key="test-key-001", model="claude-opus-4-8")
    assert adapter.model_name() == "claude-opus-4-8"


def test_factory_returns_anthropic_adapter(monkeypatch) -> None:
    from enstellar_agents.config import AgentSettings
    from enstellar_agents.model_access.anthropic_adapter import AnthropicAdapter
    from enstellar_agents.model_access.factory import get_adapter

    monkeypatch.setenv("ENSTELLAR_MODEL_PROVIDER", "anthropic")
    monkeypatch.setenv("ENSTELLAR_MODEL_NAME", "claude-opus-4-8")
    monkeypatch.setenv("ENSTELLAR_ANTHROPIC_API_KEY", "test-key-001")

    with patch("enstellar_agents.model_access.anthropic_adapter.anthropic.AsyncAnthropic"):
        settings = AgentSettings()
        adapter = get_adapter(settings)

    assert isinstance(adapter, AnthropicAdapter)
    assert adapter.model_name() == "claude-opus-4-8"
```

- [ ] **Step 2: Run to confirm the Anthropic tests fail**

```bash
cd services/agent-layer && uv run pytest tests/test_adapters.py -v -k "anthropic"
```
Expected: `ModuleNotFoundError: No module named 'enstellar_agents.model_access.anthropic_adapter'`

- [ ] **Step 3: Create `model_access/anthropic_adapter.py`**

`services/agent-layer/enstellar_agents/model_access/anthropic_adapter.py`:
```python
"""AnthropicAdapter — wraps anthropic.AsyncAnthropic for commercial model access.

Selected when ENSTELLAR_MODEL_PROVIDER=anthropic.
Requires ENSTELLAR_ANTHROPIC_API_KEY to be set.
"""
from __future__ import annotations

import anthropic

from enstellar_agents.model_access.base import ModelAdapter


class AnthropicAdapter(ModelAdapter):
    def __init__(self, api_key: str, model: str = "claude-opus-4-8") -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model

    async def complete(self, system_prompt: str, user_message: str) -> str:
        msg = await self._client.messages.create(
            model=self._model,
            max_tokens=2048,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )
        return msg.content[0].text

    def model_name(self) -> str:
        return self._model
```

- [ ] **Step 4: Run all adapter tests**

```bash
cd services/agent-layer && uv run pytest tests/test_adapters.py -v
```
Expected: All 7 adapter tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/agent-layer/enstellar_agents/model_access/anthropic_adapter.py services/agent-layer/tests/test_adapters.py
git commit -m "feat(agent-layer): add AnthropicAdapter wrapping AsyncAnthropic"
```

---

## Task 7: CompletenessAgent (LangGraph typed graph)

**Files:**
- Create: `services/agent-layer/enstellar_agents/agents/__init__.py`
- Create: `services/agent-layer/enstellar_agents/agents/completeness.py`
- Create: `services/agent-layer/tests/test_completeness_agent.py`

- [ ] **Step 1: Write the failing tests**

`services/agent-layer/tests/test_completeness_agent.py`:
```python
"""Tests for the CompletenessAgent LangGraph graph.

Key invariants tested here:
- GuardrailEngine runs on EVERY output (never skipped)
- Adverse keyword in output causes guardrail to block
- Parse errors and low-confidence outputs cause abstention (not errors)
"""
from __future__ import annotations

import json
import pytest
from uuid import uuid4

# Import shared fixtures and constants from conftest
from tests.conftest import (
    ADVERSE_RESPONSE,
    INVALID_JSON_RESPONSE,
    LOW_CONFIDENCE_RESPONSE,
    VALID_RESPONSE,
    MockAdapter,
)


def _make_input(tenant_id: str = "tenant-abc") -> dict:
    return {
        "tenant_id": tenant_id,
        "case_id": uuid4(),
        "case_summary": {
            "procedure_code": "27447",
            "diagnosis_codes": ["M17.11"],
            "urgency": "standard",
            "lob": "commercial",
        },
        "doc_requirements": ["operative_report", "clinical_notes"],
        "correlation_id": "corr-test-001",
    }


async def test_completeness_valid_json_produces_non_abstained_output() -> None:
    """Happy path: valid high-confidence JSON → non-abstained AgentOutput, guardrail passes."""
    from enstellar_agents.agents.completeness import build_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(VALID_RESPONSE)
    graph = build_graph(adapter)
    inp = AgentInput.model_validate(_make_input())

    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    output = final["agent_output"]
    guardrail = final["guardrail_result"]

    assert output.abstained is False
    assert output.confidence == 0.85
    assert output.citations == ["CriteriaCorp SR-2024"]
    assert output.result is not None
    assert guardrail.passed is True
    assert guardrail.violations == []
    # Provenance is recorded
    assert output.provenance["model_name"] == "test-model"
    assert "input_hash" in output.provenance
    assert "timestamp" in output.provenance


async def test_completeness_invalid_json_produces_abstained_output() -> None:
    """Invalid model response → parse error → abstained=True, result=None."""
    from enstellar_agents.agents.completeness import build_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(INVALID_JSON_RESPONSE)
    graph = build_graph(adapter)
    inp = AgentInput.model_validate(_make_input())

    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    output = final["agent_output"]
    assert output.abstained is True
    assert output.result is None
    assert output.abstention_reason is not None
    assert "parse_error" in output.abstention_reason


async def test_completeness_low_confidence_produces_abstained_output() -> None:
    """Confidence < 0.4 → abstained=True (correct behaviour, not a bug)."""
    from enstellar_agents.agents.completeness import build_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(LOW_CONFIDENCE_RESPONSE)
    graph = build_graph(adapter)
    inp = AgentInput.model_validate(_make_input())

    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    output = final["agent_output"]
    assert output.abstained is True
    assert output.confidence == 0.3
    assert output.result is None


async def test_completeness_adverse_output_guardrail_fires() -> None:
    """INVARIANT: Adverse keyword in agent result → GuardrailEngine passes=False."""
    from enstellar_agents.agents.completeness import build_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(ADVERSE_RESPONSE)
    graph = build_graph(adapter)
    inp = AgentInput.model_validate(_make_input())

    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    guardrail = final["guardrail_result"]
    assert guardrail.passed is False
    assert any("no_autonomous_adverse" in v for v in guardrail.violations)


async def test_guardrail_result_always_present_in_final_state() -> None:
    """INVARIANT: guardrail_result must be populated for every graph execution."""
    from enstellar_agents.agents.completeness import build_graph
    from enstellar_agents.models import AgentInput

    for response in [VALID_RESPONSE, INVALID_JSON_RESPONSE, LOW_CONFIDENCE_RESPONSE, ADVERSE_RESPONSE]:
        adapter = MockAdapter(response)
        graph = build_graph(adapter)
        inp = AgentInput.model_validate(_make_input())

        final = await graph.ainvoke(
            {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
        )

        assert final["guardrail_result"] is not None, (
            f"guardrail_result was None for response: {response[:40]}"
        )


async def test_completeness_tenant_id_propagated_to_output() -> None:
    """tenant_id from AgentInput must match AgentOutput.tenant_id (invariant #5)."""
    from enstellar_agents.agents.completeness import build_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(VALID_RESPONSE)
    graph = build_graph(adapter)
    inp = AgentInput.model_validate(_make_input(tenant_id="tenant-xyz"))

    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    assert final["agent_output"].tenant_id == "tenant-xyz"
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd services/agent-layer && uv run pytest tests/test_completeness_agent.py -v
```
Expected: `ModuleNotFoundError: No module named 'enstellar_agents.agents'`

- [ ] **Step 3: Create `agents/__init__.py`**

`services/agent-layer/enstellar_agents/agents/__init__.py`:
```python
```
(empty)

- [ ] **Step 4: Create `agents/completeness.py`**

`services/agent-layer/enstellar_agents/agents/completeness.py`:
```python
"""CompletenessAgent — LangGraph typed graph for documentation gap detection.

Graph topology:
  call_model → parse_output → run_guardrails → END

The graph is advisory only:
  - It produces AgentOutput with confidence, citations, abstained flag, and provenance.
  - It NEVER writes to the workflow-engine or emits state-transition events.
  - GuardrailEngine runs unconditionally on every output.

PHI contract:
  - Only AgentInput.case_summary reaches the model — a pre-minimized dict.
  - Raw Case fields (member name, DOB, SSN, address) must not appear in case_summary.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import TypedDict

from langgraph.graph import END, StateGraph

from enstellar_agents.guardrails.engine import GuardrailEngine
from enstellar_agents.model_access.base import ModelAdapter
from enstellar_agents.models import AgentInput, AgentOutput, GuardrailResult

SYSTEM_PROMPT = (
    "You are a clinical documentation completeness reviewer. "
    "Your job: identify gaps between submitted documentation and the required documents listed. "
    "You MUST NOT render a coverage determination or use denial/adverse language. "
    "Respond ONLY as valid JSON with this exact structure:\n"
    '{"gaps": [{"description": "...", "required_document_type": "...", "citation": "..."}], '
    '"rfi_draft": {"subject": "...", "body": "...", "required_documents": ["..."], "due_date_days": 14}, '
    '"confidence": 0.0, "citations": ["..."]}\n'
    "confidence must be a float between 0.0 and 1.0. "
    "citations must reference specific clinical criteria or document guidelines."
)


class CompletenessState(TypedDict):
    inp: AgentInput
    raw_output: str
    agent_output: AgentOutput | None
    guardrail_result: GuardrailResult | None


def build_graph(adapter: ModelAdapter):
    """Compile a LangGraph StateGraph for the completeness agent.

    Args:
        adapter: The ModelAdapter to use for inference. Created by get_adapter(settings).

    Returns:
        A compiled LangGraph graph — call ``await graph.ainvoke(state)`` to run it.
    """

    async def _call_model(state: CompletenessState) -> CompletenessState:
        inp = state["inp"]
        user_msg = (
            f"Case summary: {json.dumps(inp.case_summary)}\n"
            f"Required document types: {', '.join(inp.doc_requirements)}"
        )
        raw = await adapter.complete(SYSTEM_PROMPT, user_msg)
        return {**state, "raw_output": raw}

    def _parse_output(state: CompletenessState) -> CompletenessState:
        inp = state["inp"]
        try:
            parsed = json.loads(state["raw_output"])
            confidence = float(parsed.get("confidence", 0.0))
            citations = list(parsed.get("citations", []))
            abstained = confidence < 0.4
            output = AgentOutput(
                agent_id="completeness-v1",
                tenant_id=inp.tenant_id,
                case_id=inp.case_id,
                confidence=confidence,
                citations=citations,
                abstained=abstained,
                abstention_reason="low confidence" if abstained else None,
                result=parsed if not abstained else None,
                provenance={
                    "model_name": adapter.model_name(),
                    "input_hash": hashlib.sha256(
                        json.dumps(inp.case_summary, sort_keys=True).encode()
                    ).hexdigest()[:16],
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception as exc:  # noqa: BLE001
            output = AgentOutput(
                agent_id="completeness-v1",
                tenant_id=inp.tenant_id,
                case_id=inp.case_id,
                confidence=0.0,
                citations=[],
                abstained=True,
                abstention_reason=f"parse_error: {exc}",
                result=None,
                provenance={
                    "model_name": adapter.model_name(),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        return {**state, "agent_output": output}

    def _run_guardrails(state: CompletenessState) -> CompletenessState:
        engine = GuardrailEngine()
        result = engine.check(state["agent_output"], state["inp"].tenant_id)
        return {**state, "guardrail_result": result}

    g = StateGraph(CompletenessState)
    g.add_node("call_model", _call_model)
    g.add_node("parse_output", _parse_output)
    g.add_node("run_guardrails", _run_guardrails)
    g.set_entry_point("call_model")
    g.add_edge("call_model", "parse_output")
    g.add_edge("parse_output", "run_guardrails")
    g.add_edge("run_guardrails", END)
    return g.compile()
```

- [ ] **Step 5: Run the agent tests**

```bash
cd services/agent-layer && uv run pytest tests/test_completeness_agent.py -v
```
Expected: All 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/agent-layer/enstellar_agents/agents/ services/agent-layer/tests/test_completeness_agent.py
git commit -m "feat(agent-layer): add CompletenessAgent LangGraph graph — guardrail runs unconditionally on every output"
```

---

## Task 8: `POST /assist/completeness` router + evals + CI

**Files:**
- Create: `services/agent-layer/enstellar_agents/routers/__init__.py`
- Create: `services/agent-layer/enstellar_agents/routers/assist.py`
- Modify: `services/agent-layer/enstellar_agents/main.py`
- Create: `services/agent-layer/tests/test_assist_router.py`
- Create: `services/agent-layer/evals/__init__.py`
- Create: `services/agent-layer/evals/test_completeness_eval.py`
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing router tests**

`services/agent-layer/tests/test_assist_router.py`:
```python
"""Integration tests for POST /assist/completeness via ASGI transport.

Uses monkeypatch to replace get_adapter so no real model calls are made.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from uuid import uuid4

from tests.conftest import VALID_RESPONSE, ADVERSE_RESPONSE, MockAdapter


def _input_payload(tenant_id: str = "tenant-abc") -> dict:
    return {
        "tenant_id": tenant_id,
        "case_id": str(uuid4()),
        "case_summary": {
            "procedure_code": "27447",
            "diagnosis_codes": ["M17.11"],
            "urgency": "standard",
            "lob": "commercial",
        },
        "doc_requirements": ["operative_report", "clinical_notes"],
        "correlation_id": "corr-router-001",
    }


async def test_post_completeness_success(monkeypatch) -> None:
    """Happy path: mocked adapter returns valid JSON → 200 with non-abstained AgentOutput."""
    mock_adapter = MockAdapter(VALID_RESPONSE)
    monkeypatch.setattr("enstellar_agents.routers.assist.get_adapter", lambda _: mock_adapter)

    from enstellar_agents.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/assist/completeness", json=_input_payload())

    assert r.status_code == 200
    body = r.json()
    assert body["abstained"] is False
    assert body["confidence"] == 0.85
    assert body["citations"] == ["CriteriaCorp SR-2024"]
    assert body["result"] is not None
    assert body["tenant_id"] == "tenant-abc"


async def test_post_completeness_adverse_output_returns_abstained(monkeypatch) -> None:
    """INVARIANT: Adverse content in agent result → response is abstained=True, result=None.

    The router must NEVER pass guardrail-failed output to the caller.
    """
    mock_adapter = MockAdapter(ADVERSE_RESPONSE)
    monkeypatch.setattr("enstellar_agents.routers.assist.get_adapter", lambda _: mock_adapter)

    from enstellar_agents.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/assist/completeness", json=_input_payload())

    assert r.status_code == 200
    body = r.json()
    assert body["abstained"] is True
    assert body["result"] is None
    assert body["abstention_reason"] is not None
    assert "no_autonomous_adverse" in body["abstention_reason"]


async def test_post_completeness_missing_tenant_id_returns_422() -> None:
    """Pydantic validation: missing required field → 422 Unprocessable Entity."""
    from enstellar_agents.main import app

    payload = _input_payload()
    del payload["tenant_id"]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/assist/completeness", json=payload)

    assert r.status_code == 422


async def test_post_completeness_empty_tenant_id_returns_422() -> None:
    """Empty string tenant_id violates min_length=1 → 422."""
    from enstellar_agents.main import app

    payload = _input_payload()
    payload["tenant_id"] = ""

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/assist/completeness", json=payload)

    assert r.status_code == 422
```

- [ ] **Step 2: Run to confirm the router tests fail**

```bash
cd services/agent-layer && uv run pytest tests/test_assist_router.py -v
```
Expected: `ModuleNotFoundError: No module named 'enstellar_agents.routers'` or 404 from FastAPI.

- [ ] **Step 3: Create `routers/__init__.py`**

`services/agent-layer/enstellar_agents/routers/__init__.py`:
```python
```
(empty)

- [ ] **Step 4: Create `routers/assist.py`**

`services/agent-layer/enstellar_agents/routers/assist.py`:
```python
"""FastAPI router for agent-assist endpoints.

POST /assist/completeness — Completeness & RFI assist agent.

This endpoint is advisory only. It NEVER writes to the workflow-engine.
All agent outputs pass through GuardrailEngine before being returned.
If the guardrail blocks the output, the response has abstained=True and result=None.
"""
from __future__ import annotations

from fastapi import APIRouter

from enstellar_agents.agents.completeness import build_graph
from enstellar_agents.config import get_settings
from enstellar_agents.model_access.factory import get_adapter
from enstellar_agents.models import AgentInput, AgentOutput, GuardrailResult

router = APIRouter()


@router.post("/assist/completeness")
async def completeness_assist(body: AgentInput) -> AgentOutput:
    """Run the CompletenessAgent and return a guardrail-checked AgentOutput.

    The caller (BFF or workflow-engine) must treat the response as advisory.
    If ``abstained=True``, the agent could not produce a usable recommendation.
    The caller must not use ``result`` to make a coverage determination.
    """
    adapter = get_adapter(get_settings())
    graph = build_graph(adapter)
    final = await graph.ainvoke(
        {"inp": body, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )
    gr: GuardrailResult = final["guardrail_result"]
    output: AgentOutput = final["agent_output"]

    if not gr.passed:
        # Guardrail fired — scrub the result and surface the violation reasons.
        output = output.model_copy(
            update={
                "abstained": True,
                "abstention_reason": "; ".join(gr.violations),
                "result": None,
            }
        )
    return output
```

- [ ] **Step 5: Update `main.py` to include the assist router**

Modify `services/agent-layer/enstellar_agents/main.py` — add the router import and `include_router` call:
```python
"""Enstellar Agent Layer — FastAPI application entry point.

Start with:
    uvicorn enstellar_agents.main:app --host 0.0.0.0 --port 8001 --reload
"""
from __future__ import annotations

import logging
import sys

from fastapi import FastAPI

from enstellar_agents.routers.assist import router as assist_router

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": "%(message)s"}',
)

app = FastAPI(
    title="Enstellar Agent Layer",
    version="0.1.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.include_router(assist_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 6: Run all tests to confirm everything still passes**

```bash
cd services/agent-layer && uv run pytest tests/ -v
```
Expected: All tests pass (healthz, models, guardrails, adapters, completeness agent, router).

- [ ] **Step 7: Write the failing eval tests**

`services/agent-layer/evals/__init__.py`:
```python
```
(empty)

`services/agent-layer/evals/test_completeness_eval.py`:
```python
"""Eval harness for the CompletenessAgent.

These are deterministic metric tests using controlled mock adapters.
No real model calls are made. Metrics are computed over N=5 synthetic cases.

Required pass thresholds (from T14 DoD):
  - Groundedness         ≥ 0.8   (fraction of output gaps that have ≥1 citation)
  - Gap-detection precision ≥ 0.75 (detected_required_types ∩ expected / detected)
  - Abstention rate      ≥ 0.6   (ambiguous inputs where agent correctly abstains)
"""
from __future__ import annotations

import json
from uuid import uuid4


# ──────────────────────────────────────────────
# Synthetic eval adapters
# ──────────────────────────────────────────────

class _GroundedAdapter:
    """Returns well-cited gaps for each required document type in the input."""

    async def complete(self, system_prompt: str, user_message: str) -> str:  # noqa: ARG002
        # Parse the required doc types from the user message so gaps exactly match input
        doc_types = ["operative_report", "clinical_notes", "imaging_report"]
        return json.dumps(
            {
                "gaps": [
                    {
                        "description": f"Missing {dt}",
                        "required_document_type": dt,
                        "citation": f"CriteriaCorp/{dt}/v2024",
                    }
                    for dt in doc_types
                ],
                "rfi_draft": {
                    "subject": "Documentation Request",
                    "body": "Please provide the requested clinical documents.",
                    "required_documents": doc_types,
                    "due_date_days": 14,
                },
                "confidence": 0.88,
                "citations": [f"CriteriaCorp/{dt}/v2024" for dt in doc_types],
            }
        )

    def model_name(self) -> str:
        return "eval-grounded"


class _AmbiguousAdapter:
    """Returns confidence=0.3 for any input — simulates an ambiguous/underspecified case."""

    async def complete(self, system_prompt: str, user_message: str) -> str:  # noqa: ARG002
        return json.dumps(
            {
                "gaps": [],
                "rfi_draft": {
                    "subject": "",
                    "body": "",
                    "required_documents": [],
                    "due_date_days": 14,
                },
                "confidence": 0.3,
                "citations": [],
            }
        )

    def model_name(self) -> str:
        return "eval-ambiguous"


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _make_eval_input(doc_requirements: list[str], tenant_id: str = "tenant-eval"):
    from enstellar_agents.models import AgentInput

    return AgentInput.model_validate(
        {
            "tenant_id": tenant_id,
            "case_id": str(uuid4()),
            "case_summary": {
                "procedure_code": "27447",
                "diagnosis_codes": ["M17.11"],
                "urgency": "standard",
                "lob": "commercial",
            },
            "doc_requirements": doc_requirements,
            "correlation_id": f"eval-{uuid4().hex[:8]}",
        }
    )


async def _run_once(adapter, doc_requirements: list[str]) -> dict:
    """Run the graph once and return the final state dict."""
    from enstellar_agents.agents.completeness import build_graph

    graph = build_graph(adapter)
    inp = _make_eval_input(doc_requirements)
    return await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )


# ──────────────────────────────────────────────
# Groundedness eval  (target: ≥ 0.8)
# ──────────────────────────────────────────────

async def test_eval_groundedness_at_least_0_8() -> None:
    """Each output gap must have at least one citation.

    groundedness = gaps_with_citations / total_gaps
    Threshold: ≥ 0.8
    """
    adapter = _GroundedAdapter()
    doc_reqs = ["operative_report", "clinical_notes", "imaging_report"]
    N = 5
    total_gaps = 0
    grounded_gaps = 0

    for _ in range(N):
        final = await _run_once(adapter, doc_reqs)
        output = final["agent_output"]
        assert not output.abstained, "Grounded adapter should not produce abstained output"
        gaps = output.result.get("gaps", [])
        for gap in gaps:
            total_gaps += 1
            if gap.get("citation"):
                grounded_gaps += 1

    assert total_gaps > 0, "No gaps produced — check adapter"
    groundedness = grounded_gaps / total_gaps
    assert groundedness >= 0.8, (
        f"Groundedness {groundedness:.2f} < 0.8 (grounded={grounded_gaps}, total={total_gaps})"
    )


# ──────────────────────────────────────────────
# Gap-detection precision eval  (target: ≥ 0.75)
# ──────────────────────────────────────────────

async def test_eval_gap_detection_precision_at_least_0_75() -> None:
    """Detected required_document_type values must appear in the expected set.

    precision = |detected ∩ expected| / |detected|
    Threshold: ≥ 0.75
    """
    adapter = _GroundedAdapter()
    expected_doc_types = {"operative_report", "clinical_notes", "imaging_report"}
    N = 5
    total_detected = 0
    true_positives = 0

    for _ in range(N):
        final = await _run_once(adapter, list(expected_doc_types))
        output = final["agent_output"]
        assert not output.abstained
        gaps = output.result.get("gaps", [])
        for gap in gaps:
            detected_type = gap.get("required_document_type", "")
            total_detected += 1
            if detected_type in expected_doc_types:
                true_positives += 1

    assert total_detected > 0, "No gaps detected — check adapter"
    precision = true_positives / total_detected
    assert precision >= 0.75, (
        f"Gap-detection precision {precision:.2f} < 0.75"
        f" (tp={true_positives}, detected={total_detected})"
    )


# ──────────────────────────────────────────────
# Abstention rate eval  (target: ≥ 0.6)
# ──────────────────────────────────────────────

async def test_eval_abstention_rate_on_ambiguous_inputs_at_least_0_6() -> None:
    """Ambiguous inputs (low model confidence) must produce abstained=True outputs.

    abstention_rate = abstained_count / total_inputs
    Threshold: ≥ 0.6
    """
    adapter = _AmbiguousAdapter()
    N = 5
    abstained_count = 0

    for _ in range(N):
        final = await _run_once(adapter, [])
        output = final["agent_output"]
        if output.abstained:
            abstained_count += 1

    abstention_rate = abstained_count / N
    assert abstention_rate >= 0.6, (
        f"Abstention rate {abstention_rate:.2f} < 0.6 on ambiguous inputs"
        f" ({abstained_count}/{N} abstained)"
    )
```

- [ ] **Step 8: Run all tests including evals**

```bash
cd services/agent-layer && uv run pytest tests/ evals/ -v
```
Expected: All tests and all 3 eval tests pass.

- [ ] **Step 9: Update root `Makefile` — add `test-agents` target**

In `Makefile`, add after the `test-workflow` block:
```makefile
## Run agent-layer tests only.
test-agents:
	cd services/agent-layer && uv run pytest -v

## Run ruff + mypy on the agent layer.
lint-agents:
	cd services/agent-layer && uv run ruff check enstellar_agents/
	cd services/agent-layer && uv run mypy enstellar_agents/
```

Also extend the `test:` target to include agent-layer:
```makefile
## Run unit, contract, and integration tests across all services.
test:
	cd packages/canonical-model && uv run pytest tests/python/ -v
	cd packages/canonical-model && npm test
	cd packages/canonical-model && ./gradlew test
	cd services/workflow-engine && uv run pytest -v
	cd services/agent-layer && uv run pytest -v
```

- [ ] **Step 10: Add the agent-layer CI job to `.github/workflows/ci.yml`**

Append to `.github/workflows/ci.yml` (inside the `jobs:` block, after `test-workflow-engine-outbox`):
```yaml
  test-agent-layer:
    name: agent-layer — guardrails + completeness agent + evals
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install uv
        run: pip install uv
      - name: Test
        working-directory: services/agent-layer
        run: |
          uv sync
          uv run pytest tests/ evals/ -v
```

- [ ] **Step 11: Dry-run the Makefile changes**

```bash
cd /path/to/repo && make --dry-run test-agents lint-agents
```
Expected: Output shows the `cd services/agent-layer && uv run pytest -v` commands without errors.

- [ ] **Step 12: Commit**

```bash
git add \
  services/agent-layer/enstellar_agents/routers/ \
  services/agent-layer/enstellar_agents/main.py \
  services/agent-layer/tests/test_assist_router.py \
  services/agent-layer/evals/ \
  Makefile \
  .github/workflows/ci.yml
git commit -m "feat(agent-layer): wire POST /assist/completeness router, eval harness, Makefile + CI — T14 complete"
```

---

## Self-Review

**Spec coverage check:**

| DoD requirement | Task(s) |
|---|---|
| Completeness & RFI assist agent: takes Case + doc-requirements list; outputs gap list (cited) + draft RFI | Tasks 7, 8 |
| Guardrail engine blocks output if confidence < 0.7 or no citations | Tasks 3, 4 |
| Guardrail engine blocks adverse determination output | Tasks 3, 4 |
| Guardrail engine blocks output with PHI in payload | Tasks 3, 4 |
| Model-access layer: `AnthropicAdapter` for commercial | Task 6 |
| Model-access layer: `OllamaAdapter` for local dev | Task 5 |
| Selected by `ENSTELLAR_MODEL_PROVIDER` env var | Tasks 1, 5 |
| Agent evals: groundedness ≥ 0.8 | Task 8 (eval) |
| Agent evals: gap-detection precision ≥ 0.75 | Task 8 (eval) |
| Agent evals: abstention rate ≥ 0.6 on ambiguous inputs | Task 8 (eval) |
| `POST /assist/completeness` returns typed `AgentOutput` | Task 8 |

**Invariant tests never weakened:**
- `test_rule_no_autonomous_adverse_blocks_adverse_keyword` — marked `[INVARIANT]` in test file
- `test_engine_blocks_adverse_keyword` — marked `[INVARIANT]` in test file
- `test_post_completeness_adverse_output_returns_abstained` — marked `[INVARIANT]` in test file
- `test_guardrail_result_always_present_in_final_state` — marked `[INVARIANT]` in test file
- `test_rule_tenant_isolation_blocks_mismatched_tenant` — marked `[INVARIANT]`
- `test_rule_phi_minimization_blocks_ssn_pattern` — marked `[INVARIANT]`
- `test_rule_phi_minimization_blocks_probable_dob` — marked `[INVARIANT]`

**Type consistency check:**
- `AgentInput`, `AgentOutput`, `GuardrailResult` defined in `models.py` (Task 2) and imported consistently in rules, engine, agent, and router.
- `CompletenessState` TypedDict defined in `completeness.py` (Task 7); `build_graph()` is the only public export.
- `MockAdapter` defined in `tests/conftest.py` and imported by name in `test_completeness_agent.py` and `test_assist_router.py`.
- `get_adapter(settings: AgentSettings)` signature in `factory.py` matches every call site.

**No placeholders:** Verified — all steps contain concrete code, exact commands, and expected output.
