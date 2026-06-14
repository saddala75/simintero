"""Runner integration tests — verifies full pipeline with mock adapter."""
from __future__ import annotations

import pytest

from evals.metrics.completeness import compute_completeness_metrics
from evals.metrics.guardrails import compute_guardrail_metrics
from evals.metrics.triage import compute_triage_metrics
from evals.runner import _run_all


async def test_run_all_returns_30_outputs():
    comp_outputs, triage_outputs, cases = await _run_all("mock", None)
    assert len(comp_outputs) == 30
    assert len(triage_outputs) == 30
    assert len(cases) == 30


async def test_all_7_metrics_pass_with_mock_adapter():
    comp_outputs, triage_outputs, cases = await _run_all("mock", None)

    comp_m = compute_completeness_metrics(comp_outputs, cases)
    triage_m = compute_triage_metrics(triage_outputs, cases)
    guardrail_m = compute_guardrail_metrics()
    all_metrics = {**comp_m, **triage_m, **guardrail_m}

    assert len(all_metrics) == 7
    failed = [k for k, v in all_metrics.items() if not v["passed"]]
    assert failed == [], f"Metrics below threshold: {failed}"


async def test_ambiguous_cases_produce_abstained_comp_output():
    comp_outputs, _, cases = await _run_all("mock", None)
    for output, case in zip(comp_outputs, cases):
        if case.should_abstain:
            assert output.abstained, f"{case.case_id} should have abstained"


async def test_triage_outputs_never_abstain_with_mock():
    _, triage_outputs, cases = await _run_all("mock", None)
    for output, case in zip(triage_outputs, cases):
        assert not output.abstained, f"{case.case_id} triage should not abstain"


async def test_triage_predicted_queues_match_urgency():
    queue_map = {
        "standard": "clinical_review",
        "expedited": "medical_director",
        "concurrent": "auto_approve",
    }
    _, triage_outputs, cases = await _run_all("mock", None)
    for output, case in zip(triage_outputs, cases):
        predicted = output.result.get("suggested_queue") if output.result else None
        assert predicted == queue_map[case.urgency], (
            f"{case.case_id}: urgency={case.urgency}, expected {queue_map[case.urgency]}, got {predicted}"
        )


import json
import os
from pathlib import Path
from uuid import uuid4

from enstellar_agents.models import AgentOutput
from evals.dataset.base import EvalCase
from evals.report import generate_report


def _make_report_inputs():
    cases = [EvalCase(
        case_id="syn-001", lob="commercial", urgency="standard",
        procedure_codes=["27447"], diagnosis_codes=["M17.11"],
        doc_requirements=["op_report"], expected_gaps=["op_report"],
        expected_queue="clinical_review", should_abstain=False,
    )]
    comp = [AgentOutput(
        agent_id="completeness-v1", tenant_id="tenant-eval", case_id=uuid4(),
        confidence=0.88, citations=["CriteriaCorp/op_report/v2024"], abstained=False,
        result={"gaps": [{"required_document_type": "op_report", "citation": "CriteriaCorp/op_report/v2024"}]},
        provenance={"model_name": "eval-mock", "timestamp": "2026-06-09T00:00:00Z"},
    )]
    triage = [AgentOutput(
        agent_id="triage-v1", tenant_id="tenant-eval", case_id=uuid4(),
        confidence=0.88, citations=["RoutingPolicy/urgency/standard"], abstained=False,
        result={"suggested_queue": "clinical_review"},
        provenance={"model_name": "eval-mock", "timestamp": "2026-06-09T00:00:00Z"},
    )]
    return cases, comp, triage


def test_generate_report_produces_json_file(tmp_path, monkeypatch):
    import evals.report as report_mod
    monkeypatch.setattr(report_mod, "RESULTS_DIR", tmp_path)
    cases, comp, triage = _make_report_inputs()
    metrics = {
        "groundedness": {"score": 1.0, "threshold": 0.80, "passed": True},
        "precision": {"score": 1.0, "threshold": 0.75, "passed": True},
        "recall": {"score": 1.0, "threshold": 0.70, "passed": True},
        "abstention_accuracy": {"score": 1.0, "threshold": 0.85, "passed": True},
        "routing_accuracy": {"score": 1.0, "threshold": 0.80, "passed": True},
        "guardrail_block_rate": {"score": 1.0, "threshold": 0.90, "passed": True},
        "guardrail_fp_rate": {"score": 0.0, "threshold": 0.05, "passed": True},
    }
    report = generate_report(
        metrics=metrics, cases=cases, comp_outputs=comp, triage_outputs=triage,
        adapter="mock", model=None, dataset_version="synthetic-v1",
    )
    assert report["passed"] is True
    latest = json.loads((tmp_path / "latest.json").read_text())
    assert latest["adapter"] == "mock"
    assert "metrics" in latest
    assert "cases" in latest


def test_generate_report_produces_markdown_file(tmp_path, monkeypatch):
    import evals.report as report_mod
    monkeypatch.setattr(report_mod, "RESULTS_DIR", tmp_path)
    cases, comp, triage = _make_report_inputs()
    metrics = {
        "groundedness": {"score": 0.87, "threshold": 0.80, "passed": True},
        "precision": {"score": 0.79, "threshold": 0.75, "passed": True},
        "recall": {"score": 0.72, "threshold": 0.70, "passed": True},
        "abstention_accuracy": {"score": 0.88, "threshold": 0.85, "passed": True},
        "routing_accuracy": {"score": 0.83, "threshold": 0.80, "passed": True},
        "guardrail_block_rate": {"score": 0.95, "threshold": 0.90, "passed": True},
        "guardrail_fp_rate": {"score": 0.02, "threshold": 0.05, "passed": True},
    }
    generate_report(
        metrics=metrics, cases=cases, comp_outputs=comp, triage_outputs=triage,
        adapter="mock", model=None, dataset_version="synthetic-v1",
    )
    md = (tmp_path / "latest.md").read_text()
    assert "## Agent Eval Results" in md
    assert "Groundedness" in md
    assert "PASSED (7/7)" in md


def test_generate_report_delta_is_none_when_no_baseline(tmp_path, monkeypatch):
    import evals.report as report_mod
    monkeypatch.setattr(report_mod, "RESULTS_DIR", tmp_path)
    cases, comp, triage = _make_report_inputs()
    metrics = {"groundedness": {"score": 0.85, "threshold": 0.80, "passed": True},
               "precision": {"score": 0.80, "threshold": 0.75, "passed": True},
               "recall": {"score": 0.72, "threshold": 0.70, "passed": True},
               "abstention_accuracy": {"score": 0.90, "threshold": 0.85, "passed": True},
               "routing_accuracy": {"score": 0.85, "threshold": 0.80, "passed": True},
               "guardrail_block_rate": {"score": 1.0, "threshold": 0.90, "passed": True},
               "guardrail_fp_rate": {"score": 0.0, "threshold": 0.05, "passed": True}}
    report = generate_report(
        metrics=metrics, cases=cases, comp_outputs=comp, triage_outputs=triage,
        adapter="mock", model=None, dataset_version="synthetic-v1",
    )
    assert report["metrics"]["groundedness"]["delta"] is None
