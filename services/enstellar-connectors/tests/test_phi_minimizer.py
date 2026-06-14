"""Unit tests for minimize_for_revital — PHI stripping before Revital calls.

INVARIANT #3 (PHI minimum-necessary): case data must be minimized before any
call to RevitalClient.summarize(). These tests verify:
1. All PHI field names in _PHI_FIELDS are stripped from the member sub-dict.
2. Non-PHI fields are preserved unchanged.
3. Top-level PHI fields are also stripped.
4. The original case_data is NOT mutated (returns a copy).
5. An end-to-end check: minimize_for_revital() → SummarizeRequest has no PHI.
"""
import pytest

from enstellar_connectors.revital.models import SummarizeRequest
from enstellar_connectors.revital.phi_minimizer import _PHI_FIELDS, minimize_for_revital


# ─── Core stripping behavior ─────────────────────────────────────────────────


def test_phi_fields_stripped_from_member_sub_dict():
    """The three most critical PHI fields must be removed from member sub-dict."""
    case_data = {
        "case_id": "case-001",
        "tenant_id": "tenant-alpha",
        "member": {
            "member_name": "John Doe",
            "dob": "1970-01-01",
            "ssn": "123-45-6789",
            "plan_id": "PLAN-001",
        },
    }
    result = minimize_for_revital(case_data)
    assert "member_name" not in result["member"]
    assert "dob" not in result["member"]
    assert "ssn" not in result["member"]


def test_non_phi_fields_in_member_preserved():
    """Fields that are not PHI must survive minimization unchanged."""
    case_data = {
        "case_id": "case-002",
        "member": {
            "plan_id": "PLAN-002",
            "lob": "commercial",
            "member_name": "Jane Smith",
        },
    }
    result = minimize_for_revital(case_data)
    assert result["member"]["plan_id"] == "PLAN-002"
    assert result["member"]["lob"] == "commercial"
    assert "member_name" not in result["member"]


def test_top_level_phi_fields_stripped():
    """PHI fields at the top level of case_data (not in a member sub-dict) are also removed."""
    case_data = {
        "case_id": "case-003",
        "tenant_id": "tenant-beta",
        "member_name": "Top Level PHI",
        "ssn": "999-99-9999",
        "service_codes": ["99213"],
    }
    result = minimize_for_revital(case_data)
    assert "member_name" not in result
    assert "ssn" not in result
    assert result["service_codes"] == ["99213"]
    assert result["case_id"] == "case-003"


def test_case_without_member_dict_unchanged():
    """If case_data has no 'member' key, the rest of the dict passes through."""
    case_data = {
        "case_id": "case-004",
        "tenant_id": "tenant-gamma",
        "service_codes": ["99215"],
        "diagnosis_codes": ["Z00.00"],
    }
    result = minimize_for_revital(case_data)
    assert result == case_data


def test_original_case_data_not_mutated():
    """minimize_for_revital must return a copy — the original must not be modified."""
    original = {
        "case_id": "case-005",
        "member": {"member_name": "Alice", "plan_id": "P-001"},
    }
    _ = minimize_for_revital(original)
    # Original must be untouched
    assert original["member"]["member_name"] == "Alice"


def test_member_none_does_not_crash():
    """If member is present but None, minimize_for_revital must not raise."""
    case_data = {"case_id": "case-006", "member": None}
    result = minimize_for_revital(case_data)
    assert result["member"] is None


def test_all_phi_field_names_stripped_from_member():
    """Every name in _PHI_FIELDS must be stripped — validates _PHI_FIELDS is complete."""
    member_with_all_phi = {field: "sensitive_value" for field in _PHI_FIELDS}
    member_with_all_phi["plan_id"] = "PLAN-SAFE"  # must survive
    case_data = {"case_id": "case-phi-all", "member": member_with_all_phi}

    result = minimize_for_revital(case_data)

    for phi_field in _PHI_FIELDS:
        assert phi_field not in result["member"], (
            f"PHI field '{phi_field}' not stripped by minimize_for_revital. "
            f"Add it to _PHI_FIELDS in phi_minimizer.py."
        )
    assert result["member"]["plan_id"] == "PLAN-SAFE"


def test_canonical_member_fields_are_all_stripped():
    """Every PHI field produced by the canonical Member model must be stripped."""
    canonical_member = {
        "member_id": "550e8400-e29b-41d4-a716-446655440000",
        "tenant_id": "tenant-x",
        "mrn": "MRN-12345",
        "first_name": "Alice",
        "last_name": "Smith",
        "date_of_birth": "1980-05-15",
        "gender": "F",
        "identifiers": [{"system": "mrn://acme", "value": "MRN-12345"}],
    }
    case_data = {"case_id": "C-001", "member": canonical_member}
    result = minimize_for_revital(case_data)
    member = result["member"]
    assert "mrn" not in member
    assert "first_name" not in member
    assert "last_name" not in member
    assert "date_of_birth" not in member
    assert "identifiers" not in member
    assert member["tenant_id"] == "tenant-x"   # non-PHI preserved


def test_non_dict_member_passes_through_without_crash():
    """If member is a non-dict, non-None type, it passes through unchanged."""
    case_data = {"case_id": "case-007", "member": ["unexpected", "list"]}
    result = minimize_for_revital(case_data)
    assert result["member"] == ["unexpected", "list"]


# ─── End-to-end PHI contract ─────────────────────────────────────────────────


def test_summarize_request_built_from_minimized_dict_has_no_phi():
    """End-to-end: minimize_for_revital() → SummarizeRequest dump has no PHI fields.

    This is the definitive test for the caller contract described in
    integration-connectors spec under 'PHI rule'.
    """
    raw_case = {
        "case_id": "case-e2e-phi",
        "tenant_id": "tenant-phi-test",
        "service_codes": ["99213"],
        "diagnosis_codes": ["J45.50"],
        "lob": "commercial",
        "urgency": "standard",
        "doc_requirements": ["clinical-notes"],
        "member": {
            "member_name": "Alice Smith",
            "dob": "1980-05-15",
            "ssn": "000-00-0000",
            "date_of_birth": "1980-05-15",
            "plan_id": "PLAN-007",
        },
    }
    minimized = minimize_for_revital(raw_case)

    req = SummarizeRequest(
        case_id=minimized["case_id"],
        tenant_id=minimized["tenant_id"],
        service_codes=minimized["service_codes"],
        diagnosis_codes=minimized["diagnosis_codes"],
        lob=minimized["lob"],
        urgency=minimized["urgency"],
        doc_requirements=minimized["doc_requirements"],
    )
    dumped = req.model_dump()

    for phi_field in ("member_name", "dob", "ssn", "date_of_birth"):
        assert phi_field not in dumped, (
            f"PHI field '{phi_field}' leaked into SummarizeRequest body. "
            "Revital must never receive raw PHI fields (invariant #3)."
        )
    assert dumped["case_id"] == "case-e2e-phi"
    assert dumped["service_codes"] == ["99213"]
