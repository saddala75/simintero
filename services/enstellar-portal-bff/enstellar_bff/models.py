from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class SlaInfo(BaseModel):
    deadline: datetime
    hours_remaining: float
    rag: Literal["green", "amber", "red"]
    paused: bool


class WorklistItem(BaseModel):
    case_id: UUID
    correlation_id: str
    member_name: str
    service_description: str
    lob: str
    status: str
    urgency: str
    sla: SlaInfo | None


class WorklistPage(BaseModel):
    items: list[WorklistItem]
    total: int
    page: int
    page_size: int


class CaseDetail(BaseModel):
    case_id: UUID
    tenant_id: str
    status: str
    urgency: str
    lob: str
    member: dict
    coverage: dict
    service_lines: list[dict]
    events: list[dict]
    sla: SlaInfo | None


class DecisionSubmission(BaseModel):
    outcome: Literal["approved", "escalate"]
    reason: str | None = None


class FindingSection(BaseModel):
    criterion_id: str
    text: str
    status: Literal["gap", "unknown"]


class AdverseDecisionRequest(BaseModel):
    """Request body for POST /bff/cases/{id}/adverse-decision."""

    outcome: Literal["denied", "partially_denied", "adverse_modification"]
    reason: str = Field(..., min_length=1)
    clinician_id: str
    sign_off_confirmed: bool
    # Structured payload fields — all optional for backwards compatibility
    finding_sections: list[FindingSection] | None = None
    reason_codes: list[str] | None = None
    citations: list[str] | None = None


class QueueStats(BaseModel):
    ai_determinations: int
    adverse_human_signed_pct: float
    sla_compliance_expedited_pct: float
    period_start: str
    period_end: str


class RfiRequest(BaseModel):
    """Request body for POST /bff/cases/{id}/rfi.

    Reviewers supply only the clinical question and document types.
    provider_npi is fetched from the case by the BFF — never accepted
    from the request body (invariant: sourced from case record).
    """

    question: str
    requested_docs: list[str] = []


class DocumentItem(BaseModel):
    """A FHIR DocumentReference mapped for BFF responses.

    The url field is ALWAYS a BFF proxy path (/bff/cases/{id}/documents/{doc_id}/content).
    Raw HAPI or MinIO URLs are never exposed in browser responses.
    """

    id: str
    title: str
    doc_type: str
    content_type: str
    url: str  # BFF proxy URL only — no raw HAPI/MinIO URLs in browser
    authored: str | None


class CriterionItem(BaseModel):
    id: str
    criterion_id: str
    text: str
    status: Literal["met", "gap", "unknown"]
    evidence: dict | None = None
    citations: list[str] = []


class SuggestionItem(BaseModel):
    id: str
    agent_id: str
    title: str
    body: str
    confidence: float
    citations: list[str] = []
    status: Literal["pending", "accepted", "rejected"]
    reviewer_id: str | None = None
    reviewed_at: str | None = None


class SuggestionActionRequest(BaseModel):
    action: Literal["accepted", "rejected"]


# ── CRD (CDS Hooks) — EHR order simulator ────────────────────────────────────

class CrdHookRequest(BaseModel):
    """Request body for POST /bff/crd/invoke (in-house EHR simulator)."""

    hook: Literal["order-select", "order-sign", "appointment-book"]
    service_code: str
    patient_id: str
    plan_id: str


class CrdCardLink(BaseModel):
    label: str
    url: str
    type: str
    appContext: str | None = None


class CrdCard(BaseModel):
    summary: str
    indicator: str
    detail: str | None = None
    links: list[CrdCardLink] | None = None


# ── Revital AI Workbench ─────────────────────────────────────────────────────

class CitationSpan(BaseModel):
    id: str
    page: int
    text: str
    bbox: str


class ClinicalEntity(BaseModel):
    id: str
    type: Literal["condition", "procedure", "observation"]
    name: str
    code: str
    system: str
    confidence: float
    provenance: str
    status: Literal["accepted", "disputed", "pending"]
    citationId: str | None = None


class GroundednessMetric(BaseModel):
    score: float
    citationsCount: int
    gapsCount: int
    conflictsCount: int


class CompletenessItem(BaseModel):
    criteria: str
    satisfied: bool
    note: str


class WorkbenchCaseDetail(BaseModel):
    caseId: str
    memberName: str
    memberDob: str
    serviceRequested: str
    documentUrl: str | None
    entities: list[ClinicalEntity]
    citations: list[CitationSpan]
    groundedness: GroundednessMetric
    summary: str
    completeness: list[CompletenessItem]


class EntityStatusUpdate(BaseModel):
    status: Literal["accepted", "disputed", "pending"]


class DeterminationRequest(BaseModel):
    decision: Literal["accept", "adverse"]

