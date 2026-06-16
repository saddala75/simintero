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

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from ..circuit_breaker import CircuitBreaker, CircuitOpenError
from ..config import get_settings
from .models import (
    DecisionRequest,
    DecisionResponse,
    EvaluationRequest,
    EvaluationResponse,
    Pin,
    StructuredTrace,
)

logger = logging.getLogger(__name__)


def _is_transient(exc: BaseException) -> bool:
    """Return True if the exception represents a transient error worth retrying."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in {502, 503, 504}
    return isinstance(exc, (httpx.ConnectError, httpx.TimeoutException))


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
        print(resp.decision)  # 'approved' | 'pending_review' (never 'denied' — invariant #1)
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
        """Call POST /v1/runtime/evaluate (digicore-runtime C-1). Retries on transient errors.

        The EvaluationResponse is mapped back to DecisionResponse inside the client
        so the return type is unchanged for callers.

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
        """Execute a single HTTP POST against digicore-runtime C-1, mapped to DecisionResponse.

        Calls POST /v1/runtime/evaluate (the real digicore-runtime), then maps the
        EvaluationResponse back to the existing DecisionResponse shape so callers
        (auto_determination.py) are unaffected.
        """
        eval_req = EvaluationRequest(
            caseId=req.case_id,
            evidence={},
            pins=[p.pin_id for p in req.pins],
            serviceCode=req.service_code,
        )
        async with httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout,
        ) as client:
            resp = await client.post(
                "/v1/runtime/evaluate",
                json=eval_req.model_dump(),
            )
            resp.raise_for_status()
            ev = EvaluationResponse.model_validate(resp.json())
        return self._map_evaluation(ev)

    @staticmethod
    def _map_evaluation(ev: EvaluationResponse) -> DecisionResponse:
        """Map a digicore-runtime EvaluationResponse to the legacy DecisionResponse.

        INVARIANT #1: never produce decision="denied" from this mapping. A
        non-"meets_all" outcome maps to "pending_review" (human review), never denial.
        """
        decision = "approved" if ev.outcome == "meets_all" else "pending_review"
        requirements = [
            str(g.get("description") or g.get("display") or g.get("requirement_id") or g)
            for g in ev.requirementGaps
        ]
        structured_trace = StructuredTrace(
            artifact=(ev.pins[0] if ev.pins else "digicore-runtime"),
            version="",
            source="digicore-runtime",
            logic_branch=ev.outcome,
            governing_artifacts=list(ev.pins),
            inputs=[],
            logic_path=[str(x) for x in ev.logicPath],
            actors=[],
        )
        # DecisionResponse.pins are CRITERION-evaluation pins and are persisted
        # into the durable Decision record + emitted on decision.recorded. They
        # MUST be built from the criterion-level requirementGaps, NOT from
        # ev.pins (which are ARTIFACT-VERSION URNs and belong only in
        # structured_trace.governing_artifacts below).
        #
        # A C-1 requirementGap is a leaf EvidencePresent that evaluated false
        # (evidence missing) → status "gap". On the approved path (meets_all),
        # requirementGaps is empty → pins == [] (the honest "no unmet criteria"
        # state, which auto_determination already handles).
        pins = [
            Pin(
                pin_id=str(g.get("requirement_id") or g.get("requirementId") or ""),
                criterion_id=str(g.get("requirement_id") or g.get("requirementId") or ""),
                text=str(g.get("description") or g.get("display") or ""),
                status="gap",
            )
            for g in ev.requirementGaps
        ]
        return DecisionResponse(
            decision=decision,
            requirements=requirements,
            structured_trace=structured_trace,
            pins=pins,
        )
