"""Pydantic models for the Digicore decision API.

DecisionRequest — outbound request body (mapped to the C-1 EvaluationRequest).
DecisionResponse — legacy response shape mapped from the digicore-runtime C-1
    EvaluationResponse (POST /v1/runtime/evaluate).
StructuredTrace — embedded in DecisionResponse; used to pin rule artifact + version.
Pin — a single evaluated criterion from the rules engine.

INVARIANT #5: DecisionRequest.tenant_id has min_length=1 and must be non-blank.
A blank or missing tenant_id raises ValidationError *before* any HTTP call is made.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Pin(BaseModel):
    """A single criterion evaluated by the rules engine."""

    pin_id: str
    criterion_id: str
    text: str
    status: Literal["met", "not_met", "gap"]
    citations: list[str] = []


class DecisionRequest(BaseModel):
    """Outbound request body — mapped to the C-1 EvaluationRequest before POST /v1/runtime/evaluate."""

    case_id: str = Field(min_length=1)
    service_code: str = Field(min_length=1)
    member_id: str = Field(min_length=1)
    plan_id: str = Field(min_length=1)
    tenant_id: str = Field(
        min_length=1,
        description="Required: tenant owning this request — invariant #5",
    )
    pins: list[Pin] = []

    @field_validator("tenant_id")
    @classmethod
    def tenant_id_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("tenant_id must not be blank — invariant #5")
        return v


class StructuredTrace(BaseModel):
    """Rules trace pinned to the Digicore artifact + version at decision time."""

    artifact: str
    version: str
    source: str
    logic_branch: str
    governing_artifacts: list[str] = []
    inputs: list[str] = []
    logic_path: list[str] = []
    actors: list[str] = []


class DecisionResponse(BaseModel):
    """Legacy response shape, mapped from the C-1 EvaluationResponse (POST /v1/runtime/evaluate)."""

    decision: Literal["approved", "pending_review", "denied"]
    requirements: list[str]
    structured_trace: StructuredTrace
    pins: list[Pin] = []


# ---------------------------------------------------------------------------
# digicore-runtime C-1 models — POST /v1/runtime/evaluate
# ---------------------------------------------------------------------------


class EvaluationRequest(BaseModel):
    """Outbound request body for the digicore-runtime C-1 evaluate endpoint."""

    caseId: str
    evidence: dict = {}
    pins: list[str] = []
    serviceCode: str


class EvaluationResponse(BaseModel):
    """Response from POST /v1/runtime/evaluate (digicore-runtime C-1)."""

    outcome: str
    requirementGaps: list[dict] = []
    logicPath: list[dict] = []
    autoDetermination: dict = {}
    pins: list[str] = []
    traceRef: str | None = None
