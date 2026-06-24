"""Unit tests for Revital C-2 Pydantic models — no HTTP, no network.

Covers AnalysisResult and its nested completeness/triage blocks, plus the
RevitalUnavailableError advisory contract.
"""
import pytest

from enstellar_connectors.revital.models import (
    AnalysisResult,
    CompletenessBlock,
    Gap,
    RevitalUnavailableError,
    Satisfied,
    TriageBlock,
)


# ─── AnalysisResult ──────────────────────────────────────────────────────────


def test_analysis_result_full_parse():
    raw = {
        "analysis_id": "ana_1",
        "classification": "prior_auth",
        "status": "complete",
        "case_ref": "corr-1",
        "interaction": {"x": 1},
        "summary": {"text": "s"},
        "extraction": {"e": []},
        "completeness": {
            "status": "ok",
            "satisfied": [{"requirement_id": "req-ok", "evidence_refs": ["e1"]}],
            "gaps": [
                {"requirement_id": "req-1", "description": "missing", "search_attempted": True}
            ],
            "conflicts": [{"description": "c", "refs": ["r1"]}],
            "against": {"k": "v"},
        },
        "triage": {
            "status": "ok",
            "suggestion": "likely_meets",
            "confidence": 0.9,
            "calibration_ref": "cal-1",
            "rationale_assertion_ids": ["a1"],
        },
        "abstentions": [],
        "unprocessed_inputs": [],
    }
    r = AnalysisResult.model_validate(raw)
    assert r.analysis_id == "ana_1"
    assert r.status == "complete"
    assert r.case_ref == "corr-1"
    assert r.completeness.status == "ok"
    assert r.completeness.gaps[0].requirement_id == "req-1"
    assert r.completeness.gaps[0].search_attempted is True
    assert r.completeness.satisfied[0].evidence_refs == ["e1"]
    assert r.completeness.conflicts == [{"description": "c", "refs": ["r1"]}]
    assert r.triage.suggestion == "likely_meets"
    assert r.triage.confidence == 0.9
    assert r.triage.rationale_assertion_ids == ["a1"]


def test_analysis_result_minimal_processing():
    r = AnalysisResult.model_validate({"analysis_id": "ana_2", "status": "processing"})
    assert r.status == "processing"
    assert r.case_ref is None
    assert r.completeness is None
    assert r.triage is None


def test_analysis_result_ignores_extra_fields():
    r = AnalysisResult.model_validate(
        {"analysis_id": "ana_3", "status": "partial", "totally_unknown": {"a": 1}}
    )
    assert r.status == "partial"
    assert not hasattr(r, "totally_unknown")


def test_completeness_block_defaults():
    cb = CompletenessBlock(status="abstained")
    assert cb.gaps == []
    assert cb.satisfied == []
    assert cb.conflicts == []


def test_triage_block_abstained_optional_fields():
    t = TriageBlock(status="abstained")
    assert t.suggestion is None
    assert t.confidence is None
    assert t.rationale_assertion_ids is None


def test_gap_and_satisfied_models():
    g = Gap(requirement_id="r", description="d")
    assert g.search_attempted is False
    s = Satisfied(requirement_id="r")
    assert s.evidence_refs == []


# ─── RevitalUnavailableError ─────────────────────────────────────────────────


def test_revital_unavailable_error_is_exception():
    err = RevitalUnavailableError("circuit open")
    assert isinstance(err, Exception)
    assert str(err) == "circuit open"


def test_revital_unavailable_error_can_be_caught_as_exception():
    with pytest.raises(Exception):
        raise RevitalUnavailableError("test fallback")


def test_revital_unavailable_error_preserves_cause():
    import httpx

    original = httpx.ConnectError("connection refused")
    wrapped = RevitalUnavailableError("revital unreachable")
    wrapped.__cause__ = original
    assert wrapped.__cause__ is original


# ─── Interaction / ModelRef provenance (slice S5) ────────────────────────────


def test_analysis_result_exposes_interaction():
    """AnalysisResult must expose the interaction provenance block, not drop it."""
    r = AnalysisResult.model_validate(
        {
            "analysis_id": "a",
            "status": "complete",
            "interaction": {
                "model_binding": {"canonical_url": "u", "version": "1.0.0"},
                "prompt": {"canonical_url": "p", "version": "1.0.0"},
            },
        }
    )
    assert r.interaction is not None
    assert r.interaction.model_binding.version == "1.0.0"
    assert r.interaction.prompt.canonical_url == "p"


def test_analysis_result_interaction_absent_is_none():
    """AnalysisResult without interaction key → .interaction is None."""
    r = AnalysisResult.model_validate({"analysis_id": "a", "status": "complete"})
    assert r.interaction is None
