"""Eval report generator — writes JSON and markdown output with run-over-run deltas."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from enstellar_agents.models import AgentOutput

from evals.dataset.base import EvalCase

logger = logging.getLogger(__name__)

RESULTS_DIR = Path(__file__).parent / "results"

_METRIC_LABELS = {
    "groundedness": "Groundedness",
    "precision": "Precision",
    "recall": "Recall",
    "abstention_accuracy": "Abstention accuracy",
    "routing_accuracy": "Routing accuracy",
    "guardrail_block_rate": "Guardrail block rate",
    "guardrail_fp_rate": "Guardrail FP rate",
}
_THRESHOLD_DISPLAY = {
    "groundedness": "≥ 0.80",
    "precision": "≥ 0.75",
    "recall": "≥ 0.70",
    "abstention_accuracy": "≥ 0.85",
    "routing_accuracy": "≥ 0.80",
    "guardrail_block_rate": "≥ 0.90",
    "guardrail_fp_rate": "≤ 0.05",
}


def _load_baseline() -> dict | None:
    baseline_path = RESULTS_DIR / "latest.json"
    if not baseline_path.exists():
        return None
    try:
        with open(baseline_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _build_case_records(
    cases: list[EvalCase],
    comp_outputs: list[AgentOutput],
    triage_outputs: list[AgentOutput],
) -> list[dict]:
    records = []
    for case, comp_out, triage_out in zip(cases, comp_outputs, triage_outputs):
        gaps_detected = []
        if not comp_out.abstained and comp_out.result:
            gaps_detected = [
                g.get("required_document_type", "")
                for g in comp_out.result.get("gaps", [])
            ]
        predicted_queue = None
        if not triage_out.abstained and triage_out.result:
            predicted_queue = triage_out.result.get("suggested_queue")
        records.append({
            "case_id": case.case_id,
            "gaps_detected": gaps_detected,
            "gaps_expected": case.expected_gaps,
            "queue_predicted": predicted_queue,
            "queue_expected": case.expected_queue,
            "abstained": comp_out.abstained,
            "citations": comp_out.citations,
        })
    return records


def _build_markdown(report: dict, metrics: dict) -> str:
    run_id = report["run_id"]
    adapter = report["adapter"]
    model = report["model"]
    dataset_version = report["dataset_version"]
    all_passed = report["passed"]

    lines = [
        f"## Agent Eval Results — {run_id}",
        f"Adapter: {adapter} | Model: {model} | Dataset: {dataset_version}",
        "",
        "| Metric | Score | Threshold | Δ | Status |",
        "|--------|-------|-----------|---|--------|",
    ]
    for key, val in metrics.items():
        label = _METRIC_LABELS.get(key, key)
        score = f"{val['score']:.2f}"
        threshold = _THRESHOLD_DISPLAY.get(key, str(val["threshold"]))
        delta = f"{val['delta']:+.2f}" if val.get("delta") is not None else "—"
        status = "✅" if val["passed"] else "❌"
        lines.append(f"| {label} | {score} | {threshold} | {delta} | {status} |")

    passed_count = sum(1 for v in metrics.values() if v["passed"])
    total_count = len(metrics)
    overall = "PASSED" if all_passed else "FAILED"
    lines.extend(["", f"Overall: {overall} ({passed_count}/{total_count})", ""])
    return "\n".join(lines)


def generate_report(
    *,
    metrics: dict,
    cases: list[EvalCase],
    comp_outputs: list[AgentOutput],
    triage_outputs: list[AgentOutput],
    adapter: str,
    model: str | None,
    dataset_version: str,
) -> dict:
    """Write eval-{timestamp}.json, latest.json, and latest.md; return the report dict."""
    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    baseline = _load_baseline()

    metrics_with_delta: dict[str, dict] = {}
    for key, val in metrics.items():
        delta = None
        if baseline and "metrics" in baseline and key in baseline["metrics"]:
            delta = round(val["score"] - baseline["metrics"][key]["score"], 4)
        metrics_with_delta[key] = {**val, "delta": delta}

    all_passed = all(v["passed"] for v in metrics.values())
    report = {
        "run_id": run_id,
        "adapter": adapter,
        "model": model or "default",
        "dataset_version": dataset_version,
        "passed": all_passed,
        "metrics": metrics_with_delta,
        "cases": _build_case_records(cases, comp_outputs, triage_outputs),
    }

    RESULTS_DIR.mkdir(exist_ok=True)

    ts = run_id.replace(":", "").replace("T", "-").rstrip("Z")
    with open(RESULTS_DIR / f"eval-{ts}.json", "w") as f:
        json.dump(report, f, indent=2)
    with open(RESULTS_DIR / "latest.json", "w") as f:
        json.dump(report, f, indent=2)

    md = _build_markdown(report, metrics_with_delta)
    with open(RESULTS_DIR / "latest.md", "w") as f:
        f.write(md)

    passed_count = sum(1 for v in metrics.values() if v["passed"])
    total_count = len(metrics)
    status_str = "PASSED" if all_passed else "FAILED"
    logger.info("Eval %s (%d/%d metrics passed)", status_str, passed_count, total_count)
    for key, val in metrics_with_delta.items():
        status = "PASS" if val["passed"] else "FAIL"
        delta_str = f"  Δ{val['delta']:+.4f}" if val["delta"] is not None else ""
        logger.info(
            "  %-24s %.4f (threshold %s)%s [%s]",
            _METRIC_LABELS.get(key, key), val["score"],
            _THRESHOLD_DISPLAY.get(key, str(val["threshold"])), delta_str, status,
        )

    return report
