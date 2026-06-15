"""Shared fixtures for enstellar-agents tests."""
from __future__ import annotations

import json
import os
from collections.abc import Generator
from uuid import uuid4

import pytest

# Default env vars — no real API keys needed in unit/integration tests.
os.environ.setdefault("ENSTELLAR_MODEL_PROVIDER", "ollama")
os.environ.setdefault("ENSTELLAR_MODEL_NAME", "llama3")
os.environ.setdefault("ENSTELLAR_OLLAMA_BASE_URL", "http://localhost:11434")


@pytest.fixture(autouse=True)
def _reset_agent_settings() -> Generator[None, None, None]:
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
