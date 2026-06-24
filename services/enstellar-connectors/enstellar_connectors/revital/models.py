"""Pydantic models for the Revital C-2 poll API.

The Revital pipeline exposes an async poll API (not a synchronous summarize call):
- POST /v1/assist/analyses          → 202 {analysis_id, operation}  (submit)
- GET  /v1/assist/analyses/{id}     → 200 AnalysisResult            (poll)

AnalysisResult mirrors the real GET response shape produced by the pipeline
(mapEvidenceToCriteria.ts → completeness; triageAdvise.ts → triage). Extra GET
fields (summary/extraction/interaction/abstentions/unprocessed_inputs) are
tolerated and ignored by the connector.

ADVISORY ONLY: AnalysisResult output must never be used to make or directly
influence a coverage determination without human sign-off (invariant #1).

RevitalUnavailableError — raised when Revital is unreachable; callers MUST catch it.
"""
from __future__ import annotations

from pydantic import BaseModel


class Gap(BaseModel):
    """A requirement the pipeline could not satisfy from the supplied evidence."""

    requirement_id: str
    description: str
    search_attempted: bool = False


class Satisfied(BaseModel):
    """A requirement satisfied by one or more evidence refs."""

    requirement_id: str
    evidence_refs: list[str] = []


class CompletenessBlock(BaseModel):
    """Completeness block from mapEvidenceToCriteria.ts.

    status is 'ok' or 'abstained'. Unknown extra keys (e.g. ``against``) are
    tolerated and ignored.
    """

    model_config = {"extra": "ignore"}

    status: str
    gaps: list[Gap] = []
    satisfied: list[Satisfied] = []
    conflicts: list[dict] = []


class TriageBlock(BaseModel):
    """Triage block from triageAdvise.ts.

    status is 'ok' or 'abstained'. suggestion is one of
    'likely_meets' | 'needs_rfi' | 'route_to_clinician' when present.
    """

    model_config = {"extra": "ignore"}

    status: str
    suggestion: str | None = None
    confidence: float | None = None
    rationale_assertion_ids: list[str] | None = None


class ModelRef(BaseModel):
    """A canonical reference to a versioned AI artifact (model or prompt)."""

    model_config = {"extra": "ignore"}

    canonical_url: str | None = None
    version: str | None = None


class Interaction(BaseModel):
    """AI model + prompt provenance recorded by Revital on the analysis.

    protected_namespaces=() — pydantic v2 reserves the ``model_`` prefix; the
    contract field is ``model_binding``, so we opt out of that protection.
    """

    model_config = {"extra": "ignore", "protected_namespaces": ()}

    model_binding: ModelRef | None = None
    prompt: ModelRef | None = None
    started_at: str | None = None
    completed_at: str | None = None


class AnalysisResult(BaseModel):
    """Parsed GET /v1/assist/analyses/{id} response.

    status is one of 'processing' | 'complete' | 'partial' | 'failed'. Extra
    response fields (summary/extraction/abstentions/unprocessed_inputs/
    classification) are tolerated and ignored. The ``interaction`` block is
    now surfaced (not dropped) so callers can read AI provenance.

    ADVISORY ONLY: no code path may use this output to commit a coverage
    determination without recorded human sign-off (invariant #1).
    """

    model_config = {"extra": "ignore"}

    analysis_id: str
    status: str
    case_ref: str | None = None
    completeness: CompletenessBlock | None = None
    triage: TriageBlock | None = None
    interaction: Interaction | None = None


class RevitalUnavailableError(Exception):
    """Raised when the circuit breaker is open or all retries are exhausted.

    Callers MUST catch this and fall back to human-only review.
    A Revital outage must never block the case workflow.

    Example::

        try:
            aid = await client.submit(...)
        except RevitalUnavailableError:
            logger.warning("revital_unavailable case_ref=%s — routing to human review", case_ref)
            # continue workflow without advisory analysis
    """
