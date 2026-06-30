"""BFF DTR router — proxies Questionnaire fetch + QuestionnaireResponse submit to interop.

Falls back to service-specific mock questionnaires when the FHIR upstream is unavailable
(interop service unhealthy). This keeps the EHR Simulator demo usable in all environments.
"""
from typing import Any

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException

from enstellar_bff.auth import require_reviewer
from enstellar_bff.clients.fhir import fhir_client

router = APIRouter(prefix="/bff/dtr", tags=["dtr"])

# Service-code-specific mock questionnaires used when the FHIR upstream is unavailable.
_MOCK_QUESTIONNAIRES: dict[str, dict] = {
    "default": {
        "resourceType": "Questionnaire",
        "url": "http://simintero.local/Questionnaire/pa-default",
        "title": "Prior Authorization Documentation",
        "item": [
            {"linkId": "indication", "text": "Clinical indication for this service", "type": "string"},
            {"linkId": "conservative_tx", "text": "Conservative treatment has been attempted", "type": "boolean"},
            {"linkId": "conservative_duration", "text": "Duration of conservative treatment (weeks)", "type": "string"},
            {"linkId": "symptom_duration", "text": "Duration of symptoms (weeks)", "type": "string"},
            {"linkId": "prior_imaging", "text": "Prior relevant imaging or workup performed", "type": "boolean"},
            {"linkId": "attestation", "text": "I attest that the information provided is accurate and complete", "type": "boolean"},
        ],
    },
    "72148": {
        "resourceType": "Questionnaire",
        "url": "http://simintero.local/Questionnaire/lumbar-mri",
        "title": "Lumbar Spine MRI — Prior Authorization",
        "item": [
            {"linkId": "diagnosis", "text": "Primary diagnosis (ICD-10)", "type": "string"},
            {"linkId": "conservative_tx", "text": "Conservative therapy (PT/chiro) attempted for ≥ 6 weeks", "type": "boolean"},
            {"linkId": "conservative_duration", "text": "Duration of conservative therapy (weeks)", "type": "string"},
            {"linkId": "red_flags", "text": "Red flag symptoms present (cauda equina, progressive neuro deficit)", "type": "boolean"},
            {"linkId": "prior_xray", "text": "Plain film X-ray performed in past 6 months", "type": "boolean"},
            {"linkId": "functional_limitation", "text": "Describe functional limitations impacting daily activities", "type": "string"},
            {"linkId": "attestation", "text": "I attest that the information provided is accurate and complete", "type": "boolean"},
        ],
    },
    "73721": {
        "resourceType": "Questionnaire",
        "url": "http://simintero.local/Questionnaire/knee-mri",
        "title": "Knee MRI — Prior Authorization",
        "item": [
            {"linkId": "diagnosis", "text": "Primary diagnosis (ICD-10)", "type": "string"},
            {"linkId": "laterality", "text": "Laterality (Right / Left / Bilateral)", "type": "string"},
            {"linkId": "mechanism", "text": "Mechanism of injury or onset of symptoms", "type": "string"},
            {"linkId": "conservative_tx", "text": "Conservative treatment attempted (RICE, PT, NSAIDs)", "type": "boolean"},
            {"linkId": "prior_xray", "text": "Plain film X-ray performed", "type": "boolean"},
            {"linkId": "attestation", "text": "I attest that the information provided is accurate and complete", "type": "boolean"},
        ],
    },
    "97001": {
        "resourceType": "Questionnaire",
        "url": "http://simintero.local/Questionnaire/pt-eval",
        "title": "Physical Therapy Evaluation — Authorization",
        "item": [
            {"linkId": "diagnosis", "text": "Diagnosis requiring PT (ICD-10)", "type": "string"},
            {"linkId": "functional_goals", "text": "Functional goals of therapy", "type": "string"},
            {"linkId": "sessions_requested", "text": "Number of sessions requested", "type": "string"},
            {"linkId": "prior_pt", "text": "Member has received PT for this condition in the past 12 months", "type": "boolean"},
            {"linkId": "attestation", "text": "I attest that the information provided is accurate and complete", "type": "boolean"},
        ],
    },
    "27447": {
        "resourceType": "Questionnaire",
        "url": "http://simintero.local/Questionnaire/tka",
        "title": "Total Knee Arthroplasty — Prior Authorization",
        "item": [
            {"linkId": "diagnosis", "text": "Diagnosis (e.g. severe osteoarthritis, ICD-10)", "type": "string"},
            {"linkId": "conservative_tx", "text": "Conservative treatment (PT, injections, NSAIDs) exhausted", "type": "boolean"},
            {"linkId": "conservative_duration", "text": "Duration of conservative management (months)", "type": "string"},
            {"linkId": "functional_limitation", "text": "Functional limitation score (0-10)", "type": "string"},
            {"linkId": "imaging_confirms", "text": "Imaging confirms joint space narrowing or bone-on-bone", "type": "boolean"},
            {"linkId": "bmi", "text": "Patient BMI", "type": "string"},
            {"linkId": "attestation", "text": "I attest that the information provided is accurate and complete", "type": "boolean"},
        ],
    },
}


def _mock_questionnaire(context: str) -> dict:
    return _MOCK_QUESTIONNAIRES.get(context, _MOCK_QUESTIONNAIRES["default"])


@router.get("/questionnaire")
async def get_questionnaire(
    context: str,
    plan: str,
    auth: tuple = Depends(require_reviewer),
) -> dict[str, Any]:
    ctx, _bearer = auth
    try:
        q = await fhir_client.get_questionnaire(context, plan, ctx.tenant_id)
        if q:
            return q
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException):
        pass  # fall through to mock
    return _mock_questionnaire(context)


@router.post("/questionnaire-response")
async def post_questionnaire_response(
    qr: dict = Body(...),
    auth: tuple = Depends(require_reviewer),
) -> dict[str, Any]:
    ctx, _bearer = auth
    try:
        return await fhir_client.post_questionnaire_response(qr, ctx.tenant_id)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        status = getattr(getattr(exc, "response", None), "status_code", 502)
        if status == 422:
            raise HTTPException(status_code=422, detail="DTR submit failed") from exc
    # Upstream unavailable — acknowledge locally so the demo flow completes
    return {"resourceType": "QuestionnaireResponse", "status": "completed", "id": "mock-qr-1"}
