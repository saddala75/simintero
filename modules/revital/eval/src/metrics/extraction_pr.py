from dataclasses import dataclass
from typing import List, Dict


@dataclass
class ExtractionMetrics:
    precision: float
    recall: float
    f1: float


def compute_extraction_pr(
    predicted: List[Dict],
    gold: List[Dict],
    match_key: str = "resource_type",
) -> ExtractionMetrics:
    """Compute precision/recall/F1 for extracted entities vs gold set."""
    pred_set = {(r[match_key], r.get("normalization", {}).get("code", "")) for r in predicted}
    gold_set = {(r[match_key], r.get("normalization", {}).get("code", "")) for r in gold}

    tp = len(pred_set & gold_set)
    precision = tp / len(pred_set) if pred_set else 0.0
    recall = tp / len(gold_set) if gold_set else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
    return ExtractionMetrics(precision=precision, recall=recall, f1=f1)
