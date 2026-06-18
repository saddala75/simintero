"""Unit tests for RevitalClient C-2 poll API (submit / get_analysis) using respx.

The real Revital pipeline exposes a poll API:
- POST /v1/assist/analyses          → 202 {analysis_id, operation}
- GET  /v1/assist/analyses/{id}     → 200 {analysis_id, status, completeness, triage, ...}

Both endpoints require the lowercase header `x-sim-tenant-id`.
"""
from __future__ import annotations

import json as _json
import time
from unittest.mock import patch

import httpx
import pytest
import respx

from enstellar_connectors.revital.client import RevitalClient
from enstellar_connectors.revital.models import (
    AnalysisResult,
    RevitalUnavailableError,
)

REVITAL_TEST_URL = "http://mock-revital-test"

SUBMIT_RESPONSE = {"analysis_id": "ana_1", "operation": "op_1"}

GET_RESPONSE = {
    "analysis_id": "ana_1",
    "classification": "prior_auth",
    "status": "complete",
    "case_ref": "corr-1",
    "interaction": {"foo": "bar"},
    "summary": {"text": "advisory"},
    "extraction": {"entities": []},
    "completeness": {
        "status": "ok",
        "satisfied": [{"requirement_id": "req-ok", "evidence_refs": ["e1", "e2"]}],
        "gaps": [
            {"requirement_id": "req-1", "description": "missing lab", "search_attempted": True}
        ],
        "conflicts": [{"description": "conflict", "refs": ["r1"]}],
        "against": {},
    },
    "triage": {
        "status": "ok",
        "suggestion": "likely_meets",
        "confidence": 0.9,
        "calibration_ref": "cal-1",
        "rationale_assertion_ids": ["a1", "a2"],
    },
    "abstentions": [],
    "unprocessed_inputs": [],
}


def make_client() -> RevitalClient:
    """RevitalClient with retry_attempts=1 so tests need no sleep/wait."""
    return RevitalClient(retry_attempts=1)


# ─── submit() ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@respx.mock
async def test_submit_posts_and_returns_analysis_id(monkeypatch):
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    route = respx.post(f"{REVITAL_TEST_URL}/v1/assist/analyses").mock(
        return_value=httpx.Response(202, json=SUBMIT_RESPONSE)
    )

    client = make_client()
    aid = await client.submit(
        case_ref="corr-1",
        analysis_kinds=["completeness", "triage"],
        document_refs=["d1"],
        case_context={"lob": "MA"},
        tenant_id="tenant-dev",
    )

    assert aid == "ana_1"
    assert route.called
    req = route.calls.last.request
    assert req.headers.get("x-sim-tenant-id") == "tenant-dev"
    body = _json.loads(req.content)
    assert body["case_ref"] == "corr-1"
    assert body["analysis_kinds"] == ["completeness", "triage"]
    assert body["inputs"]["document_refs"] == ["d1"]
    assert body["inputs"]["case_context"] == {"lob": "MA"}


@pytest.mark.asyncio
@respx.mock
async def test_submit_failure_raises_unavailable(monkeypatch):
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.post(f"{REVITAL_TEST_URL}/v1/assist/analyses").mock(
        return_value=httpx.Response(503, json={})
    )

    client = make_client()
    with pytest.raises(RevitalUnavailableError):
        await client.submit(
            case_ref="corr-1",
            analysis_kinds=["completeness"],
            document_refs=["d1"],
            case_context={},
            tenant_id="tenant-dev",
        )


@pytest.mark.asyncio
@respx.mock
async def test_submit_missing_analysis_id_raises_unavailable(monkeypatch):
    """A 202 body lacking analysis_id must degrade to RevitalUnavailableError,
    never a raw KeyError (advisory never-block invariant)."""
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.post(f"{REVITAL_TEST_URL}/v1/assist/analyses").mock(
        return_value=httpx.Response(202, json={"operation": "op_1"})  # no analysis_id
    )

    client = make_client()
    with pytest.raises(RevitalUnavailableError):
        await client.submit(
            case_ref="corr-1",
            analysis_kinds=["completeness"],
            document_refs=["d1"],
            case_context={},
            tenant_id="tenant-dev",
        )


# ─── get_analysis() ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
@respx.mock
async def test_get_analysis_parses_result(monkeypatch):
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    route = respx.get(f"{REVITAL_TEST_URL}/v1/assist/analyses/ana_1").mock(
        return_value=httpx.Response(200, json=GET_RESPONSE)
    )

    client = make_client()
    r = await client.get_analysis("ana_1", tenant_id="tenant-dev")

    assert route.called
    assert route.calls.last.request.headers.get("x-sim-tenant-id") == "tenant-dev"
    assert isinstance(r, AnalysisResult)
    assert r.analysis_id == "ana_1"
    assert r.status == "complete"
    assert r.case_ref == "corr-1"
    assert r.completeness.status == "ok"
    assert r.completeness.gaps[0].requirement_id == "req-1"
    assert r.completeness.gaps[0].description == "missing lab"
    assert r.completeness.gaps[0].search_attempted is True
    assert r.completeness.satisfied[0].requirement_id == "req-ok"
    assert r.completeness.satisfied[0].evidence_refs == ["e1", "e2"]
    assert r.triage.suggestion == "likely_meets"
    assert r.triage.confidence == 0.9
    assert r.triage.rationale_assertion_ids == ["a1", "a2"]


