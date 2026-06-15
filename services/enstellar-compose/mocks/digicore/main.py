from typing import Any, Literal
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Mock Digicore", description="Stub for local development — returns approve decisions")


class DecisionRequest(BaseModel):
    case_id: str
    service_code: str
    member_id: str
    plan_id: str
    tenant_id: str
    context: dict[str, Any] = {}


class StructuredTrace(BaseModel):
    artifact: str
    version: str
    source: str
    logic_branch: str


class DecisionResponse(BaseModel):
    decision: Literal["approved", "pending_review", "denied"]
    requirements: list[str]
    structured_trace: StructuredTrace


class CRDContent(BaseModel):
    pa_required: bool
    documentation_requirements: list[str]
    rule_reference: str
    dtr_launch_url: str | None = None


@app.post("/api/v1/decisions", response_model=DecisionResponse)
async def evaluate_request(req: DecisionRequest) -> DecisionResponse:
    return DecisionResponse(
        decision="approved",
        requirements=[],
        structured_trace=StructuredTrace(
            artifact="mock-policy-stub-v1",
            version="1.0.0",
            source="mock-digicore",
            logic_branch="auto-approve-stub",
        ),
    )


@app.get("/api/v1/crd", response_model=CRDContent)
async def get_crd_content(
    service_code: str,
    member_id: str,
    plan_id: str,
    tenant_id: str,
) -> CRDContent:
    return CRDContent(
        pa_required=True,
        documentation_requirements=["clinical-notes", "diagnosis-codes"],
        rule_reference="mock-rule-stub-v1",
        dtr_launch_url="http://localhost:8080/dtr/launch",
    )


@app.get("/api/v1/questionnaire")
async def get_questionnaire(
    service_code: str,
    plan_id: str,
    tenant_id: str,
) -> dict[str, Any]:
    """Return a representative Da Vinci DTR Questionnaire for the service.

    Real Digicore returns the full DTR package (Questionnaire + CQL Library). CQL
    executes client-side (in the DTR/EHR app) — this service only serves the artifact.
    """
    return {
        "resourceType": "Questionnaire",
        "id": "dtr-" + service_code,
        "url": "https://enstellar.simintero.com/Questionnaire/dtr-" + service_code,
        "version": "1.0.0",
        "status": "active",
        "effectivePeriod": {"start": "2026-01-01"},
        "title": "DTR documentation for " + service_code,
        "item": [
            {"linkId": "indication", "text": "Clinical indication", "type": "string",
             "required": True},
            {"linkId": "tried-conservative", "text": "Conservative therapy attempted?",
             "type": "boolean", "required": True},
            {"linkId": "diagnosis", "text": "Primary diagnosis (ICD-10)", "type": "string",
             "required": True},
        ],
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "mock-digicore"}
