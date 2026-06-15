"""Triage agent evaluation metrics."""
from __future__ import annotations

from enstellar_agents.models import AgentOutput

from evals.dataset.base import EvalCase

THRESHOLDS: dict[str, float] = {"routing_accuracy": 0.80}


def compute_triage_metrics(
    outputs: list[AgentOutput],
    cases: list[EvalCase],
) -> dict[str, dict]:
    """Compute routing_accuracy: fraction of cases where predicted queue matches expected."""
    assert len(outputs) == len(cases)

    correct = 0
    total = len(cases)

    for output, case in zip(outputs, cases):
        predicted = None
        if not output.abstained and output.result:
            predicted = output.result.get("suggested_queue")
        if predicted == case.expected_queue:
            correct += 1

    score = correct / total if total > 0 else 0.0
    return {
        "routing_accuracy": {
            "score": round(score, 4),
            "threshold": THRESHOLDS["routing_accuracy"],
            "passed": score >= THRESHOLDS["routing_accuracy"],
        }
    }
