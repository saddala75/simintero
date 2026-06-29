"""Tests for Pydantic response models: round-trip parse/serialise."""
from datetime import datetime, timezone

import pytest

from enstellar_bff.models import (
    CaseDetail,
    DecisionSubmission,
    SlaInfo,
    WorklistItem,
    WorklistPage,
)


def test_sla_info_round_trip() -> None:
    now = datetime.now(timezone.utc)
    sla = SlaInfo(deadline=now, hours_remaining=6.5, rag="red", paused=False)
    assert sla.rag == "red"
    assert sla.hours_remaining == pytest.approx(6.5)


def test_worklist_page_defaults() -> None:
    page = WorklistPage(items=[], total=0, page=1, page_size=25)
    assert page.items == []
    assert page.total == 0


def test_decision_submission_escalate() -> None:
    body = DecisionSubmission(outcome="escalate")
    assert body.outcome == "escalate"
    assert body.reason is None


def test_decision_submission_approved_with_reason() -> None:
    body = DecisionSubmission(outcome="approved", reason="Criteria met")
    assert body.reason == "Criteria met"


def test_case_detail_parse() -> None:
    raw = {
        "case_id": "00000000-0000-0000-0000-000000000001",
        "tenant_id": "tenant-abc",
        "status": "clinical_review",
        "urgency": "urgent",
        "lob": "commercial",
        "member": {"name": "Jane Doe"},
        "coverage": {"plan_id": "PLN-001"},
        "service_lines": [{"procedure_code": "99213"}],
        "events": [{"event_type": "intake"}],
        "sla": None,
    }
    case = CaseDetail(**raw)
    assert str(case.case_id) == "00000000-0000-0000-0000-000000000001"
    assert case.tenant_id == "tenant-abc"


def test_workbench_models_importable() -> None:
    from enstellar_bff.models import (
        CitationSpan,
        ClinicalEntity,
        GroundednessMetric,
        CompletenessItem,
        WorkbenchCaseDetail,
        EntityStatusUpdate,
        DeterminationRequest,
    )
    assert WorkbenchCaseDetail.model_fields

