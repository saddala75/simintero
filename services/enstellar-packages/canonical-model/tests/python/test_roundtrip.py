# packages/canonical-model/tests/python/test_roundtrip.py
"""Round-trip serialization tests for the canonical Pydantic v2 models.

Each test: build an object -> model_dump_json() -> model_validate_json() -> assert equal.
"""
import json

import pytest

# datamodel-code-generator may produce classes in models.py or in per-schema files.
# Try both import paths; tests rely on which files were generated.
try:
    from canonical_model.models import Case, Member, Coverage, Provider, ServiceLine, Decision
except ImportError:
    from canonical_model import Case, Member, Coverage, Provider, ServiceLine, Decision  # type: ignore[no-redef]


@pytest.fixture
def sample_member() -> Member:
    return Member(
        member_id="11111111-0000-0000-0000-000000000001",
        tenant_id="tenant-test",
        first_name="Jane",
        last_name="Doe",
        date_of_birth="1985-04-12",
        mrn="MRN-001",
        gender="F",
        identifiers=[],
    )


@pytest.fixture
def sample_coverage() -> Coverage:
    return Coverage(
        coverage_id="22222222-0000-0000-0000-000000000002",
        tenant_id="tenant-test",
        member_id="11111111-0000-0000-0000-000000000001",
        plan_id="PLAN-GOLD-001",
        subscriber_id="SUB-001",
        payer_name="Acme Health",
        lob="commercial",
        effective_date="2025-01-01",
    )


@pytest.fixture
def sample_provider() -> Provider:
    return Provider(
        provider_id="33333333-0000-0000-0000-000000000003",
        tenant_id="tenant-test",
        npi="1234567890",
        name="Dr. Alice Smith",
        specialty="Orthopedics",
        identifiers=[],
    )


@pytest.fixture
def sample_service_line() -> ServiceLine:
    return ServiceLine(
        service_line_id="44444444-0000-0000-0000-000000000004",
        tenant_id="tenant-test",
        sequence=1,
        service_type_code="73",
        procedure_code="27447",
        procedure_description="Total knee replacement",
        quantity=1,
        units="UN",
        diagnosis_codes=["M17.11"],
        place_of_service="21",
        requested_start_date="2026-07-01",
    )


@pytest.fixture
def sample_case(sample_member, sample_coverage, sample_provider, sample_service_line) -> Case:
    return Case(
        case_id="55555555-0000-0000-0000-000000000005",
        tenant_id="tenant-test",
        correlation_id="corr-abc-123",
        lob="commercial",
        status="intake",
        urgency="standard",
        member=sample_member,
        coverage=sample_coverage,
        requesting_provider=sample_provider,
        service_lines=[sample_service_line],
        decisions=[],
        created_at="2026-06-05T10:00:00Z",
        updated_at="2026-06-05T10:00:00Z",
    )


def test_member_roundtrip(sample_member: Member) -> None:
    json_str = sample_member.model_dump_json()
    result = Member.model_validate_json(json_str)
    assert result == sample_member


def test_coverage_roundtrip(sample_coverage: Coverage) -> None:
    json_str = sample_coverage.model_dump_json()
    result = Coverage.model_validate_json(json_str)
    assert result == sample_coverage


def test_provider_roundtrip(sample_provider: Provider) -> None:
    json_str = sample_provider.model_dump_json()
    result = Provider.model_validate_json(json_str)
    assert result == sample_provider


def test_service_line_roundtrip(sample_service_line: ServiceLine) -> None:
    json_str = sample_service_line.model_dump_json()
    result = ServiceLine.model_validate_json(json_str)
    assert result == sample_service_line


def test_case_roundtrip(sample_case: Case) -> None:
    json_str = sample_case.model_dump_json()
    result = Case.model_validate_json(json_str)
    assert result == sample_case


def test_case_roundtrip_via_dict(sample_case: Case) -> None:
    """Also test the dict path (model_dump / model_validate)."""
    d = sample_case.model_dump()
    result = Case.model_validate(d)
    assert result == sample_case


def test_tenant_id_required() -> None:
    """tenant_id must be present -- omitting it raises ValidationError."""
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        Member(
            member_id="11111111-0000-0000-0000-000000000001",
            # tenant_id intentionally omitted
            first_name="Jane",
            last_name="Doe",
            date_of_birth="1985-04-12",
        )


def test_case_json_contains_tenant_id(sample_case: Case) -> None:
    """Serialized JSON must contain tenant_id -- guard against accidental exclusion."""
    payload = json.loads(sample_case.model_dump_json())
    assert payload["tenant_id"] == "tenant-test"
    assert payload["member"]["tenant_id"] == "tenant-test"
    assert payload["requesting_provider"]["tenant_id"] == "tenant-test"


@pytest.fixture
def sample_decision() -> Decision:
    return Decision(
        decision_id="66666666-0000-0000-0000-000000000006",
        tenant_id="tenant-test",
        case_id="55555555-0000-0000-0000-000000000005",
        outcome="approved",
        decided_by="auto",
        rule_artifact_id="rule-001",
        rule_version="1.0.0",
        evidence_refs=["ref-001"],
        human_signoff_required=False,
        auto_approved=True,
        decided_at="2026-06-05T10:00:00Z",
    )


def test_decision_roundtrip(sample_decision: Decision) -> None:
    json_str = sample_decision.model_dump_json()
    result = Decision.model_validate_json(json_str)
    assert result == sample_decision


def test_decision_human_signoff_required_preserved() -> None:
    """Invariant #1 support: human_signoff_required must survive JSON round-trip."""
    d = Decision(
        decision_id="77777777-0000-0000-0000-000000000007",
        tenant_id="tenant-test",
        case_id="55555555-0000-0000-0000-000000000005",
        outcome="denied",
        decided_by="human",
        rule_artifact_id="rule-002",
        rule_version="1.0.0",
        evidence_refs=[],
        human_signoff_required=True,
        auto_approved=False,
        decided_at="2026-06-05T10:00:00Z",
    )
    payload = json.loads(d.model_dump_json())
    assert payload["human_signoff_required"] is True
    assert payload["auto_approved"] is False
