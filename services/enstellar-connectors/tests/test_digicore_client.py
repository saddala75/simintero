"""Unit tests for DigiCoreClient using respx HTTP mocking.

Integration tests (requiring a live Digicore server at localhost:8090) are
marked with @pytest.mark.integration and skipped unless DIGICORE_INTEGRATION=1.
"""
from __future__ import annotations

import os
import time
from unittest.mock import patch

import httpx
import pytest
import respx

from enstellar_connectors import DigiCoreClient, DecisionRequest, DecisionResponse
from enstellar_connectors.config import get_settings, reset_settings
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
    with patch("enstellar_connectors.circuit_breaker.time") as mock_time:
        mock_time.monotonic.side_effect = [
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
    """Setting DIGICORE_REVITAL_BASE_URL must NOT override revital_base_url."""
    monkeypatch.setenv("DIGICORE_REVITAL_BASE_URL", "http://wrong-prefix:1111")
    monkeypatch.delenv("REVITAL_BASE_URL", raising=False)
    reset_settings()
    s = get_settings()
    assert s.revital_base_url == "http://mock-revital:8000"
