from typing import List, Dict


def compute_citation_validity_pct(assertions: List[Dict]) -> float:
    """Percentage of assertions that have at least one citation (INV-2 compliance)."""
    if not assertions:
        return 1.0  # vacuously valid
    cited = sum(1 for a in assertions if len(a.get("citations", [])) >= 1)
    return cited / len(assertions)
