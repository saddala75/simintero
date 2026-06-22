"""Unit tests for PasBundleMapper — no network, no MinIO."""
from __future__ import annotations

import json
import pathlib
from datetime import date
from uuid import UUID

import pytest

from canonical_model import Case, Status, Urgency

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def sample_bundle() -> dict:
    return json.loads((FIXTURES / "sample_pas_bundle.json").read_text())


@pytest.fixture(scope="module")
def mapped_case(sample_bundle) -> Case:
    from enstellar_workflow.normalization.mapper import PasBundleMapper
    mapper = PasBundleMapper()
    return mapper.map(sample_bundle, tenant_id="tenant-acme", correlation_id="corr-abc-123")


# --- Happy path ---

class TestPasBundleMapper:
    def test_returns_case_instance(self, mapped_case):
        assert isinstance(mapped_case, Case)

    def test_status_is_intake(self, mapped_case):
        assert mapped_case.status == Status.intake

    def test_urgency_is_standard(self, mapped_case):
        assert mapped_case.urgency == Urgency.standard

    def test_case_id_is_uuid(self, mapped_case):
        assert isinstance(mapped_case.case_id, UUID)

    def test_tenant_id_on_case(self, mapped_case):
        assert mapped_case.tenant_id == "tenant-acme"

    def test_correlation_id_preserved(self, mapped_case):
        assert mapped_case.correlation_id == "corr-abc-123"

    def test_created_at_is_timezone_aware(self, mapped_case):
        import datetime
        assert mapped_case.created_at.tzinfo is not None
        assert mapped_case.updated_at.tzinfo is not None


class TestMemberMapping:
    def test_member_first_name(self, mapped_case):
        assert mapped_case.member.first_name == "Jane"

    def test_member_last_name(self, mapped_case):
        assert mapped_case.member.last_name == "Smith"

    def test_member_dob(self, mapped_case):
        assert mapped_case.member.date_of_birth == date(1985, 4, 12)

    def test_member_gender_female(self, mapped_case):
        from canonical_model import Gender
        assert mapped_case.member.gender == Gender.F

    def test_member_mrn_extracted(self, mapped_case):
        assert mapped_case.member.mrn == "MRN-001"

    def test_member_identifiers_non_empty(self, mapped_case):
        assert len(mapped_case.member.identifiers) >= 1

    def test_member_tenant_id_propagated(self, mapped_case):
        assert mapped_case.member.tenant_id == "tenant-acme"

    def test_member_id_is_uuid(self, mapped_case):
        assert isinstance(mapped_case.member.member_id, UUID)

    def test_member_preserves_fhir_logical_id(self, mapped_case):
        """The bundle Patient logical id (pat-001) is preserved as a stable
        member reference in identifiers, not discarded for a random UUID.

        slice 1.1: this is what flows to Digicore as member_ref.
        """
        from enstellar_workflow.normalization.mapper import FHIR_LOGICAL_ID_SYSTEM

        refs = [
            i.value
            for i in (mapped_case.member.identifiers or [])
            if i.system == FHIR_LOGICAL_ID_SYSTEM
        ]
        assert refs == ["pat-001"]


class TestProviderMapping:
    def test_requesting_provider_name(self, mapped_case):
        assert "Jones" in mapped_case.requesting_provider.name

    def test_requesting_provider_npi(self, mapped_case):
        assert mapped_case.requesting_provider.npi == "1234567890"

    def test_requesting_provider_npi_pattern(self, mapped_case):
        import re
        assert re.match(r"^[0-9]{10}$", mapped_case.requesting_provider.npi)

    def test_requesting_provider_tenant_id(self, mapped_case):
        assert mapped_case.requesting_provider.tenant_id == "tenant-acme"

    def test_servicing_provider_present(self, mapped_case):
        assert mapped_case.servicing_provider is not None

    def test_servicing_provider_name(self, mapped_case):
        assert "Lee" in mapped_case.servicing_provider.name

    def test_servicing_provider_npi(self, mapped_case):
        assert mapped_case.servicing_provider.npi == "0987654321"

    def test_servicing_provider_tenant_id(self, mapped_case):
        assert mapped_case.servicing_provider.tenant_id == "tenant-acme"


