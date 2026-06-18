"""Pure mappers: Revital AnalysisResult → case_criteria / case_suggestions rows.

The RevitalPoller calls these and hands the rows straight to
CriteriaRepository.insert_many / SuggestionsRepository.insert_many. No DB or
side effects here so they are trivially unit-testable.

ADVISORY ONLY: these rows are advisory and never used to commit a determination.
"""
from __future__ import annotations

import uuid
from typing import Any

from enstellar_connectors.revital.models import AnalysisResult


def map_completeness_to_criteria(
    result: AnalysisResult, *, case_id: uuid.UUID, tenant_id: str
) -> list[dict[str, Any]]:
    """Map a completeness block's gaps to case_criteria rows.

    Returns [] when there is no completeness block or the agent abstained.
    """
    c = result.completeness
    if c is None or c.status == "abstained":
        return []
    return [
        {
            "case_id": case_id,
            "tenant_id": tenant_id,
            "criterion_id": g.requirement_id,
            "text": g.description,
            "status": "gap",
            "evidence": {"search_attempted": g.search_attempted},
            "citations": [],
        }
        for g in c.gaps
    ]


def map_triage_to_suggestion(
    result: AnalysisResult, *, case_id: uuid.UUID, tenant_id: str
) -> list[dict[str, Any]]:
    """Map a triage block to a single case_suggestions row.

    Returns [] when there is no triage block, the agent abstained, or there is
    no suggestion.
    """
    t = result.triage
    if t is None or t.status == "abstained" or not t.suggestion:
        return []
    return [
        {
            "case_id": case_id,
            "tenant_id": tenant_id,
            "agent_id": "revital",
            "title": f"Suggested: {t.suggestion}",
            "body": "See rationale assertions: "
            + ", ".join(t.rationale_assertion_ids or []),
            "confidence": float(t.confidence or 0.0),
            "citations": [],
        }
    ]
