"""Completeness agent evaluation metrics."""
from __future__ import annotations

from enstellar_agents.models import AgentOutput

from evals.dataset.base import EvalCase

THRESHOLDS: dict[str, float] = {
    "groundedness": 0.80,
    "precision": 0.75,
    "recall": 0.70,
    "abstention_accuracy": 0.85,
}


def compute_completeness_metrics(
    outputs: list[AgentOutput],
    cases: list[EvalCase],
) -> dict[str, dict]:
    """Compute groundedness, precision, recall, abstention_accuracy.

    Gap metrics (groundedness, precision, recall) skip abstaining cases.
    abstention_accuracy only counts cases where should_abstain=True.
    """
    assert len(outputs) == len(cases), "outputs and cases must have equal length"

    total_gaps = 0
    grounded_gaps = 0
    total_detected = 0
    total_expected = 0
    true_positives = 0
    should_abstain_count = 0
    correct_abstentions = 0

    for output, case in zip(outputs, cases):
        if case.should_abstain:
            should_abstain_count += 1
            if output.abstained:
                correct_abstentions += 1
            continue  # skip gap metrics for expected-abstain cases

        if output.abstained:
            continue  # unexpected abstention — skip gap metrics for this case

        gaps = output.result.get("gaps", []) if output.result else []
        expected_set = set(case.expected_gaps)

        for gap in gaps:
            total_gaps += 1
            if gap.get("citation"):
                grounded_gaps += 1
            dt = gap.get("required_document_type", "")
            total_detected += 1
            if dt in expected_set:
                true_positives += 1

        total_expected += len(expected_set)

    groundedness = grounded_gaps / total_gaps if total_gaps > 0 else 0.0
    precision = true_positives / total_detected if total_detected > 0 else 0.0
    recall = true_positives / total_expected if total_expected > 0 else 0.0
    abstention_accuracy = (
        correct_abstentions / should_abstain_count if should_abstain_count > 0 else 0.0
    )

    def _score(key: str, value: float) -> dict:
        return {
            "score": round(value, 4),
            "threshold": THRESHOLDS[key],
            "passed": value >= THRESHOLDS[key],
        }

    return {
        "groundedness": _score("groundedness", groundedness),
        "precision": _score("precision", precision),
        "recall": _score("recall", recall),
        "abstention_accuracy": _score("abstention_accuracy", abstention_accuracy),
    }
