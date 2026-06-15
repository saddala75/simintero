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
