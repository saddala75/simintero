"""Mock Revital server for local development.

Returns spec-conformant SummarizeResponse shapes:
  - citations: list[str]
  - completeness: float (0.0–1.0)
  - triage: str

Run via docker compose (make up) at http://mock-revital:8000 (compose) /
http://localhost:8091 (host). Used by RevitalClient integration tests.
"""
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(
    title="Mock Revital",
    description="Stub for local development — returns advisory summaries matching spec",
)


class SummarizeRequest(BaseModel):
    case_id: str
    tenant_id: str
    service_codes: list[str] = []
    diagnosis_codes: list[str] = []
    lob: str = ""
    urgency: str = ""
    doc_requirements: list[str] = []


class SummarizeResponse(BaseModel):
    summary: str
    citations: list[str]
    extracted_entities: list[dict[str, Any]]
    completeness: float          # 0.0–1.0
    triage: str                  # "standard" | "escalate" | "expedited" | "routine_review"
    abstained: bool
    model_version: str


@app.post("/api/v1/summarize", response_model=SummarizeResponse)
async def summarize(req: SummarizeRequest) -> SummarizeResponse:
    return SummarizeResponse(
        summary=f"[Mock] Advisory summary for case {req.case_id}. No real documents were analyzed.",
        citations=["doc-mock-001:full"],
        extracted_entities=[],
        completeness=0.95,
        triage="routine_review",
        abstained=False,
        model_version="mock-v0.0.1",
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "mock-revital"}