@pytest.mark.asyncio
@respx.mock
async def test_get_analysis_tolerates_extra_and_minimal_fields(monkeypatch):
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    minimal = {"analysis_id": "ana_2", "status": "processing", "unexpected": {"x": 1}}
    respx.get(f"{REVITAL_TEST_URL}/v1/assist/analyses/ana_2").mock(
        return_value=httpx.Response(200, json=minimal)
    )

    client = make_client()
    r = await client.get_analysis("ana_2", tenant_id="tenant-dev")
    assert r.status == "processing"
    assert r.completeness is None
    assert r.triage is None


@pytest.mark.asyncio
@respx.mock
async def test_get_analysis_failure_raises_unavailable(monkeypatch):
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.get(f"{REVITAL_TEST_URL}/v1/assist/analyses/ana_x").mock(
        return_value=httpx.Response(500, json={})
    )

    client = make_client()
    with pytest.raises(RevitalUnavailableError):
        await client.get_analysis("ana_x", tenant_id="tenant-dev")


@pytest.mark.asyncio
@respx.mock
async def test_get_analysis_invalid_body_raises_unavailable(monkeypatch):
    """A 200 body that fails AnalysisResult validation (wrong-type status) must
    degrade to RevitalUnavailableError, never a raw pydantic ValidationError."""
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.get(f"{REVITAL_TEST_URL}/v1/assist/analyses/ana_bad").mock(
        return_value=httpx.Response(
            200, json={"analysis_id": "ana_bad", "status": {"not": "a string"}}
        )
    )

    client = make_client()
    with pytest.raises(RevitalUnavailableError):
        await client.get_analysis("ana_bad", tenant_id="tenant-dev")


@pytest.mark.asyncio
@respx.mock
async def test_get_analysis_non_json_body_raises_unavailable(monkeypatch):
    """A 200 with a non-JSON body must degrade to RevitalUnavailableError,
    never a raw json.JSONDecodeError."""
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.get(f"{REVITAL_TEST_URL}/v1/assist/analyses/ana_txt").mock(
        return_value=httpx.Response(200, text="not json at all")
    )

    client = make_client()
    with pytest.raises(RevitalUnavailableError):
        await client.get_analysis("ana_txt", tenant_id="tenant-dev")


# ─── Circuit breaker / retry ─────────────────────────────────────────────────


@pytest.mark.asyncio
@respx.mock
async def test_circuit_opens_after_5_consecutive_failures(monkeypatch):
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.post(f"{REVITAL_TEST_URL}/v1/assist/analyses").mock(
        return_value=httpx.Response(503, json={})
    )

    client = make_client()  # retry_attempts=1
    for _ in range(5):
        with pytest.raises(RevitalUnavailableError):
            await client.submit(
                case_ref="corr-1",
                analysis_kinds=["completeness"],
                document_refs=["d1"],
                case_context={},
                tenant_id="tenant-dev",
            )

    assert client._cb.is_open() is True
    assert client._cb.failure_count >= 5


@pytest.mark.asyncio
@respx.mock
async def test_circuit_open_raises_without_http_call(monkeypatch):
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    route = respx.get(f"{REVITAL_TEST_URL}/v1/assist/analyses/ana_1").mock(
        return_value=httpx.Response(200, json=GET_RESPONSE)
    )

    client = make_client()
    client._cb._failures = 5
    client._cb._open_at = time.monotonic()

    with pytest.raises(RevitalUnavailableError) as exc_info:
        await client.get_analysis("ana_1", tenant_id="tenant-dev")

    assert "circuit breaker" in str(exc_info.value).lower()
    assert route.call_count == 0


@pytest.mark.asyncio
@respx.mock
async def test_successful_call_resets_circuit_breaker(monkeypatch):
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.post(f"{REVITAL_TEST_URL}/v1/assist/analyses").mock(
        return_value=httpx.Response(202, json=SUBMIT_RESPONSE)
    )

    client = make_client()
    client._cb._failures = 3  # below threshold

    await client.submit(
        case_ref="corr-1",
        analysis_kinds=["completeness"],
        document_refs=["d1"],
        case_context={},
        tenant_id="tenant-dev",
    )
    assert client._cb.failure_count == 0
    assert client._cb.is_open() is False


@pytest.mark.asyncio
@respx.mock
async def test_retries_on_503_then_succeeds(monkeypatch):
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.post(f"{REVITAL_TEST_URL}/v1/assist/analyses").mock(
        side_effect=[
            httpx.Response(503, json={"detail": "service unavailable"}),
            httpx.Response(202, json=SUBMIT_RESPONSE),
        ]
    )

    client = RevitalClient(retry_attempts=2)  # 1 original + 1 retry
    with patch(
        "enstellar_connectors.revital.client.wait_exponential",
        return_value=lambda _: 0,
    ):
        aid = await client.submit(
            case_ref="corr-1",
            analysis_kinds=["completeness"],
            document_refs=["d1"],
            case_context={},
            tenant_id="tenant-dev",
        )
    assert aid == "ana_1"


# ─── Integration test (skipped unless REVITAL_INTEGRATION=1) ─────────────────


@pytest.mark.asyncio
@pytest.mark.integration
async def test_integration_submit_against_live_pipeline():
    import os

    if not os.environ.get("REVITAL_INTEGRATION"):
        pytest.skip("Set REVITAL_INTEGRATION=1 to run integration tests")

    os.environ.setdefault("REVITAL_BASE_URL", "http://localhost:3014")
    from enstellar_connectors.config import reset_settings

    reset_settings()
    client = RevitalClient()
    aid = await client.submit(
        case_ref="integration-corr-1",
        analysis_kinds=["completeness", "triage"],
        document_refs=["doc-1"],
        case_context={"lob": "MA"},
        tenant_id="tenant-integration",
    )
    assert isinstance(aid, str) and aid
