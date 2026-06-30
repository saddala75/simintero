"""Revital AI performance & oversight endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from enstellar_bff.auth import require_reviewer, BffContext

router = APIRouter(prefix="/bff/ai", tags=["revital"])

_MOCK_PERFORMANCE = {
    "summary": {
        "total_reviewed": 47,
        "avg_groundedness": 0.82,
        "avg_completeness_rate": 0.74,
        "citation_acceptance_rate": 0.68,
        "alignment_rate": 0.79,
        "cases_needing_review": 6,
    },
    "recent_cases": [
        {"case_id": "360ccd24-98ac-420f-811b-02f4bb7bfb90", "member_name": "Jane Smith", "service": "Total Knee Arthroplasty", "groundedness": 0.91, "citations_count": 5, "gaps_count": 0, "conflicts_count": 0, "ai_recommendation": "approve", "human_decision": "approved", "aligned": True, "reviewed_at": "2026-06-28T14:30:00Z"},
        {"case_id": "e0e80268-5378-46e5-b7b7-04dbc8add48c", "member_name": "Robert Chen", "service": "Lumbar Spine MRI", "groundedness": 0.76, "citations_count": 3, "gaps_count": 2, "conflicts_count": 1, "ai_recommendation": "approve", "human_decision": "approved", "aligned": True, "reviewed_at": "2026-06-28T13:15:00Z"},
        {"case_id": "a1b2c3d4-0001-0001-0001-000000000001", "member_name": "Maria Garcia", "service": "Physical Therapy – Cervical", "groundedness": 0.44, "citations_count": 1, "gaps_count": 4, "conflicts_count": 2, "ai_recommendation": "deny", "human_decision": "approved", "aligned": False, "reviewed_at": "2026-06-28T11:00:00Z"},
        {"case_id": "a1b2c3d4-0002-0002-0002-000000000002", "member_name": "David Lee", "service": "Bariatric Surgery", "groundedness": 0.88, "citations_count": 6, "gaps_count": 1, "conflicts_count": 0, "ai_recommendation": "approve", "human_decision": "approved", "aligned": True, "reviewed_at": "2026-06-27T16:45:00Z"},
        {"case_id": "a1b2c3d4-0003-0003-0003-000000000003", "member_name": "Susan Park", "service": "Advanced Imaging – Brain MRI", "groundedness": 0.31, "citations_count": 0, "gaps_count": 5, "conflicts_count": 3, "ai_recommendation": None, "human_decision": "pending", "aligned": None, "reviewed_at": "2026-06-27T14:20:00Z"},
        {"case_id": "a1b2c3d4-0004-0004-0004-000000000004", "member_name": "James Wilson", "service": "Cardiac Catheterization", "groundedness": 0.95, "citations_count": 7, "gaps_count": 0, "conflicts_count": 0, "ai_recommendation": "approve", "human_decision": "approved", "aligned": True, "reviewed_at": "2026-06-27T10:30:00Z"},
        {"case_id": "a1b2c3d4-0005-0005-0005-000000000005", "member_name": "Lisa Brown", "service": "Sleep Study – Level II", "groundedness": 0.62, "citations_count": 2, "gaps_count": 3, "conflicts_count": 1, "ai_recommendation": "deny", "human_decision": "denied", "aligned": True, "reviewed_at": "2026-06-26T15:00:00Z"},
        {"case_id": "a1b2c3d4-0006-0006-0006-000000000006", "member_name": "Tom Martinez", "service": "Hip Replacement – Total", "groundedness": 0.39, "citations_count": 1, "gaps_count": 4, "conflicts_count": 2, "ai_recommendation": "approve", "human_decision": "pending", "aligned": None, "reviewed_at": "2026-06-26T09:15:00Z"},
    ],
    "top_evidence_sources": [
        {"title": "InterQual Spine Guidelines 2025", "citations": 23, "cases": 18},
        {"title": "CMS LCD L38054 – PT/OT", "citations": 17, "cases": 14},
        {"title": "MCG Bariatric Surgery 27th Ed", "citations": 14, "cases": 11},
        {"title": "AHA/ACC Cardiac Cath Criteria", "citations": 12, "cases": 10},
        {"title": "AASM Sleep Study Indications", "citations": 9, "cases": 8},
        {"title": "ACR Appropriateness Criteria – Brain MRI", "citations": 6, "cases": 6},
    ],
    "weekly_trend": [
        {"week": "Jun 1", "cases": 5, "avg_groundedness": 0.71},
        {"week": "Jun 8", "cases": 8, "avg_groundedness": 0.75},
        {"week": "Jun 15", "cases": 11, "avg_groundedness": 0.79},
        {"week": "Jun 22", "cases": 14, "avg_groundedness": 0.82},
        {"week": "Jun 29", "cases": 9, "avg_groundedness": 0.84},
    ],
}


@router.get("/performance")
async def get_ai_performance(
    _auth: tuple = Depends(require_reviewer),
):
    """Aggregate Revital AI performance metrics."""
    return _MOCK_PERFORMANCE
