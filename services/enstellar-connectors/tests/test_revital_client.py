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
    with patch("enstellar_connectors.revital.client.wait_exponential", return_value=lambda _: 0):
        resp = await client.summarize(make_request())
    assert resp.completeness == 0.95


@pytest.mark.asyncio
@respx.mock
async def test_400_raises_unavailable_not_status_error(monkeypatch):
    """400 from Revital is retried (all HTTPStatusError is retried) then raises
    RevitalUnavailableError. Callers see RevitalUnavailableError, not HTTPStatusError.
    This is intentional: Revital is advisory-only, so even malformed requests
    degrade to human review without exposing the HTTP error to callers.
    """
    monkeypatch.setenv("REVITAL_BASE_URL", REVITAL_TEST_URL)
    respx.post(f"{REVITAL_TEST_URL}/api/v1/summarize").mock(
        return_value=httpx.Response(400, json={"detail": "bad request"})
    )

    client = make_client()  # retry_attempts=1 — no sleep
    with pytest.raises(RevitalUnavailableError):
        await client.summarize(make_request())


# ─── Advisory contract ───────────────────────────────────────────────────────


@pytest.mark.asyncio
@respx.mock
async def test_revital_unavailable_does_not_block_workflow(monkeypatch):
    """Advisory contract: catching RevitalUnavailableError lets the workflow continue."""
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
