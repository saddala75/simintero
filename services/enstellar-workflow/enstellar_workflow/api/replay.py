"""On-demand replay of a case evaluation using pinned artifact versions (P2.7).

Reads artifact_pins stored at original determination time, calls Digicore
with those pins so PinResolver bypasses VKAS and uses the original artifact
version. Returns the evaluation result without mutating any case state.

Returns 422 if no artifact_pins are stored (case predates this feature).
Returns 404 if the case_id is not found in this tenant's scope.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from enstellar_connectors.digicore.client import DigiCoreClient
from enstellar_connectors.digicore.models import EvaluationRequest
from simintero_tenant_context import tenant_transaction

from ..auth import ReviewerRequest
from ..db.connection import get_pool

router = APIRouter(prefix="/cases", tags=["replay"])

# Module-level singleton — same pattern as DigiCoreClient usage in main.py.
# Patched in tests via unittest.mock.patch("enstellar_workflow.api.replay._digicore").
_digicore = DigiCoreClient()

# Synthetic identifier system under which the normalisation mapper stashes the
# bundle Patient's FHIR logical id (kept in sync with auto_determination.py).
_FHIR_LOGICAL_ID_SYSTEM = "urn:enstellar:fhir-logical-id"


def _stable_member_ref(case_data: dict) -> str | None:
    """Extract the bundle Patient's FHIR logical id from a serialised case_json dict.

    Returns None when no stable reference is available; the Digicore connector
    then falls back to member_id. Mirrors _stable_member_ref in auto_determination.
    """
    identifiers = (case_data.get("member") or {}).get("identifiers") or []
    for ident in identifiers:
        if ident.get("system") == _FHIR_LOGICAL_ID_SYSTEM:
            return ident.get("value")
    return None


@router.get("/{case_id}/replay-evaluation", response_model=None)
async def replay_evaluation(
    case_id: uuid.UUID,
    auth: ReviewerRequest,
) -> dict:
    """Replay a case evaluation using the artifact versions pinned at decision time.

    Fetches the artifact-version URNs stored when the original auto-determination
    ran and calls Digicore with those pins so PinResolver bypasses VKAS and
    evaluates against the exact original policy version.

    This endpoint is READ-ONLY: it emits no state transitions, no outbox events,
    and makes no writes to workflow_instances.

    Returns:
        200 — raw EvaluationResponse from Digicore.
        404 — case not found in this tenant's scope.
        422 — no artifact pins stored; case predates this feature.
    """
    tenant_id = auth.tenant_id
    pool = await get_pool()

    async with tenant_transaction(pool, tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT artifact_pins, case_json"
            " FROM workflow_instances"
            " WHERE case_id = $1 AND tenant_id = $2",
            case_id,
            tenant_id,
        )

    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")

    artifact_pins: list[str] = list(row["artifact_pins"] or [])
    if not artifact_pins:
        raise HTTPException(
            status_code=422,
            detail="No artifact pins stored; case may predate this feature",
        )

    # Parse case_json (asyncpg may return it as dict or str depending on codec).
    case_data: dict = row["case_json"]
    if isinstance(case_data, str):
        import json as _json
        case_data = _json.loads(case_data)

    service_lines = case_data.get("service_lines") or []
    service_code: str = (
        (service_lines[0].get("procedure_code") or "") if service_lines else ""
    )
    member_ref = _stable_member_ref(case_data)

    req = EvaluationRequest(
        caseId=str(case_id),
        serviceCode=service_code,
        pins=artifact_pins,
        member_ref=member_ref,
        tenant_id=tenant_id,
    )
    result = await _digicore.evaluate_raw(req)
    return result.model_dump()