class TestCoverageMapping:
    def test_coverage_subscriber_id(self, mapped_case):
        assert mapped_case.coverage.subscriber_id == "SUB-12345"

    def test_coverage_payer_name(self, mapped_case):
        assert mapped_case.coverage.payer_name == "ACME Health Plan"

    def test_coverage_plan_id_extracted(self, mapped_case):
        assert mapped_case.coverage.plan_id == "PLAN-ACME-PPO-2025"

    def test_coverage_group_id_extracted(self, mapped_case):
        assert mapped_case.coverage.group_id == "GRP-999"

    def test_coverage_lob_defaults_to_commercial(self, mapped_case):
        assert mapped_case.coverage.lob == "commercial"

    def test_coverage_effective_date(self, mapped_case):
        assert mapped_case.coverage.effective_date == date(2025, 1, 1)

    def test_coverage_termination_date(self, mapped_case):
        assert mapped_case.coverage.termination_date == date(2025, 12, 31)

    def test_coverage_tenant_id_propagated(self, mapped_case):
        assert mapped_case.coverage.tenant_id == "tenant-acme"

    def test_coverage_member_id_matches_member(self, mapped_case):
        assert mapped_case.coverage.member_id == mapped_case.member.member_id

    def test_lob_propagated_to_case(self, mapped_case):
        assert mapped_case.lob == mapped_case.coverage.lob


class TestServiceLineMapping:
    def test_at_least_one_service_line(self, mapped_case):
        assert len(mapped_case.service_lines) >= 1

    def test_service_line_sequence(self, mapped_case):
        assert mapped_case.service_lines[0].sequence == 1

    def test_service_line_procedure_code(self, mapped_case):
        assert mapped_case.service_lines[0].procedure_code == "97110"

    def test_service_line_service_type_code(self, mapped_case):
        assert mapped_case.service_lines[0].service_type_code == "PT"

    def test_service_line_quantity(self, mapped_case):
        assert mapped_case.service_lines[0].quantity == 12.0

    def test_service_line_units(self, mapped_case):
        assert mapped_case.service_lines[0].units == "visits"

    def test_service_line_diagnosis_codes(self, mapped_case):
        assert "M54.5" in mapped_case.service_lines[0].diagnosis_codes

    def test_service_line_tenant_id(self, mapped_case):
        assert mapped_case.service_lines[0].tenant_id == "tenant-acme"

    def test_service_line_id_is_uuid(self, mapped_case):
        assert isinstance(mapped_case.service_lines[0].service_line_id, UUID)


# --- Error cases ---

class TestPasBundleMapperErrors:
    def test_missing_claim_raises_value_error(self):
        from enstellar_workflow.normalization.mapper import PasBundleMapper
        mapper = PasBundleMapper()
        bundle_no_claim = {"resourceType": "Bundle", "type": "collection", "entry": []}
        with pytest.raises(ValueError, match="Claim"):
            mapper.map(bundle_no_claim, tenant_id="t1", correlation_id="c1")

    def test_missing_patient_raises_value_error(self, sample_bundle):
        from enstellar_workflow.normalization.mapper import PasBundleMapper
        import copy
        mapper = PasBundleMapper()
        bundle = copy.deepcopy(sample_bundle)
        bundle["entry"] = [
            e for e in bundle["entry"]
            if e["resource"]["resourceType"] != "Patient"
        ]
        with pytest.raises(ValueError, match="[Pp]atient"):
            mapper.map(bundle, tenant_id="t1", correlation_id="c1")

    def test_missing_coverage_raises_value_error(self, sample_bundle):
        from enstellar_workflow.normalization.mapper import PasBundleMapper
        import copy
        mapper = PasBundleMapper()
        bundle = copy.deepcopy(sample_bundle)
        bundle["entry"] = [
            e for e in bundle["entry"]
            if e["resource"]["resourceType"] != "Coverage"
        ]
        with pytest.raises(ValueError, match="[Cc]overage"):
            mapper.map(bundle, tenant_id="t1", correlation_id="c1")

    def test_empty_tenant_id_rejected(self, sample_bundle):
        from enstellar_workflow.normalization.mapper import PasBundleMapper
        mapper = PasBundleMapper()
        with pytest.raises(ValueError, match="tenant_id"):
            mapper.map(sample_bundle, tenant_id="", correlation_id="c1")


# --- Round-trip ---

