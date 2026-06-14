"""Tests for eval metric functions — deterministic formula verification."""
from __future__ import annotations

from uuid import uuid4

from enstellar_agents.models import AgentOutput

from evals.dataset.base import EvalCase
from evals.metrics.completeness import compute_completeness_metrics
from evals.metrics.triage import compute_triage_metrics


def _case(case_id, doc_reqs, expected_gaps, urgency="standard", should_abstain=False):
    return EvalCase(
        case_id=case_id, lob="commercial", urgency=urgency,
        procedure_codes=["27447"], diagnosis_codes=["M17.11"],
        doc_requirements=doc_reqs, expected_gaps=expected_gaps,
        expected_queue="clinical_review", should_abstain=should_abstain,
    )


def _output(confidence, citations, abstained, gaps):
    return AgentOutput(
        agent_id="test-v1", tenant_id="tenant-test", case_id=uuid4(),
        confidence=confidence, citations=citations, abstained=abstained,
        abstention_reason="low confidence" if abstained else None,
        result={"gaps": gaps} if not abstained else None,
        provenance={"model_name": "test", "timestamp": "2026-06-09T00:00:00Z"},
    )


def test_groundedness_perfect():
    cases = [_case("c1", ["op_report"], ["op_report"])]
    outputs = [_output(0.9, ["cite1"], False, [{"required_document_type": "op_report", "citation": "cite1"}])]
    m = compute_completeness_metrics(outputs, cases)
    assert m["groundedness"]["score"] == 1.0
    assert m["groundedness"]["passed"]


def test_groundedness_zero_when_no_citations():
    cases = [_case("c1", ["op_report"], ["op_report"])]
    outputs = [_output(0.9, ["cite1"], False, [{"required_document_type": "op_report", "citation": ""}])]
    m = compute_completeness_metrics(outputs, cases)
    assert m["groundedness"]["score"] == 0.0
    assert not m["groundedness"]["passed"]


def test_precision_perfect():
    cases = [_case("c1", ["op_report", "clinical_notes"], ["op_report", "clinical_notes"])]
    outputs = [_output(0.9, ["c"], False, [
        {"required_document_type": "op_report", "citation": "c"},
        {"required_document_type": "clinical_notes", "citation": "c"},
    ])]
    m = compute_completeness_metrics(outputs, cases)
    assert m["precision"]["score"] == 1.0
    assert m["precision"]["passed"]


def test_precision_partial():
    # detected=[A, B, C], expected=[A, B] → precision = 2/3 ≈ 0.667 < 0.75
    cases = [_case("c1", ["A", "B", "C"], ["A", "B"])]
    # But test_synthetic_non_ambiguous_gaps_equal_requirements prevents this in production dataset.
    # This test verifies the formula is correct.
    outputs = [_output(0.9, ["c"], False, [
        {"required_document_type": "A", "citation": "c"},
        {"required_document_type": "B", "citation": "c"},
        {"required_document_type": "C", "citation": "c"},
    ])]
    m = compute_completeness_metrics(outputs, cases)
    assert abs(m["precision"]["score"] - 0.6667) < 0.001
    assert not m["precision"]["passed"]


def test_recall_perfect():
    cases = [_case("c1", ["op_report"], ["op_report"])]
    outputs = [_output(0.9, ["c"], False, [{"required_document_type": "op_report", "citation": "c"}])]
    m = compute_completeness_metrics(outputs, cases)
    assert m["recall"]["score"] == 1.0
    assert m["recall"]["passed"]


def test_abstention_accuracy_perfect():
    cases = [_case("c1", [], [], should_abstain=True)]
    outputs = [_output(0.3, [], True, [])]
    m = compute_completeness_metrics(outputs, cases)
    assert m["abstention_accuracy"]["score"] == 1.0
    assert m["abstention_accuracy"]["passed"]


