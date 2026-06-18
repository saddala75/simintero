"""RevitalClient — async httpx client for the Revital C-2 poll API.

The Revital pipeline exposes an async poll API:
- POST /v1/assist/analyses          → 202 {analysis_id, operation}  (submit)
- GET  /v1/assist/analyses/{id}     → 200 AnalysisResult            (poll)

Both endpoints require the lowercase tenant header ``x-sim-tenant-id``.

Design:
- httpx.AsyncClient (long-lived; one instance per RevitalClient, reuses connection pool)
- tenacity AsyncRetrying: configurable attempts (default 3), exponential backoff 1–30 s
- Retried errors: httpx.TransportError (ConnectError, TimeoutException, etc.)
  and httpx.HTTPStatusError (all non-2xx). Revital is advisory-only; aggressive
  retry is safe because failure degrades to human review, not workflow blockage.
- CircuitBreaker: opens after 5 consecutive call failures; half-open after 30 s

INVARIANT #3 (PHI minimum-necessary):
  RevitalClient never receives raw PHI. Callers MUST build ``case_context`` /
  ``document_refs`` from PHI-minimized data before calling submit() — this is a
  caller contract, not a runtime check in this module.

ADVISORY ONLY:
  RevitalUnavailableError MUST be caught by callers. A Revital outage must
  never block the case workflow. Callers fall back to human-only review.

PROVENANCE:
  Recording provenance (agent.assist.produced event) is the caller's
  responsibility after receiving an AnalysisResult. RevitalClient is a pure
  HTTP adapter — it has no database or outbox dependency.
"""
from __future__ import annotations

import json
import logging

import httpx
from pydantic import ValidationError
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from ..circuit_breaker import CircuitBreaker
from ..config import get_settings
from .models import AnalysisResult, RevitalUnavailableError

logger = logging.getLogger(__name__)

_TENANT_HEADER = "x-sim-tenant-id"


class RevitalClient:
    """Async client for the Revital C-2 poll API.

    Instantiate once per application lifecycle. Not thread-safe — use within
    a single asyncio event loop.

    Advisory contract — callers must handle RevitalUnavailableError::

        client = RevitalClient()
        try:
            aid = await client.submit(
                case_ref=corr_id,
                analysis_kinds=["completeness", "triage"],
                document_refs=doc_refs,
                case_context=ctx,
                tenant_id=tenant_id,
            )
            result = await client.get_analysis(aid, tenant_id=tenant_id)
        except RevitalUnavailableError:
            logger.warning("revital_unavailable — routing to human review")
            # continue workflow without advisory analysis
    """

    def __init__(self, *, retry_attempts: int = 3) -> None:
        """Create a RevitalClient.

        Args:
            retry_attempts: Total HTTP attempts per call (1 original + N-1
                retries). Production default is 3. Pass 1 in tests to avoid
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

    async def submit(
        self,
        *,
        case_ref: str,
        analysis_kinds: list[str],
        document_refs: list[str],
        case_context: dict,
        tenant_id: str,
    ) -> str:
        """POST /v1/assist/analyses with retry and circuit-breaker protection.

        Args:
            case_ref: Correlation/case reference echoed back on the analysis.
            analysis_kinds: Requested analyses, e.g. ["completeness", "triage"].
            document_refs: PHI-minimized document refs to analyze.
            case_context: PHI-minimized case context dict (lob, codes, etc.).
            tenant_id: Tenant id sent as the ``x-sim-tenant-id`` header.

        Returns:
            The ``analysis_id`` from the 202 response, used to poll get_analysis().

        Raises:
            RevitalUnavailableError: if the circuit breaker is open OR all retry
                attempts are exhausted. Callers MUST catch this and fall back to
                human-only review.
        """
        self._raise_if_open()
        body = {
            "case_ref": case_ref,
            "analysis_kinds": analysis_kinds,
            "inputs": {
                "document_refs": document_refs,
                "case_context": case_context,
            },
        }
        async def op() -> str:
            data = await self._post("/v1/assist/analyses", body, tenant_id)
            # Extracted inside the guarded region so a malformed 202 body
            # (missing analysis_id) degrades to RevitalUnavailableError, not KeyError.
            return data["analysis_id"]

        return await self._guarded(op)

    async def get_analysis(self, analysis_id: str, tenant_id: str) -> AnalysisResult:
        """GET /v1/assist/analyses/{id} with retry and circuit-breaker protection.

        Args:
            analysis_id: The id returned by submit().
            tenant_id: Tenant id sent as the ``x-sim-tenant-id`` header.

        Returns:
            AnalysisResult — advisory output only. Never use this to make a
            coverage determination without human sign-off.

        Raises:
            RevitalUnavailableError: if the circuit breaker is open OR all retry
                attempts are exhausted.
        """
        self._raise_if_open()
        async def op() -> AnalysisResult:
            data = await self._get(f"/v1/assist/analyses/{analysis_id}", tenant_id)
            # Parsed inside the guarded region so a malformed body degrades to
            # RevitalUnavailableError, not pydantic ValidationError.
            return AnalysisResult.model_validate(data)

        return await self._guarded(op)

    # ─── internals ────────────────────────────────────────────────────────────

    def _raise_if_open(self) -> None:
        if self._cb.is_open():
            raise RevitalUnavailableError(
                f"Revital circuit breaker is open after "
                f"{self._cb.failure_count} consecutive failures"
            )

    async def _guarded(self, op):
        """Run a retried HTTP op, recording circuit-breaker success/failure."""
        try:
            result = await self._retrying(op)
        except (
            httpx.TransportError,
            httpx.HTTPStatusError,
            json.JSONDecodeError,
            KeyError,
            ValidationError,
        ) as exc:
            # Transport/HTTP errors are retried by _retrying; parse errors
            # (malformed/short 2xx body) are server faults too — all degrade to
            # RevitalUnavailableError so a Revital problem never blocks the workflow.
            self._cb.record_failure()
            raise RevitalUnavailableError(
                f"Revital call failed after {self._retry_attempts} attempt(s): {exc}"
            ) from exc
        else:
            self._cb.record_success()
            return result

    async def _retrying(self, op):
        """Execute ``op`` with tenacity AsyncRetrying on transient errors.

        Uses the context-manager form (not the @retry decorator) so that
        retry_attempts can be configured per-instance — essential for test
        isolation without mocking sleep.
        """
        async for attempt in AsyncRetrying(
            retry=retry_if_exception_type((httpx.TransportError, httpx.HTTPStatusError)),
            stop=stop_after_attempt(self._retry_attempts),
            wait=wait_exponential(multiplier=1, min=1, max=30),
            reraise=True,
        ):
            with attempt:
                return await op()
        # Unreachable: AsyncRetrying with reraise=True always raises on exhaustion.
        raise RuntimeError("Unreachable: tenacity loop exited without return or raise")

    async def _post(self, path: str, json_body: dict, tenant_id: str) -> dict:
        r = await self._http.post(
            path,
            json=json_body,
            headers={_TENANT_HEADER: tenant_id},
        )
        r.raise_for_status()
        return r.json()

    async def _get(self, path: str, tenant_id: str) -> dict:
        r = await self._http.get(path, headers={_TENANT_HEADER: tenant_id})
        r.raise_for_status()
        return r.json()

    async def close(self) -> None:
        """Close the underlying HTTP connection pool."""
        await self._http.aclose()

    async def __aenter__(self) -> "RevitalClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()