class TestRoundTrip:
    def test_round_trip_json(self, mapped_case):
        """Serialize to JSON dict and deserialize back — all required fields survive."""
        data = mapped_case.model_dump(mode="json")
        restored = Case.model_validate(data)
        assert restored.case_id == mapped_case.case_id
        assert restored.tenant_id == mapped_case.tenant_id
        assert restored.correlation_id == mapped_case.correlation_id
        assert restored.member.first_name == mapped_case.member.first_name
        assert restored.member.last_name == mapped_case.member.last_name
        assert restored.member.date_of_birth == mapped_case.member.date_of_birth
        assert restored.coverage.subscriber_id == mapped_case.coverage.subscriber_id
        assert restored.coverage.payer_name == mapped_case.coverage.payer_name
        assert restored.requesting_provider.npi == mapped_case.requesting_provider.npi
        assert len(restored.service_lines) == len(mapped_case.service_lines)
        assert restored.service_lines[0].procedure_code == mapped_case.service_lines[0].procedure_code
        assert restored.service_lines[0].diagnosis_codes == mapped_case.service_lines[0].diagnosis_codes

    def test_round_trip_json_string(self, mapped_case):
        """model_dump_json() → model_validate_json() cycle."""
        json_str = mapped_case.model_dump_json()
        restored = Case.model_validate_json(json_str)
        assert restored.case_id == mapped_case.case_id


# --- FastAPI endpoint smoke tests ---

class TestNormalizeEndpoint:
    """Tests the POST /internal/normalize endpoint with a real mapper but mocked MinIO."""

    @pytest.fixture(autouse=True)
    def _override_case_service(self, db_dsn):
        """F2: the route now resolves a CaseService dependency that opens a DB pool.

        Override it with a CaseService backed by the testcontainer DB so the
        endpoint exercises real create_case + kickoff transition (instead of the
        default get_pool() that targets an unreachable localhost:5432). A fresh
        pool is created per request so it binds to the TestClient's event loop.
        """
        import asyncpg

        from enstellar_workflow.cases.service import CaseService
        from enstellar_workflow.main import app
        from enstellar_workflow.normalization.api import _get_case_service

        async def _fake_case_service() -> CaseService:
            pool = await asyncpg.create_pool(db_dsn, min_size=1, max_size=2)
            return CaseService(pool)

        app.dependency_overrides[_get_case_service] = _fake_case_service
        yield
        app.dependency_overrides.pop(_get_case_service, None)

    def test_normalize_endpoint_returns_200(self, sample_bundle, monkeypatch):
        from fastapi.testclient import TestClient

        monkeypatch.setattr(
            "enstellar_workflow.normalization.api.MinioStore.upload",
            lambda self, tenant_id, correlation_id, bundle: f"test-bucket/{tenant_id}/raw-bundles/2026-06-05/{correlation_id}.json",
        )

        from enstellar_workflow.main import app
        client = TestClient(app)

        response = client.post(
            "/internal/normalize",
            json={
                "bundle": sample_bundle,
                "tenant_id": "tenant-acme",
                "correlation_id": "corr-endpoint-001",
            },
        )
        assert response.status_code == 200

    def test_normalize_endpoint_returns_case_fields(self, sample_bundle, monkeypatch):
        from fastapi.testclient import TestClient

        monkeypatch.setattr(
            "enstellar_workflow.normalization.api.MinioStore.upload",
            lambda self, tenant_id, correlation_id, bundle: f"test-bucket/{tenant_id}/{correlation_id}.json",
        )

        from enstellar_workflow.main import app
        client = TestClient(app)

        response = client.post(
            "/internal/normalize",
            json={
                "bundle": sample_bundle,
                "tenant_id": "tenant-acme",
                "correlation_id": "corr-endpoint-002",
            },
        )
        data = response.json()
        assert data["tenant_id"] == "tenant-acme"
        assert data["correlation_id"] == "corr-endpoint-002"
        assert data["status"] == "intake"
        assert "_raw_bundle_key" in data

    def test_normalize_endpoint_422_on_empty_bundle(self, monkeypatch):
        from fastapi.testclient import TestClient

        monkeypatch.setattr(
            "enstellar_workflow.normalization.api.MinioStore.upload",
            lambda self, tenant_id, correlation_id, bundle: "test-bucket/key.json",
        )

        from enstellar_workflow.main import app
        client = TestClient(app)

        response = client.post(
            "/internal/normalize",
            json={
                "bundle": {"resourceType": "Bundle", "type": "collection", "entry": []},
                "tenant_id": "tenant-acme",
                "correlation_id": "corr-endpoint-003",
            },
        )
        assert response.status_code == 422
