"""Typed Pydantic models for agent I/O, guardrail results, and domain objects."""
from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class CompletionGap(BaseModel):
    """A single documentation gap identified by the completeness agent."""

    gap_id: str
    description: str
    required_document_type: str
    citations: list[str]  # references to Digicore doc rules or clinical criteria


class RfiDraft(BaseModel):
    """Draft RFI text produced by the completeness agent."""

    subject: str
    body: str
    required_documents: list[str]
    due_date_days: int


class AgentInput(BaseModel):
    """Input to any agent — always includes tenant_id and PHI-minimized case fields."""

    tenant_id: str = Field(min_length=1)
    case_id: UUID
    case_summary: dict[str, Any]  # PHI-minimized: procedure_code, diagnosis_codes, urgency, lob only
    doc_requirements: list[str]   # from Digicore structured_trace
    correlation_id: str


class AgentOutput(BaseModel):
    """Output from any agent — advisory only; must pass GuardrailEngine before leaving the service."""

    agent_id: str
    tenant_id: str = Field(min_length=1)
    case_id: UUID
    confidence: float = Field(ge=0.0, le=1.0)  # 0.0–1.0; agent's self-reported confidence
    citations: list[str]
    abstained: bool
    abstention_reason: str | None = None
    result: dict[str, Any] | None = None  # None when abstained=True
    provenance: dict[str, Any]            # model_name, input_hash, timestamp

    @model_validator(mode="after")
    def _result_must_be_none_when_abstained(self) -> "AgentOutput":
        if self.abstained and self.result is not None:
            raise ValueError("result must be None when abstained=True")
        return self


class GuardrailResult(BaseModel):
    """Result from GuardrailEngine.check() — passed=False means the output must not be used."""

    passed: bool
    violations: list[str]  # human-readable rule names that fired
