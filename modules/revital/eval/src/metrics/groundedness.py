from typing import List, Dict


def compute_groundedness_score(
    assertions: List[Dict],
    spans: Dict[str, List[Dict]],
) -> float:
    """Fraction of assertion citations that resolve to a real span."""
    if not assertions:
        return 1.0
    total, valid = 0, 0
    for assertion in assertions:
        for citation in assertion.get("citations", []):
            total += 1
            doc_spans = spans.get(citation.get("document_ref", ""), [])
            if any(s["page"] == citation.get("page") for s in doc_spans):
                valid += 1
    return valid / total if total > 0 else 1.0
