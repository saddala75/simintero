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

    async def close(self) -> None:
        """Close the underlying HTTP connection pool."""
        await self._http.aclose()

    async def __aenter__(self) -> "RevitalClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()
