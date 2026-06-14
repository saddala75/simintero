"""Pydantic models for the Revital clinical summarization API.

SummarizeRequest — PHI-minimized outbound request body.
SummarizeResponse — advisory output from POST /api/v1/summarize.
RevitalUnavailableError — raised when Revital is unreachable; callers MUST catch it.

INVARIANT #3 (PHI minimum-necessary): SummarizeRequest defines only PHI-safe
fields. PHI fields (member_name, dob, ssn, etc.) must never appear in this model.
Enforced by test_summarize_request_schema_has_no_phi_fields.

INVARIANT #5: tenant_id has min_length=1 with a blank-check validator. A blank
or missing tenant_id raises ValidationError *before* any HTTP call is made.

ADVISORY ONLY: SummarizeResponse output must never be used to make or directly
influence a coverage determination without human sign-off (invariant #1).
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class SummarizeRequest(BaseModel):
    """PHI-minimized request body for POST /api/v1/summarize.

    Callers MUST call minimize_for_revital() before constructing this model.
    This class MUST NOT gain PHI fields (member_name, dob, ssn, address, etc.).
    Adding PHI fields will fail test_summarize_request_schema_has_no_phi_fields.
    """

    case_id: str = Field(min_length=1)
    tenant_id: str = Field(
        min_length=1,
        description="Required: tenant owning this request — invariant #5",
    )
    service_codes: list[str]
    diagnosis_codes: list[str]
    lob: str = Field(min_length=1)
    urgency: str = Field(min_length=1)
    doc_requirements: list[str]

    @field_validator("tenant_id")
    @classmethod
    def tenant_id_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("tenant_id must not be blank — invariant #5")
        return v


class SummarizeResponse(BaseModel):
    """Advisory response from POST /api/v1/summarize.

    ADVISORY ONLY: no code path may use this output to commit a coverage
    determination without recorded human sign-off (invariant #1).
    """

    summary: str
    citations: list[str]
    extracted_entities: list[dict[str, Any]]
    completeness: float = Field(ge=0.0, le=1.0)
    triage: str = Field(
        description="Advisory routing signal. Known values: standard, escalate, expedited, routine_review. Left as str for forward-compatibility.",
    )
    abstained: bool
    model_version: str


class RevitalUnavailableError(Exception):
    """Raised when the circuit breaker is open or all retries are exhausted.

    Callers MUST catch this and fall back to human-only review.
    A Revital outage must never block the case workflow.

    Example::

        try:
            resp = await client.summarize(req)
        except RevitalUnavailableError:
            logger.warning("revital_unavailable case_id=%s — routing to human review", case_id)
            # continue workflow without advisory summary
    """
