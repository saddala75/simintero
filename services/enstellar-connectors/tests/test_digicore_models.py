"""Unit tests for Digicore Pydantic models — no HTTP, no network."""
import pytest
from pydantic import ValidationError

from enstellar_connectors.digicore.models import (
    DecisionRequest,
    DecisionResponse,
    StructuredTrace,
)


# ─── DecisionRequest ────────────────────────────────────────────────────────


def test_decision_request_happy_path():
    req = DecisionRequest(
        case_id="case-001",
        service_code="99213",
        member_id="member-001",
        plan_id="PLAN-001",
        tenant_id="tenant-alpha",
    )
    assert req.case_id == "case-001"
    assert req.tenant_id == "tenant-alpha"


def test_decision_request_model_dump_includes_all_fields():
    req = DecisionRequest(
        case_id="case-002",
        service_code="99214",
        member_id="m-002",
        plan_id="P-002",
        tenant_id="tenant-beta",
    )
    data = req.model_dump()
    assert data["case_id"] == "case-002"
    assert data["service_code"] == "99214"
    assert data["member_id"] == "m-002"
    assert data["plan_id"] == "P-002"
    assert data["tenant_id"] == "tenant-beta"


# ─── INVARIANT: tenant_id must not be blank ──────────────────────────────────


def test_decision_request_missing_tenant_id_raises_validation_error():
    """INVARIANT #5: tenant_id is required. Omitting it raises ValidationError before any HTTP call."""
    with pytest.raises(ValidationError) as exc_info:
        DecisionRequest(
            case_id="case-003",
            service_code="99213",
            member_id="m-003",
            plan_id="P-003",
            # tenant_id intentionally omitted
        )
    errors = exc_info.value.errors()
    assert any(e["loc"] == ("tenant_id",) for e in errors)


def test_decision_request_blank_tenant_id_raises_validation_error():
    """INVARIANT #5: tenant_id must not be blank (min_length=1)."""
    with pytest.raises(ValidationError) as exc_info:
        DecisionRequest(
            case_id="case-004",
            service_code="99213",
            member_id="m-004",
            plan_id="P-004",
            tenant_id="",
        )
    errors = exc_info.value.errors()
    assert any(e["loc"] == ("tenant_id",) for e in errors)


def test_decision_request_whitespace_only_tenant_id_raises_validation_error():
    """INVARIANT #5: tenant_id that is only whitespace must be rejected."""
    with pytest.raises(ValidationError):
        DecisionRequest(
            case_id="case-005",
            service_code="99213",
            member_id="m-005",
            plan_id="P-005",
            tenant_id="   ",
        )


# ─── StructuredTrace ────────────────────────────────────────────────────────


def test_structured_trace_roundtrip():
    trace = StructuredTrace(
        artifact="mock-policy-stub-v1",
        version="1.0.0",
        source="digicore-runtime",
        logic_branch="auto-approve-stub",
    )
    dumped = trace.model_dump()
    restored = StructuredTrace.model_validate(dumped)
    assert restored == trace


# ─── DecisionResponse ───────────────────────────────────────────────────────


def test_decision_response_approved():
    resp = DecisionResponse(
        decision="approved",
        requirements=[],
        structured_trace=StructuredTrace(
            artifact="art-1",
            version="1.0.0",
            source="digicore",
            logic_branch="main",
        ),
    )
    assert resp.decision == "approved"
    assert resp.requirements == []


def test_decision_response_pending_review():
    resp = DecisionResponse(
        decision="pending_review",
        requirements=["clinical-notes"],
        structured_trace=StructuredTrace(
            artifact="art-1",
            version="1.0.0",
            source="digicore",
            logic_branch="needs-review",
        ),
    )
    assert resp.decision == "pending_review"
    assert "clinical-notes" in resp.requirements


def test_decision_response_denied():
    resp = DecisionResponse(
        decision="denied",
        requirements=[],
        structured_trace=StructuredTrace(
            artifact="art-1",
            version="1.0.0",
            source="digicore",
            logic_branch="denial-branch",
        ),
    )
    assert resp.decision == "denied"


def test_decision_response_invalid_decision_value_raises():
    """'not_a_real_outcome' is not a valid decision literal."""
    with pytest.raises(ValidationError):
        DecisionResponse(
            decision="not_a_real_outcome",
            requirements=[],
            structured_trace=StructuredTrace(
                artifact="art-1",
                version="1.0.0",
                source="digicore",
                logic_branch="main",
            ),
        )


def test_decision_response_validates_from_digicore_runtime_json():
    """Validate against the exact JSON the digicore-runtime server returns."""
    raw = {
        "decision": "approved",
        "requirements": [],
        "structured_trace": {
            "artifact": "mock-policy-stub-v1",
            "version": "1.0.0",
            "source": "digicore-runtime",
            "logic_branch": "auto-approve-stub",
        },
    }
    resp = DecisionResponse.model_validate(raw)
    assert resp.decision == "approved"
    assert resp.structured_trace.artifact == "mock-policy-stub-v1"
    assert resp.structured_trace.version == "1.0.0"
    assert resp.structured_trace.source == "digicore-runtime"
    assert resp.structured_trace.logic_branch == "auto-approve-stub"
