"""Pure-logic tests for the Revital → criteria/suggestion mappers.

No DB. These verify the shape of rows produced from an AnalysisResult, which
the RevitalPoller hands straight to CriteriaRepository.insert_many /
SuggestionsRepository.insert_many.
"""
from __future__ import annotations

import uuid

from enstellar_connectors.revital.models import (
    AnalysisResult,
    CompletenessBlock,
    Gap,
    TriageBlock,
)

from enstellar_workflow.revital import (
    map_completeness_to_criteria,
    map_triage_to_suggestion,
)

_CASE_ID = uuid.uuid4()
_TENANT = "tenant-map"


# ---------------------------------------------------------------------------
# Completeness → criteria
# ---------------------------------------------------------------------------
def test_completeness_two_gaps_maps_to_two_rows():
    result = AnalysisResult(
        analysis_id="an-1",
        status="complete",
        completeness=CompletenessBlock(
            status="ok",
            gaps=[
                Gap(requirement_id="REQ-1", description="missing labs", search_attempted=True),
                Gap(requirement_id="REQ-2", description="missing imaging", search_attempted=False),
            ],
        ),
    )

    rows = map_completeness_to_criteria(result, case_id=_CASE_ID, tenant_id=_TENANT)

    assert len(rows) == 2
    assert rows[0] == {
        "case_id": _CASE_ID,
        "tenant_id": _TENANT,
        "criterion_id": "REQ-1",
        "text": "missing labs",
        "status": "gap",
        "evidence": {"search_attempted": True},
        "citations": [],
    }
    assert rows[1]["criterion_id"] == "REQ-2"
    assert rows[1]["evidence"] == {"search_attempted": False}


def test_completeness_none_maps_to_empty():
    result = AnalysisResult(analysis_id="an-1", status="complete", completeness=None)
    assert map_completeness_to_criteria(result, case_id=_CASE_ID, tenant_id=_TENANT) == []


def test_completeness_abstained_maps_to_empty():
    result = AnalysisResult(
        analysis_id="an-1",
        status="complete",
        completeness=CompletenessBlock(
            status="abstained",
            gaps=[Gap(requirement_id="REQ-1", description="x")],
        ),
    )
    assert map_completeness_to_criteria(result, case_id=_CASE_ID, tenant_id=_TENANT) == []


# ---------------------------------------------------------------------------
# Triage → suggestion
# ---------------------------------------------------------------------------
def test_triage_ok_maps_to_one_row():
    result = AnalysisResult(
        analysis_id="an-1",
        status="complete",
        triage=TriageBlock(
            status="ok",
            suggestion="likely_meets",
            confidence=0.9,
            rationale_assertion_ids=["A1", "A2"],
        ),
    )

    rows = map_triage_to_suggestion(result, case_id=_CASE_ID, tenant_id=_TENANT)

    assert len(rows) == 1
    row = rows[0]
    assert row["case_id"] == _CASE_ID
    assert row["tenant_id"] == _TENANT
    assert row["agent_id"] == "revital"
    assert "likely_meets" in row["title"]
    assert "A1" in row["body"] and "A2" in row["body"]
    assert row["confidence"] == 0.9
    assert row["citations"] == []


def test_triage_none_maps_to_empty():
    result = AnalysisResult(analysis_id="an-1", status="complete", triage=None)
    assert map_triage_to_suggestion(result, case_id=_CASE_ID, tenant_id=_TENANT) == []


def test_triage_abstained_maps_to_empty():
    result = AnalysisResult(
        analysis_id="an-1",
        status="complete",
        triage=TriageBlock(status="abstained", suggestion="likely_meets"),
    )
    assert map_triage_to_suggestion(result, case_id=_CASE_ID, tenant_id=_TENANT) == []


def test_triage_no_suggestion_maps_to_empty():
    result = AnalysisResult(
        analysis_id="an-1",
        status="complete",
        triage=TriageBlock(status="ok", suggestion=None, confidence=0.5),
    )
    assert map_triage_to_suggestion(result, case_id=_CASE_ID, tenant_id=_TENANT) == []


def test_triage_confidence_none_defaults_to_zero():
    result = AnalysisResult(
        analysis_id="an-1",
        status="complete",
        triage=TriageBlock(status="ok", suggestion="needs_rfi", confidence=None),
    )
    rows = map_triage_to_suggestion(result, case_id=_CASE_ID, tenant_id=_TENANT)
    assert rows[0]["confidence"] == 0.0