def test_abstention_accuracy_zero():
    cases = [_case("c1", [], [], should_abstain=True)]
    # Agent did NOT abstain when it should have
    outputs = [_output(0.9, ["c"], False, [])]
    m = compute_completeness_metrics(outputs, cases)
    assert m["abstention_accuracy"]["score"] == 0.0
    assert not m["abstention_accuracy"]["passed"]


def test_abstaining_cases_excluded_from_gap_metrics():
    cases = [_case("c1", [], [], should_abstain=True)]
    outputs = [_output(0.3, [], True, [])]
    m = compute_completeness_metrics(outputs, cases)
    # No gaps → groundedness, precision, recall all default to 0.0 but not counted as pass/fail
    # since there are no non-abstaining cases
    assert m["groundedness"]["score"] == 0.0
    assert m["precision"]["score"] == 0.0
    assert m["recall"]["score"] == 0.0


def test_routing_accuracy_perfect():
    cases = [_case("c1", [], [], urgency="standard")]
    outputs = [_output(0.9, ["c"], False, [])]
    # Override result for triage: set suggested_queue
    outputs[0] = AgentOutput(
        agent_id="triage-v1", tenant_id="tenant-test", case_id=uuid4(),
        confidence=0.9, citations=["c"], abstained=False,
        result={"suggested_queue": "clinical_review"},
        provenance={"model_name": "test", "timestamp": "2026-06-09T00:00:00Z"},
    )
    m = compute_triage_metrics(outputs, cases)
    assert m["routing_accuracy"]["score"] == 1.0
    assert m["routing_accuracy"]["passed"]


def test_routing_accuracy_zero():
    cases = [_case("c1", [], [], urgency="standard")]
    outputs = [AgentOutput(
        agent_id="triage-v1", tenant_id="tenant-test", case_id=uuid4(),
        confidence=0.9, citations=["c"], abstained=False,
        result={"suggested_queue": "medical_director"},  # wrong
        provenance={"model_name": "test", "timestamp": "2026-06-09T00:00:00Z"},
    )]
    m = compute_triage_metrics(outputs, cases)
    assert m["routing_accuracy"]["score"] == 0.0
    assert not m["routing_accuracy"]["passed"]


def test_routing_accuracy_abstained_counts_as_wrong():
    cases = [_case("c1", [], [], urgency="standard")]
    outputs = [_output(0.3, [], True, [])]
    m = compute_triage_metrics(outputs, cases)
    assert m["routing_accuracy"]["score"] == 0.0


from evals.metrics.guardrails import compute_guardrail_metrics


def test_guardrail_block_rate_passes_threshold():
    m = compute_guardrail_metrics()
    assert m["guardrail_block_rate"]["score"] >= 0.90
    assert m["guardrail_block_rate"]["passed"]


def test_guardrail_fp_rate_passes_threshold():
    m = compute_guardrail_metrics()
    assert m["guardrail_fp_rate"]["score"] <= 0.05
    assert m["guardrail_fp_rate"]["passed"]


def test_guardrail_low_confidence_fixtures_are_blocked():
    """Fixtures with confidence=0.6 (below 0.7 threshold) must be blocked."""
    from evals.metrics.guardrails import _make_fixtures
    from enstellar_agents.guardrails.engine import GuardrailEngine
    invalid, _ = _make_fixtures()
    low_conf = [f for f in invalid if f.confidence == 0.6]
    engine = GuardrailEngine()
    for f in low_conf:
        result = engine.check(f, "tenant-eval")
        assert not result.passed, f"Expected blocked but passed: {result.violations}"


def test_guardrail_valid_fixtures_are_not_blocked():
    from evals.metrics.guardrails import _make_fixtures
    from enstellar_agents.guardrails.engine import GuardrailEngine
    _, valid = _make_fixtures()
    engine = GuardrailEngine()
    for f in valid:
        result = engine.check(f, "tenant-eval")
        assert result.passed, f"False positive: {result.violations}"
