"""Platform dashboard — aggregated daily summary for the post-login landing page."""
from __future__ import annotations
from fastapi import APIRouter, Depends
from enstellar_bff.auth import require_reviewer

router = APIRouter(prefix="/bff/dashboard", tags=["dashboard"])

_MOCK = {
    "queue": {
        "total_open": 18,
        "urgent": 4,
        "sla_at_risk": 3,
        "avg_age_hours": 14.2,
    },
    "my_cases": [
        {
            "case_id": "PA-24-00918",
            "member_name": "James Morrison",
            "lob": "medicare",
            "request_type": "Prior Auth",
            "priority": "urgent",
            "sla_remaining_hours": 1.5,
            "status": "pending_review",
        },
        {
            "case_id": "PA-24-00891",
            "member_name": "Linda Hartwell",
            "lob": "commercial",
            "request_type": "Prior Auth",
            "priority": "urgent",
            "sla_remaining_hours": 3.0,
            "status": "rfi_sent",
        },
        {
            "case_id": "UM-24-00204",
            "member_name": "Robert Okafor",
            "lob": "medicaid",
            "request_type": "UM Review",
            "priority": "normal",
            "sla_remaining_hours": 22.0,
            "status": "in_review",
        },
        {
            "case_id": "PA-24-00877",
            "member_name": "Susan Park",
            "lob": "medicare",
            "request_type": "Prior Auth",
            "priority": "normal",
            "sla_remaining_hours": 31.0,
            "status": "pending_review",
        },
        {
            "case_id": "UM-24-00198",
            "member_name": "David Nguyen",
            "lob": "commercial",
            "request_type": "UM Review",
            "priority": "normal",
            "sla_remaining_hours": 38.5,
            "status": "pending_review",
        },
    ],
    "appeals": {"open": 6, "overdue": 1},
    "grievances": {"open": 3, "unacknowledged": 1},
    "ai": {
        "avg_groundedness": 0.82,
        "cases_reviewed_today": 14,
        "cases_with_gaps": 3,
    },
    "policies": {
        "active": 1482,
        "drafts_pending": 24,
        "elm_compliance": 99.8,
    },
    "quality": {
        "active_measures": 5,
        "care_gaps_open": 142,
        "top_gap_measure": "COL",
    },
    "recent_activity": [
        {
            "time": "09:41",
            "actor": "Dr. Sarah Jenkins",
            "action": "approved",
            "case_id": "PA-24-00901",
            "member_name": "Helen Roberts",
        },
        {
            "time": "09:28",
            "actor": "Dr. Michael Chen",
            "action": "sent_rfi",
            "case_id": "PA-24-00897",
            "member_name": "Thomas Wallis",
        },
        {
            "time": "09:12",
            "actor": "System",
            "action": "sla_breach",
            "case_id": "PA-24-00883",
            "member_name": "Carol Simmons",
        },
        {
            "time": "08:54",
            "actor": "Dr. Amy Rodriguez",
            "action": "denied",
            "case_id": "UM-24-00196",
            "member_name": "Frank Deluca",
        },
        {
            "time": "08:33",
            "actor": "Dr. Sarah Jenkins",
            "action": "approved",
            "case_id": "PA-24-00879",
            "member_name": "Patricia Moore",
        },
    ],
}


@router.get("")
async def get_dashboard(_auth: tuple = Depends(require_reviewer)):
    """Aggregated daily summary for the platform dashboard."""
    return _MOCK
