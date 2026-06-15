"""Unit tests for Revital Pydantic models — no HTTP, no network.

Key invariants checked:
- INVARIANT #5: SummarizeRequest.tenant_id must be non-blank (ValidationError before any HTTP call).
- INVARIANT #3 (PHI): SummarizeRequest schema must not define PHI fields.
- RevitalUnavailableError is a plain Exception that callers can catch.
"""
import pytest
from pydantic import ValidationError

from enstellar_connectors.revital.models import (
    RevitalUnavailableError,
    SummarizeRequest,
    SummarizeResponse,
)


# ─── SummarizeRequest ────────────────────────────────────────────────────────


def test_summarize_request_happy_path():
    req = SummarizeRequest(
        case_id="case-001",
        tenant_id="tenant-alpha",
        service_codes=["99213"],
        diagnosis_codes=["J45.50"],
        lob="commercial",
        urgency="standard",
        doc_requirements=["clinical-notes"],
    )
    assert req.case_id == "case-001"
    assert req.tenant_id == "tenant-alpha"
    assert req.service_codes == ["99213"]


def test_summarize_request_model_dump_round_trip():
    req = SummarizeRequest(
        case_id="case-rt",
        tenant_id="tenant-rt",
        service_codes=["99213", "99214"],
        diagnosis_codes=["Z00.00"],
        lob="medicare",
        urgency="expedited",
        doc_requirements=["lab-results"],
    )
    restored = SummarizeRequest.model_validate(req.model_dump())
    assert restored == req


# ─── INVARIANT #5: tenant_id must not be blank ───────────────────────────────


def test_summarize_request_missing_tenant_id_raises():
    """INVARIANT #5: omitting tenant_id raises ValidationError before any HTTP call."""
    with pytest.raises(ValidationError) as exc_info:
        SummarizeRequest(
            case_id="case-001",
            # tenant_id intentionally omitted
            service_codes=["99213"],
            diagnosis_codes=["J45.50"],
            lob="commercial",
            urgency="standard",
            doc_requirements=[],
        )
    errors = exc_info.value.errors()
    assert any(e["loc"] == ("tenant_id",) for e in errors)


def test_summarize_request_blank_tenant_id_raises():
    """INVARIANT #5: empty string tenant_id (min_length=1) raises ValidationError."""
    with pytest.raises(ValidationError) as exc_info:
        SummarizeRequest(
            case_id="case-001",
            tenant_id="",
            service_codes=["99213"],
            diagnosis_codes=["J45.50"],
            lob="commercial",
            urgency="standard",
            doc_requirements=[],
        )
    errors = exc_info.value.errors()
    assert any(e["loc"] == ("tenant_id",) for e in errors)


def test_summarize_request_whitespace_only_tenant_id_raises():
    """INVARIANT #5: whitespace-only tenant_id is rejected by the field validator."""
    with pytest.raises(ValidationError):
        SummarizeRequest(
            case_id="case-001",
            tenant_id="   ",
            service_codes=["99213"],
            diagnosis_codes=["J45.50"],
            lob="commercial",
            urgency="standard",
            doc_requirements=[],
        )


# ─── INVARIANT #3 (PHI): SummarizeRequest must not define PHI fields ─────────


def test_summarize_request_schema_has_no_phi_fields():
    """PHI contract: SummarizeRequest schema must not contain any PHI field names.

    If this test fails, a developer added a PHI field to SummarizeRequest — that
    is a hard invariant violation. Remove the field immediately and use
    minimize_for_revital() to strip PHI before construction.
    """
    phi_fields = {
        "member_name", "first_name", "last_name", "middle_name",
        "dob", "date_of_birth",
        "ssn", "social_security_number",
        "address", "street_address", "city", "state", "zip", "zip_code",
        "phone", "phone_number",
        "email", "email_address",
        "member_id_raw",
    }
    schema_fields = set(SummarizeRequest.model_fields.keys())
    overlap = phi_fields & schema_fields
    assert not overlap, (
        f"PHI fields found in SummarizeRequest schema: {overlap}. "
        "Remove them — callers must use minimize_for_revital() first."
    )


# ─── SummarizeResponse ───────────────────────────────────────────────────────


def test_summarize_response_round_trip():
    resp = SummarizeResponse(
        summary="Advisory summary for case 001.",
        citations=["doc-001:span-1", "doc-002:span-3"],
        extracted_entities=[{"type": "diagnosis", "value": "asthma", "source": "notes"}],
        completeness=0.85,
        triage="standard",
        abstained=False,
        model_version="revital-v1.2.3",
    )
    restored = SummarizeResponse.model_validate(resp.model_dump())
    assert restored == resp


def test_summarize_response_abstained_flag():
    resp = SummarizeResponse(
        summary="",
        citations=[],
        extracted_entities=[],
        completeness=0.0,
        triage="escalate",
        abstained=True,
        model_version="revital-v1.2.3",
    )
    assert resp.abstained is True
    assert resp.triage == "escalate"


def test_summarize_response_completeness_out_of_range_raises():
    """completeness must be in [0.0, 1.0] — validated by Pydantic."""
    with pytest.raises(ValidationError):
        SummarizeResponse(
            summary="x",
            citations=[],
            extracted_entities=[],
            completeness=1.5,
            triage="standard",
            abstained=False,
            model_version="v1",
        )


def test_summarize_response_validates_from_updated_mock_json():
    """Validate against the exact JSON the updated mock server (Task 5) will return."""
    raw = {
        "summary": "[Mock] Advisory summary for case test-001.",
        "citations": ["doc-mock-001:full"],
        "extracted_entities": [],
        "completeness": 0.95,
        "triage": "routine_review",
        "abstained": False,
        "model_version": "mock-v0.0.1",
    }
    resp = SummarizeResponse.model_validate(raw)
    assert resp.model_version == "mock-v0.0.1"
    assert resp.completeness == 0.95
    assert resp.abstained is False
    assert resp.citations == ["doc-mock-001:full"]


# ─── RevitalUnavailableError ─────────────────────────────────────────────────


def test_revital_unavailable_error_is_exception():
    err = RevitalUnavailableError("circuit open")
    assert isinstance(err, Exception)
    assert str(err) == "circuit open"


def test_revital_unavailable_error_can_be_caught_as_exception():
    """Advisory contract: callers catch Exception (or RevitalUnavailableError) to fall back."""
    with pytest.raises(Exception):
        raise RevitalUnavailableError("test fallback")


def test_revital_unavailable_error_preserves_cause():
    import httpx
    original = httpx.ConnectError("connection refused")
    wrapped = RevitalUnavailableError("revital unreachable")
    wrapped.__cause__ = original
    assert wrapped.__cause__ is original
