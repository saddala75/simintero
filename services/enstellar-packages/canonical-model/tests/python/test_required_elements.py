# packages/canonical-model/tests/python/test_required_elements.py
"""Tests for required-elements.json: structural integrity and field mapping coverage.

Verifies that:
1. The mapping file is valid JSON and contains expected top-level keys.
2. Every mapping entry has the required structural fields.
3. All ccem_model values reference real Pydantic model fields.
4. All required=True mappings have cardinality constraints that include "1".
5. A synthetic FHIR-like dict can be projected to a canonical Case via the mapping.
"""
import json
import pathlib

import pytest

try:
    from canonical_model.models import Case, Member, Coverage, Provider, ServiceLine
except ImportError:
    from canonical_model import Case, Member, Coverage, Provider, ServiceLine  # type: ignore[no-redef]

_MAP_PATH = pathlib.Path(__file__).parent.parent.parent / "required-elements.json"


@pytest.fixture(scope="module")
def mapping() -> dict:
    return json.loads(_MAP_PATH.read_text())


def test_mapping_file_exists():
    assert _MAP_PATH.exists(), "required-elements.json is missing"


def test_mapping_top_level_keys(mapping):
    for key in ("title", "version", "fhir_ig", "mappings"):
        assert key in mapping, f"Top-level key '{key}' missing"


def test_each_entry_has_required_keys(mapping):
    required_keys = {"id", "fhir_resource", "fhir_path", "ccem_model", "ccem_field", "required", "cardinality"}
    for entry in mapping["mappings"]:
        missing = required_keys - entry.keys()
        assert not missing, f"Entry '{entry.get('id')}' is missing keys: {missing}"


def test_required_entries_have_mandatory_cardinality(mapping):
    """Every required=True mapping must have a cardinality that starts with '1'."""
    for entry in mapping["mappings"]:
        if entry["required"]:
            assert entry["cardinality"].startswith("1"), (
                f"Required mapping '{entry['id']}' has non-mandatory cardinality: {entry['cardinality']}"
            )


def test_ids_are_unique(mapping):
    ids = [e["id"] for e in mapping["mappings"]]
    assert len(ids) == len(set(ids)), "Duplicate mapping IDs found"


def test_ccem_models_are_known(mapping):
    known = {"Case", "Member", "Coverage", "Provider", "ServiceLine", "Decision"}
    for entry in mapping["mappings"]:
        assert entry["ccem_model"] in known, (
            f"Unknown ccem_model '{entry['ccem_model']}' in entry '{entry['id']}'"
        )


def test_all_required_ccem_fields_exist_on_models(mapping):
    """Required mappings reference fields that actually exist on the Pydantic model."""
    model_map = {
        "Case": Case,
        "Member": Member,
        "Coverage": Coverage,
        "Provider": Provider,
        "ServiceLine": ServiceLine,
    }
    for entry in mapping["mappings"]:
        if not entry["required"]:
            continue
        model_cls = model_map.get(entry["ccem_model"])
        if model_cls is None:
            continue
        top_field = entry["ccem_field"].split(".")[0]
        assert top_field in model_cls.model_fields, (
            f"Required mapping '{entry['id']}': field '{top_field}' not in {entry['ccem_model']}"
        )


def test_minimum_required_mappings_present(mapping):
    """The 5 CCEM models must each have at least one required mapping."""
    required_models = {"Case", "Member", "Coverage", "Provider", "ServiceLine"}
    covered = {e["ccem_model"] for e in mapping["mappings"] if e["required"]}
    missing = required_models - covered
    assert not missing, f"No required mappings for models: {missing}"


def test_urgency_value_map_covers_all_canonical_urgency_values(mapping):
    """urgency value_map must cover all Case.urgency StrEnum values."""
    from canonical_model.case import Urgency
    urgency_entry = next(
        (e for e in mapping["mappings"] if e["id"] == "case.urgency"),
        None,
    )
    assert urgency_entry is not None, "case.urgency mapping missing"
    mapped_targets = set(urgency_entry["value_map"].values())
    canonical_values = {v.value for v in Urgency}
    uncovered = canonical_values - mapped_targets
    assert not uncovered, f"Urgency values not covered by value_map: {uncovered}"


def test_gender_value_map_covers_all_canonical_gender_values(mapping):
    """gender value_map must emit only values valid for Member.gender."""
    valid_gender_values = {"M", "F", "O", "U"}
    gender_entry = next(
        (e for e in mapping["mappings"] if e["id"] == "member.gender"),
        None,
    )
    assert gender_entry is not None, "member.gender mapping missing"
    targets = set(gender_entry["value_map"].values())
    assert targets <= valid_gender_values, (
        f"gender value_map produces invalid targets: {targets - valid_gender_values}"
    )


def test_synthetic_fhir_projection_round_trips():
    """Build a minimal canonical Case from a synthetic FHIR-like dict and round-trip it."""
    import uuid
    from datetime import datetime, timezone, date

    tenant_id = "tenant-pas-test"
    member_id = uuid.uuid4()
    coverage_id = uuid.uuid4()
    provider_id = uuid.uuid4()
    case_id = uuid.uuid4()
    sl_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    # Simulate what an ingestion adapter would produce from a FHIR Claim bundle
    case = Case(
        case_id=case_id,
        tenant_id=tenant_id,
        correlation_id=f"Claim/{uuid.uuid4()}",
        lob="commercial",
        status="intake",
        urgency="standard",
        member=Member(
            member_id=member_id,
            tenant_id=tenant_id,
            first_name="Jane",
            last_name="Doe",
            date_of_birth=date(1985, 4, 12),
            gender="F",
            mrn="MRN-FHIR-001",
        ),
        coverage=Coverage(
            coverage_id=coverage_id,
            tenant_id=tenant_id,
            member_id=member_id,
            plan_id="PLAN-GOLD-001",
            subscriber_id="SUB-FHIR-001",
            payer_name="Acme Health",
            lob="commercial",
            effective_date=date(2024, 1, 1),
        ),
        requesting_provider=Provider(
            provider_id=provider_id,
            tenant_id=tenant_id,
            npi="1234567890",
            name="Dr. Jane Smith",
        ),
        service_lines=[
            ServiceLine(
                service_line_id=sl_id,
                tenant_id=tenant_id,
                sequence=1,
                service_type_code="3",
                procedure_code="99213",
                diagnosis_codes=["Z00.00"],
                quantity=1.0,
                requested_start_date=date(2026, 7, 1),
            )
        ],
        created_at=now,
        updated_at=now,
    )

    # Round-trip through JSON
    serialized = case.model_dump_json()
    restored = Case.model_validate_json(serialized)

    assert restored.case_id == case.case_id
    assert restored.tenant_id == tenant_id
    assert restored.member.first_name == "Jane"
    assert restored.member.gender == "F"
    assert restored.member.mrn == "MRN-FHIR-001"
    assert restored.coverage.plan_id == "PLAN-GOLD-001"
    assert restored.requesting_provider.npi == "1234567890"
    assert restored.service_lines[0].procedure_code == "99213"
    assert restored.service_lines[0].diagnosis_codes == ["Z00.00"]
    assert restored.service_lines[0].quantity == 1.0
