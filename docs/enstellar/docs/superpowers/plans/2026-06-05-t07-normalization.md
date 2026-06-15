# T07 — Normalization (FHIR→Canonical) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `PasBundleMapper` that converts a PAS FHIR Bundle dict to a canonical `Case`, and `MinioStore` that persists the raw bundle in MinIO with a provenance key; prove lossless mapping with tests; expose a `POST /internal/normalize` FastAPI endpoint that T06's `NormalizationClient.java` calls.

**Architecture:** Pure Python module in `services/workflow-engine/enstellar_workflow/normalization/`. `PasBundleMapper` takes a bundle dict + tenant_id + correlation_id and returns a canonical `Case` (using generated Pydantic types from T02). `MinioStore` uploads the raw bundle JSON and returns the object key in the format `{bucket}/{tenant_id}/raw-bundles/{date}/{correlation_id}.json`. A minimal FastAPI app (`enstellar_workflow/main.py`) exposes `POST /internal/normalize` that stores-then-maps and returns the canonical Case JSON with a `_raw_bundle_key` provenance field. No FHIR library needed — the bundle is already-parsed JSON.

**Tech Stack:** Python 3.12, Pydantic v2, minio>=7.2, fastapi>=0.111, uvicorn[standard]>=0.30, pytest, pytest-asyncio, httpx>=0.27 (for FastAPI test client), Testcontainers (MinIO).

> **Invariant note:** Every `Case` produced by the mapper must carry `tenant_id`. `PasBundleMapper.map()` takes `tenant_id` as an explicit parameter and propagates it to every sub-entity (Member, Provider, Coverage, ServiceLine). Tests assert `tenant_id` is present on every nested object.

**Depends on:** T02 (canonical-model generated types), T04 (pyproject.toml baseline).

---

## Background

- `enstellar_workflow/` currently has: `config.py`, `db/`, `kafka/`, `outbox/`.
- The canonical model Python package lives at `packages/canonical-model/` and is installed editable via `canonical-model = { path = "../../packages/canonical-model", editable = true }` in uv.sources.
- `packages/canonical-model/generated/python/canonical_model/` exports: `Case`, `Status`, `Urgency`, `Member`, `Gender`, `Provider`, `Coverage`, `ServiceLine`, `Decision`, `Outcome`, `Identifier`.
- `Case.case_id` is `UUID` (not str). `Case.created_at` / `updated_at` are `AwareDatetime` — must be timezone-aware. `Case.status` and `Case.urgency` are enums. `Coverage.plan_id` is required (no default).
- `Provider.npi` must match `^[0-9]{10}$`.
- The MinIO container in the compose stack is `minio` (MINIO_ROOT_USER=minioadmin, MINIO_ROOT_PASSWORD=minioadmin, endpoint `minio:9000` internally, `localhost:9000` from host).

---

## File Map

**New files:**

| File | Responsibility |
|---|---|
| `enstellar_workflow/normalization/__init__.py` | Package exports: `PasBundleMapper`, `MinioStore`, `NormalizationSettings`, `get_normalization_settings` |
| `enstellar_workflow/normalization/config.py` | `NormalizationSettings` (pydantic-settings, `MINIO_` prefix) |
| `enstellar_workflow/normalization/mapper.py` | `PasBundleMapper.map()` + all helper functions |
| `enstellar_workflow/normalization/storage.py` | `MinioStore.upload()` |
| `enstellar_workflow/normalization/api.py` | FastAPI `APIRouter` for `POST /internal/normalize` |
| `enstellar_workflow/main.py` | FastAPI app entry point (imports normalization router) |
| `tests/test_normalization_mapper.py` | Unit tests for mapper (no real MinIO, no network) |
| `tests/test_normalization_storage.py` | Integration test with MinIO Testcontainer |
| `tests/fixtures/sample_pas_bundle.json` | Sample PAS Bundle FHIR JSON for tests |

**Modified:**

| File | Change |
|---|---|
| `services/workflow-engine/pyproject.toml` | Add `minio>=7.2`, `fastapi>=0.111`, `uvicorn[standard]>=0.30` to deps; add `canonical-model` to deps + uv.sources; add `testcontainers[minio]>=4.7`, `httpx>=0.27` to dev |

---

## Task 1: Update Dependencies

**Files modified:** `services/workflow-engine/pyproject.toml`

- [ ] **Step 1.1: Edit `services/workflow-engine/pyproject.toml`**

Replace the `[project]` dependencies and `[dependency-groups]` sections and add `[tool.uv.sources]` entry for canonical-model:

```toml
[project]
name = "enstellar-workflow"
version = "0.1.0"
description = "Enstellar workflow engine — deterministic case state machine"
requires-python = ">=3.12"
dependencies = [
    "asyncpg>=0.29",
    "aiokafka>=0.11",
    "pydantic>=2.9",
    "pydantic-settings>=2.3",
    "alembic>=1.13",
    "sqlalchemy[asyncio]>=2.0",
    "enstellar-events",
    "canonical-model",
    "minio>=7.2",
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
]

[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "testcontainers[postgres]>=4.7",
    "testcontainers[kafka]>=4.7",
    "testcontainers[minio]>=4.7",
    "psycopg2-binary>=2.9",
    "httpx>=0.27",
]

[tool.uv.sources]
enstellar-events = { path = "../../packages/event-contracts", editable = true }
canonical-model = { path = "../../packages/canonical-model", editable = true }

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["enstellar_workflow"]
```

- [ ] **Step 1.2: Install updated dependencies**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/workflow-engine
uv sync --all-extras
```

Expected output ends with:
```
Resolved N packages in Xs
Installed N packages in Xs
```

No errors. Verify with:
```bash
uv run python -c "import minio; import fastapi; from canonical_model import Case; print('OK')"
```

Expected: `OK`

---

## Task 2: Create the Sample PAS Bundle Fixture

**Files created:** `tests/fixtures/sample_pas_bundle.json`

- [ ] **Step 2.1: Create the fixtures directory**

```bash
mkdir -p /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/workflow-engine/tests/fixtures
```

Expected: no output.

- [ ] **Step 2.2: Create `tests/fixtures/sample_pas_bundle.json`**

```json
{
  "resourceType": "Bundle",
  "id": "pas-bundle-001",
  "meta": {
    "profile": [
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-pas-request-bundle"
    ]
  },
  "type": "collection",
  "entry": [
    {
      "fullUrl": "urn:uuid:claim-001",
      "resource": {
        "resourceType": "Claim",
        "id": "claim-001",
        "use": "preauthorization",
        "status": "active",
        "patient": {"reference": "Patient/pat-001"},
        "provider": {"reference": "Practitioner/pract-001"},
        "careTeam": [
          {"sequence": 1, "provider": {"reference": "Practitioner/pract-002"}}
        ],
        "insurance": [
          {
            "sequence": 1,
            "focal": true,
            "coverage": {"reference": "Coverage/cov-001"}
          }
        ],
        "item": [
          {
            "sequence": 1,
            "category": {
              "coding": [
                {
                  "system": "https://codesystem.x12.org/005010/1365",
                  "code": "PT"
                }
              ]
            },
            "productOrService": {
              "coding": [
                {
                  "system": "http://www.ama-assn.org/go/cpt",
                  "code": "97110",
                  "display": "Therapeutic Exercise"
                }
              ]
            },
            "quantity": {"value": 12, "unit": "visits"},
            "diagnosisSequence": [1]
          }
        ],
        "diagnosis": [
          {
            "sequence": 1,
            "diagnosisCodeableConcept": {
              "coding": [
                {
                  "system": "http://hl7.org/fhir/sid/icd-10-cm",
                  "code": "M54.5",
                  "display": "Low back pain"
                }
              ]
            }
          }
        ]
      }
    },
    {
      "fullUrl": "urn:uuid:pat-001",
      "resource": {
        "resourceType": "Patient",
        "id": "pat-001",
        "name": [{"family": "Smith", "given": ["Jane"]}],
        "birthDate": "1985-04-12",
        "gender": "female",
        "identifier": [
          {
            "system": "https://example.org/mrn",
            "value": "MRN-001"
          }
        ]
      }
    },
    {
      "fullUrl": "urn:uuid:pract-001",
      "resource": {
        "resourceType": "Practitioner",
        "id": "pract-001",
        "name": [{"family": "Jones", "given": ["Bob"]}],
        "identifier": [
          {
            "system": "http://hl7.org/fhir/sid/us-npi",
            "value": "1234567890"
          }
        ]
      }
    },
    {
      "fullUrl": "urn:uuid:pract-002",
      "resource": {
        "resourceType": "Practitioner",
        "id": "pract-002",
        "name": [{"family": "Lee", "given": ["Alice"]}],
        "identifier": [
          {
            "system": "http://hl7.org/fhir/sid/us-npi",
            "value": "0987654321"
          }
        ]
      }
    },
    {
      "fullUrl": "urn:uuid:cov-001",
      "resource": {
        "resourceType": "Coverage",
        "id": "cov-001",
        "subscriber": {"reference": "Patient/pat-001"},
        "subscriberId": "SUB-12345",
        "payor": [{"display": "ACME Health Plan"}],
        "class": [
          {
            "type": {
              "coding": [{"system": "http://terminology.hl7.org/CodeSystem/coverage-class", "code": "group"}]
            },
            "value": "GRP-999",
            "name": "ACME PPO"
          },
          {
            "type": {
              "coding": [{"system": "http://terminology.hl7.org/CodeSystem/coverage-class", "code": "plan"}]
            },
            "value": "PLAN-ACME-PPO-2025",
            "name": "ACME PPO 2025"
          }
        ],
        "period": {"start": "2025-01-01", "end": "2025-12-31"}
      }
    }
  ]
}
```

---

## Task 3: Write Failing Mapper Tests

**Files created:** `tests/test_normalization_mapper.py`

- [ ] **Step 3.1: Create `tests/test_normalization_mapper.py`**

```python
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
        # Remove Patient entry
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
```

- [ ] **Step 3.2: Confirm tests are discovered but FAIL (mapper not yet implemented)**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/workflow-engine
uv run pytest tests/test_normalization_mapper.py -v --tb=short 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'enstellar_workflow.normalization'` — this is the expected red state.

---

## Task 4: Implement `mapper.py`

**Files created:** `enstellar_workflow/normalization/__init__.py`, `enstellar_workflow/normalization/mapper.py`

- [ ] **Step 4.1: Create `enstellar_workflow/normalization/__init__.py`**

```python
"""Normalization — FHIR PAS Bundle to canonical Case."""
from .mapper import PasBundleMapper
from .storage import MinioStore
from .config import NormalizationSettings, get_normalization_settings

__all__ = [
    "PasBundleMapper",
    "MinioStore",
    "NormalizationSettings",
    "get_normalization_settings",
]
```

- [ ] **Step 4.2: Create `enstellar_workflow/normalization/mapper.py`**

```python
"""PasBundleMapper — maps a PAS FHIR Bundle dict to a canonical Case.

No FHIR library used; the bundle is expected as already-parsed Python dict.
Raises ValueError on missing required data.
Propagates tenant_id to every sub-entity (invariant #5).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from canonical_model import (
    Case,
    Coverage,
    Gender,
    Identifier,
    Member,
    Provider,
    ServiceLine,
    Status,
    Urgency,
)

NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi"
ICD10_SYSTEM = "http://hl7.org/fhir/sid/icd-10-cm"
CPT_SYSTEM = "http://www.ama-assn.org/go/cpt"
COVERAGE_CLASS_SYSTEM = "http://terminology.hl7.org/CodeSystem/coverage-class"


class PasBundleMapper:
    """Maps a PAS `Claim/$submit` Bundle dict to a canonical Case."""

    def map(
        self,
        bundle: dict[str, Any],
        tenant_id: str,
        correlation_id: str,
    ) -> Case:
        """Map a PAS FHIR Bundle dict to a canonical Case.

        Args:
            bundle: Parsed PAS Bundle JSON as Python dict.
            tenant_id: Tenant owning this case (propagated to all sub-entities).
            correlation_id: External correlation/tracking ID.

        Returns:
            A fully-populated canonical Case with status=intake, urgency=standard.

        Raises:
            ValueError: If tenant_id is blank, Claim is missing, Patient is missing,
                        Coverage is missing, or requesting Practitioner NPI is absent.
        """
        if not tenant_id or not tenant_id.strip():
            raise ValueError("tenant_id must not be blank — invariant #5")

        # Build a resource lookup: "ResourceType/id" → resource dict
        resources: dict[str, dict[str, Any]] = {
            f"{e['resource']['resourceType']}/{e['resource']['id']}": e["resource"]
            for e in bundle.get("entry", [])
            if "resource" in e and "id" in e.get("resource", {})
        }

        # Locate the Claim resource
        claim = next(
            (r for r in resources.values() if r.get("resourceType") == "Claim"),
            None,
        )
        if not claim:
            raise ValueError("Bundle contains no Claim resource")

        # Resolve referenced resources
        patient_ref = claim.get("patient", {}).get("reference", "")
        patient = resources.get(patient_ref)

        requesting_ref = claim.get("provider", {}).get("reference", "")
        requesting_pract = resources.get(requesting_ref)

        care_team = claim.get("careTeam", [])
        servicing_ref = care_team[0]["provider"]["reference"] if care_team else None
        servicing_pract = resources.get(servicing_ref) if servicing_ref else None

        insurance_list = claim.get("insurance", [])
        insurance = insurance_list[0] if insurance_list else {}
        coverage_ref = insurance.get("coverage", {}).get("reference", "")
        coverage_res = resources.get(coverage_ref)

        # Generate a stable member_id shared between Member and Coverage
        member_id = uuid.uuid4()

        member = _map_member(patient, tenant_id, member_id)
        coverage = _map_coverage(coverage_res, tenant_id, member_id)

        now = datetime.now(timezone.utc)
        return Case(
            case_id=uuid.uuid4(),
            tenant_id=tenant_id,
            correlation_id=correlation_id,
            lob=coverage.lob,
            status=Status.intake,
            urgency=Urgency.standard,
            member=member,
            coverage=coverage,
            requesting_provider=_map_provider(requesting_pract, tenant_id),
            servicing_provider=(
                _map_provider(servicing_pract, tenant_id) if servicing_pract else None
            ),
            service_lines=_map_service_lines(claim, tenant_id),
            decisions=[],
            created_at=now,
            updated_at=now,
        )


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _map_member(
    patient: dict[str, Any] | None,
    tenant_id: str,
    member_id: uuid.UUID,
) -> Member:
    """Map a FHIR Patient resource to a canonical Member."""
    if not patient:
        raise ValueError("Patient resource not found in bundle — required for Member mapping")

    name_list = patient.get("name") or [{}]
    name_obj = name_list[0]
    family = name_obj.get("family", "")
    given_list = name_obj.get("given") or [""]
    first_name = given_list[0]

    raw_dob = patient.get("birthDate")
    if not raw_dob:
        raise ValueError("Patient.birthDate is required but missing")
    dob = date.fromisoformat(raw_dob)

    fhir_gender = patient.get("gender", "unknown")
    gender_map: dict[str, Gender] = {
        "male": Gender.M,
        "female": Gender.F,
        "other": Gender.O,
        "unknown": Gender.U,
    }
    gender = gender_map.get(fhir_gender, Gender.U)

    raw_identifiers = patient.get("identifier") or []
    mrn = next(
        (i["value"] for i in raw_identifiers if "mrn" in i.get("system", "").lower()),
        None,
    )
    identifiers = [
        Identifier(system=i["system"], value=i["value"]) for i in raw_identifiers
    ]

    return Member(
        member_id=member_id,
        tenant_id=tenant_id,
        mrn=mrn,
        first_name=first_name,
        last_name=family,
        date_of_birth=dob,
        gender=gender,
        identifiers=identifiers,
    )


def _map_provider(
    pract: dict[str, Any] | None,
    tenant_id: str,
) -> Provider:
    """Map a FHIR Practitioner resource to a canonical Provider."""
    if not pract:
        raise ValueError("Practitioner resource not found in bundle — required for Provider mapping")

    name_list = pract.get("name") or [{}]
    name_obj = name_list[0]
    family = name_obj.get("family", "")
    given_list = name_obj.get("given") or [""]
    given = given_list[0]
    full_name = f"{given} {family}".strip()

    raw_identifiers = pract.get("identifier") or []
    npi = next(
        (i["value"] for i in raw_identifiers if NPI_SYSTEM in i.get("system", "")),
        None,
    )
    if not npi:
        resource_id = pract.get("id", "unknown")
        raise ValueError(
            f"NPI not found in Practitioner/{resource_id} identifiers — "
            f"system {NPI_SYSTEM!r} required"
        )

    identifiers = [
        Identifier(system=i["system"], value=i["value"]) for i in raw_identifiers
    ]

    return Provider(
        provider_id=uuid.uuid4(),
        tenant_id=tenant_id,
        npi=npi,
        name=full_name,
        identifiers=identifiers,
    )


def _map_coverage(
    coverage_res: dict[str, Any] | None,
    tenant_id: str,
    member_id: uuid.UUID,
) -> Coverage:
    """Map a FHIR Coverage resource to a canonical Coverage."""
    if not coverage_res:
        raise ValueError("Coverage resource not found in bundle — required for Coverage mapping")

    # Extract plan_id and group_id from Coverage.class[]
    plan_id: str | None = None
    group_id: str | None = None
    for cls in coverage_res.get("class") or []:
        type_codings = cls.get("type", {}).get("coding") or []
        codes = {c.get("code", "") for c in type_codings}
        if "plan" in codes:
            plan_id = cls.get("value")
        elif "group" in codes:
            group_id = cls.get("value")

    # Fall back: group value as plan_id if no plan class defined
    if not plan_id:
        plan_id = group_id or "UNKNOWN"

    payor_list = coverage_res.get("payor") or [{}]
    payer_name = payor_list[0].get("display", "Unknown Payer")

    subscriber_id = coverage_res.get("subscriberId", "")

    period = coverage_res.get("period") or {}
    effective_date = (
        date.fromisoformat(period["start"]) if "start" in period else date.today()
    )
    termination_date = (
        date.fromisoformat(period["end"]) if "end" in period else None
    )

    lob = _extract_lob(coverage_res)

    return Coverage(
        coverage_id=uuid.uuid4(),
        tenant_id=tenant_id,
        member_id=member_id,
        plan_id=plan_id,
        group_id=group_id,
        subscriber_id=subscriber_id,
        payer_name=payer_name,
        lob=lob,
        effective_date=effective_date,
        termination_date=termination_date,
    )


def _extract_lob(coverage_res: dict[str, Any] | None) -> str:
    """Infer line-of-business from Coverage. Defaults to 'commercial'.

    Looks for a 'plan' class and inspects the plan name for keywords.
    Medicare/Medicaid names in the plan or payer are treated as indicators.
    """
    if not coverage_res:
        return "commercial"

    # Check payor display name
    payor_list = coverage_res.get("payor") or [{}]
    payor_name = payor_list[0].get("display", "").lower()
    if "medicare" in payor_name:
        return "medicare"
    if "medicaid" in payor_name:
        return "medicaid"

    # Check plan class names
    for cls in coverage_res.get("class") or []:
        type_codings = cls.get("type", {}).get("coding") or []
        codes = {c.get("code", "") for c in type_codings}
        if "plan" in codes:
            plan_name = cls.get("name", "").lower()
            if "medicare" in plan_name:
                return "medicare"
            if "medicaid" in plan_name:
                return "medicaid"

    return "commercial"


def _map_service_lines(claim: dict[str, Any], tenant_id: str) -> list[ServiceLine]:
    """Map Claim.item[] to canonical ServiceLine list.

    diagnosis_codes are resolved from Claim.diagnosis[] via diagnosisSequence references.
    service_type_code comes from Claim.item[].category.coding[0].code (X12 service type).
    Falls back to '1' (Medical Care) if no category present.
    """
    # Build diagnosis lookup: 1-based sequence → ICD-10 code
    diag_map: dict[int, str] = {}
    for d in claim.get("diagnosis") or []:
        seq = d.get("sequence")
        codings = d.get("diagnosisCodeableConcept", {}).get("coding") or []
        icd = next(
            (c["code"] for c in codings if ICD10_SYSTEM in c.get("system", "")),
            None,
        )
        if seq and icd:
            diag_map[seq] = icd

    lines: list[ServiceLine] = []
    for item in claim.get("item") or []:
        seq = item["sequence"]

        # Procedure code (CPT preferred, fallback to first coding)
        prod_codings = item.get("productOrService", {}).get("coding") or []
        cpt = next(
            (c["code"] for c in prod_codings if CPT_SYSTEM in c.get("system", "")),
            None,
        )
        if not cpt:
            cpt = prod_codings[0]["code"] if prod_codings else "UNKNOWN"

        # Procedure description (optional)
        procedure_description: str | None = next(
            (c.get("display") for c in prod_codings if c.get("display")),
            None,
        )

        # Quantity
        qty_obj = item.get("quantity") or {}
        quantity: float | None = qty_obj.get("value")
        units: str | None = qty_obj.get("unit")

        # Diagnosis codes resolved via diagnosisSequence
        diag_seqs: list[int] = item.get("diagnosisSequence") or []
        diag_codes: list[str] = [diag_map[s] for s in diag_seqs if s in diag_map]

        # X12 service type code from item.category; default "1" (Medical Care)
        category_codings = item.get("category", {}).get("coding") or []
        service_type_code = (
            category_codings[0]["code"] if category_codings else "1"
        )

        # Place of service (optional)
        loc = item.get("locationCodeableConcept", {})
        loc_codings = loc.get("coding") or []
        place_of_service: str | None = (
            loc_codings[0].get("code") if loc_codings else None
        )

        # Date range (optional)
        svc_period = item.get("servicedPeriod") or {}
        requested_start: date | None = (
            date.fromisoformat(svc_period["start"]) if "start" in svc_period else None
        )
        requested_end: date | None = (
            date.fromisoformat(svc_period["end"]) if "end" in svc_period else None
        )

        lines.append(
            ServiceLine(
                service_line_id=uuid.uuid4(),
                tenant_id=tenant_id,
                sequence=seq,
                service_type_code=service_type_code,
                procedure_code=cpt,
                procedure_description=procedure_description,
                quantity=quantity,
                units=units,
                diagnosis_codes=diag_codes,
                place_of_service=place_of_service,
                requested_start_date=requested_start,
                requested_end_date=requested_end,
            )
        )

    return lines
```

---

## Task 5: Run Mapper Tests — All Pass

- [ ] **Step 5.1: Run mapper unit tests**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/workflow-engine
uv run pytest tests/test_normalization_mapper.py -v
```

Expected output (all 35 tests pass):

```
tests/test_normalization_mapper.py::TestPasBundleMapper::test_returns_case_instance PASSED
tests/test_normalization_mapper.py::TestPasBundleMapper::test_status_is_intake PASSED
tests/test_normalization_mapper.py::TestPasBundleMapper::test_urgency_is_standard PASSED
tests/test_normalization_mapper.py::TestPasBundleMapper::test_case_id_is_uuid PASSED
tests/test_normalization_mapper.py::TestPasBundleMapper::test_tenant_id_on_case PASSED
tests/test_normalization_mapper.py::TestPasBundleMapper::test_correlation_id_preserved PASSED
tests/test_normalization_mapper.py::TestPasBundleMapper::test_created_at_is_timezone_aware PASSED
tests/test_normalization_mapper.py::TestMemberMapping::test_member_first_name PASSED
...
tests/test_normalization_mapper.py::TestRoundTrip::test_round_trip_json PASSED
tests/test_normalization_mapper.py::TestRoundTrip::test_round_trip_json_string PASSED

================================= 35 passed in Xs =================================
```

If any test fails, debug before proceeding to Task 6.

---

## Task 6: Write Failing MinIO Storage Tests

**Files created:** `tests/test_normalization_storage.py`

- [ ] **Step 6.1: Create `tests/test_normalization_storage.py`**

```python
"""Integration tests for MinioStore — requires a running MinIO container.

Uses testcontainers to spin up MinIO for the test session.
"""
from __future__ import annotations

import json
import pathlib

import pytest
from testcontainers.minio import MinioContainer

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
MINIO_IMAGE = "minio/minio:RELEASE.2024-07-04T19-14-18Z"


@pytest.fixture(scope="module")
def minio_container():
    """Spin up a MinIO container for the module-scoped tests."""
    with MinioContainer(image=MINIO_IMAGE) as minio:
        yield minio


@pytest.fixture(scope="module")
def normalization_settings(minio_container):
    """Build NormalizationSettings pointing at the test MinIO container."""
    from enstellar_workflow.normalization.config import NormalizationSettings

    # MinioContainer exposes get_url() → "http://host:port"
    url = minio_container.get_url()  # e.g. "http://localhost:32768"
    host_port = url.replace("http://", "").replace("https://", "")

    return NormalizationSettings(
        minio_endpoint=host_port,
        minio_access_key=minio_container.access_key,
        minio_secret_key=minio_container.secret_key,
        minio_secure=False,
        minio_bucket="test-raw-bundles",
    )


@pytest.fixture(scope="module")
def minio_store(normalization_settings):
    from enstellar_workflow.normalization.storage import MinioStore
    return MinioStore(normalization_settings)


@pytest.fixture(scope="module")
def sample_bundle() -> dict:
    return json.loads((FIXTURES / "sample_pas_bundle.json").read_text())


class TestMinioStore:
    def test_upload_returns_nonempty_key(self, minio_store, sample_bundle):
        key = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id="corr-store-001",
            bundle=sample_bundle,
        )
        assert key, "upload() must return a non-empty object key"

    def test_upload_key_contains_tenant_id(self, minio_store, sample_bundle):
        key = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id="corr-store-002",
            bundle=sample_bundle,
        )
        assert "tenant-acme" in key

    def test_upload_key_contains_correlation_id(self, minio_store, sample_bundle):
        key = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id="corr-store-003",
            bundle=sample_bundle,
        )
        assert "corr-store-003" in key

    def test_upload_key_ends_with_json(self, minio_store, sample_bundle):
        key = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id="corr-store-004",
            bundle=sample_bundle,
        )
        assert key.endswith(".json")

    def test_uploaded_object_is_retrievable(self, minio_store, normalization_settings, sample_bundle):
        """The uploaded bytes must deserialize back to the original bundle."""
        from minio import Minio

        correlation_id = "corr-store-005"
        full_key = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id=correlation_id,
            bundle=sample_bundle,
        )

        # full_key = "bucket/object-path"
        bucket, _, object_key = full_key.partition("/")

        client = Minio(
            normalization_settings.minio_endpoint,
            access_key=normalization_settings.minio_access_key,
            secret_key=normalization_settings.minio_secret_key,
            secure=normalization_settings.minio_secure,
        )
        response = client.get_object(bucket, object_key)
        try:
            data = json.loads(response.read())
        finally:
            response.close()
            response.release_conn()

        assert data["resourceType"] == "Bundle"
        assert data["id"] == sample_bundle["id"]

    def test_two_uploads_same_correlation_id_idempotent(self, minio_store, sample_bundle):
        """Uploading twice with same correlation_id overwrites (no error thrown)."""
        key1 = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id="corr-idem-001",
            bundle=sample_bundle,
        )
        key2 = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id="corr-idem-001",
            bundle=sample_bundle,
        )
        assert key1 == key2

    def test_different_tenants_produce_different_keys(self, minio_store, sample_bundle):
        key_a = minio_store.upload(
            tenant_id="tenant-a",
            correlation_id="corr-x",
            bundle=sample_bundle,
        )
        key_b = minio_store.upload(
            tenant_id="tenant-b",
            correlation_id="corr-x",
            bundle=sample_bundle,
        )
        assert key_a != key_b
        assert "tenant-a" in key_a
        assert "tenant-b" in key_b
```

- [ ] **Step 6.2: Confirm tests are discovered but FAIL**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/workflow-engine
uv run pytest tests/test_normalization_storage.py -v --tb=short 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'enstellar_workflow.normalization.storage'` — expected red state.

---

## Task 7: Implement `config.py` and `storage.py`

**Files created:** `enstellar_workflow/normalization/config.py`, `enstellar_workflow/normalization/storage.py`

- [ ] **Step 7.1: Create `enstellar_workflow/normalization/config.py`**

```python
"""MinIO + normalization settings, loaded from environment variables.

Environment variable prefix: MINIO_
  MINIO_ENDPOINT     — host:port, e.g. "localhost:9000"
  MINIO_ACCESS_KEY   — access key (default: minioadmin)
  MINIO_SECRET_KEY   — secret key (default: minioadmin)
  MINIO_SECURE       — TLS (default: false)
  MINIO_BUCKET       — object store bucket name (default: enstellar-raw-bundles)
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class NormalizationSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MINIO_", case_sensitive=False)

    endpoint: str = "localhost:9000"
    access_key: str = "minioadmin"
    secret_key: str = "minioadmin"
    secure: bool = False
    bucket: str = "enstellar-raw-bundles"

    # Expose these as properties with the full attribute name for clarity
    @property
    def minio_endpoint(self) -> str:
        return self.endpoint

    @property
    def minio_access_key(self) -> str:
        return self.access_key

    @property
    def minio_secret_key(self) -> str:
        return self.secret_key

    @property
    def minio_secure(self) -> bool:
        return self.secure

    @property
    def minio_bucket(self) -> str:
        return self.bucket


@lru_cache(maxsize=1)
def get_normalization_settings() -> NormalizationSettings:
    return NormalizationSettings()
```

> **Note:** The `NormalizationSettings` constructor accepts keyword arguments directly for testing (e.g., `NormalizationSettings(minio_endpoint="localhost:9000", ...)`). However, since pydantic-settings maps env_prefix + field name, the actual env vars are `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, etc. The test fixture passes `endpoint=`, `access_key=`, etc. directly.

- [ ] **Step 7.2: Revise `config.py` to accept direct constructor args cleanly**

The test fixture passes `minio_endpoint=`, `minio_access_key=` etc. as constructor kwargs. To keep the settings class simple, rename the fields to use the full names and set the prefix to empty string. Update `config.py`:

```python
"""MinIO + normalization settings, loaded from environment variables.

Environment variable names (no prefix):
  MINIO_ENDPOINT     — host:port, e.g. "localhost:9000"
  MINIO_ACCESS_KEY   — MinIO access key (default: minioadmin)
  MINIO_SECRET_KEY   — MinIO secret key (default: minioadmin)
  MINIO_SECURE       — use TLS (default: false)
  MINIO_BUCKET       — target bucket (default: enstellar-raw-bundles)
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class NormalizationSettings(BaseSettings):
    """All fields correspond 1-to-1 with their environment variable names."""
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_secure: bool = False
    minio_bucket: str = "enstellar-raw-bundles"


@lru_cache(maxsize=1)
def get_normalization_settings() -> NormalizationSettings:
    return NormalizationSettings()
```

- [ ] **Step 7.3: Create `enstellar_workflow/normalization/storage.py`**

```python
"""MinioStore — stores raw PAS bundles in MinIO object storage.

Key format: {bucket}/{tenant_id}/raw-bundles/{date}/{correlation_id}.json

Store-first-transform-second pattern: call upload() before any mapping attempt.
On mapping errors the raw bundle is already safely stored with provenance.
"""
from __future__ import annotations

import io
import json
from datetime import date, timezone, datetime
from typing import Any

from minio import Minio
from minio.error import S3Error

from .config import NormalizationSettings


class MinioStore:
    """Uploads raw PAS bundle JSON to MinIO and returns the full object key."""

    def __init__(self, settings: NormalizationSettings) -> None:
        self._client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )
        self._bucket = settings.minio_bucket

    def upload(
        self,
        tenant_id: str,
        correlation_id: str,
        bundle: dict[str, Any],
    ) -> str:
        """Upload raw bundle JSON to MinIO.

        Args:
            tenant_id: Tenant owning the bundle (used as key path prefix).
            correlation_id: External correlation ID (used as filename base).
            bundle: Parsed PAS Bundle as Python dict.

        Returns:
            Full object reference: "{bucket}/{object_key}"
            e.g. "enstellar-raw-bundles/tenant-acme/raw-bundles/2026-06-05/corr-abc-123.json"

        Raises:
            S3Error: On MinIO communication failure.
        """
        self._ensure_bucket()

        today = datetime.now(timezone.utc).date().isoformat()
        object_key = f"{tenant_id}/raw-bundles/{today}/{correlation_id}.json"

        payload = json.dumps(bundle, separators=(",", ":")).encode("utf-8")
        stream = io.BytesIO(payload)
        length = len(payload)

        self._client.put_object(
            bucket_name=self._bucket,
            object_name=object_key,
            data=stream,
            length=length,
            content_type="application/fhir+json",
        )

        return f"{self._bucket}/{object_key}"

    def _ensure_bucket(self) -> None:
        """Create the bucket if it does not exist."""
        try:
            if not self._client.bucket_exists(self._bucket):
                self._client.make_bucket(self._bucket)
        except S3Error as exc:
            # Race condition: another process created it between exists() and make()
            if exc.code != "BucketAlreadyOwnedByYou":
                raise
```

---

## Task 8: Run All Normalization Tests — All Pass

- [ ] **Step 8.1: Run mapper tests again to confirm no regressions**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/workflow-engine
uv run pytest tests/test_normalization_mapper.py -v
```

Expected: all 35 tests pass.

- [ ] **Step 8.2: Run storage integration tests (requires Docker)**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/workflow-engine
uv run pytest tests/test_normalization_storage.py -v --timeout=120
```

Expected output:

```
tests/test_normalization_storage.py::TestMinioStore::test_upload_returns_nonempty_key PASSED
tests/test_normalization_storage.py::TestMinioStore::test_upload_key_contains_tenant_id PASSED
tests/test_normalization_storage.py::TestMinioStore::test_upload_key_contains_correlation_id PASSED
tests/test_normalization_storage.py::TestMinioStore::test_upload_key_ends_with_json PASSED
tests/test_normalization_storage.py::TestMinioStore::test_uploaded_object_is_retrievable PASSED
tests/test_normalization_storage.py::TestMinioStore::test_two_uploads_same_correlation_id_idempotent PASSED
tests/test_normalization_storage.py::TestMinioStore::test_different_tenants_produce_different_keys PASSED

================================= 7 passed in Xs =================================
```

Docker must be running. The test pull of `minio/minio:RELEASE.2024-07-04T19-14-18Z` may take 30–60s on first run.

---

## Task 9: Add FastAPI Normalization Endpoint (Required for T06 Integration)

T06's `NormalizationClient.java` calls `POST http://workflow-engine:8000/internal/normalize`. This task adds the minimal FastAPI app to the workflow-engine.

**Files created:** `enstellar_workflow/normalization/api.py`, `enstellar_workflow/main.py`

- [ ] **Step 9.1: Create `enstellar_workflow/normalization/api.py`**

```python
"""FastAPI router for the internal normalization endpoint.

POST /internal/normalize
  Body:  {"bundle": {...}, "tenant_id": "...", "correlation_id": "..."}
  Response 200: canonical Case JSON with extra field "_raw_bundle_key"
  Response 422: {"detail": "<error message>"} on mapping failure

This endpoint is internal-only (not exposed externally). T06's
NormalizationClient.java calls it synchronously from PasClaimSubmitProvider.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .config import get_normalization_settings
from .mapper import PasBundleMapper
from .storage import MinioStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["normalization"])


class NormalizeRequest(BaseModel):
    bundle: dict[str, Any]
    tenant_id: str
    correlation_id: str


@router.post("/normalize", response_model=None)
async def normalize(req: NormalizeRequest) -> dict[str, Any]:
    """Store raw bundle in MinIO, map to canonical Case, return Case JSON.

    Store-first pattern: even if mapping fails, the raw bundle is retained
    in MinIO under {tenant_id}/raw-bundles/{date}/{correlation_id}.json.
    """
    settings = get_normalization_settings()
    store = MinioStore(settings)
    mapper = PasBundleMapper()

    # 1. Store raw bundle FIRST (invariant: raw bundle always preserved)
    try:
        raw_key = store.upload(req.tenant_id, req.correlation_id, req.bundle)
        logger.info(
            "raw_bundle_stored",
            extra={"tenant_id": req.tenant_id, "correlation_id": req.correlation_id, "key": raw_key},
        )
    except Exception as exc:
        logger.error("raw_bundle_store_failed", extra={"error": str(exc)})
        raise HTTPException(status_code=503, detail=f"MinIO store failed: {exc}") from exc

    # 2. Map to canonical Case
    try:
        case = mapper.map(req.bundle, req.tenant_id, req.correlation_id)
    except ValueError as exc:
        logger.warning(
            "bundle_mapping_failed",
            extra={"tenant_id": req.tenant_id, "correlation_id": req.correlation_id, "error": str(exc)},
        )
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    data = case.model_dump(mode="json")
    data["_raw_bundle_key"] = raw_key
    return data
```

- [ ] **Step 9.2: Create `enstellar_workflow/main.py`**

```python
"""Enstellar Workflow Engine — FastAPI application entry point.

Start with:
    uvicorn enstellar_workflow.main:app --host 0.0.0.0 --port 8000 --reload
"""
from __future__ import annotations

import logging
import sys

from fastapi import FastAPI

from enstellar_workflow.normalization.api import router as normalization_router

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": "%(message)s"}',
)

app = FastAPI(
    title="Enstellar Workflow Engine",
    version="0.1.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.include_router(normalization_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 9.3: Add a smoke test for the FastAPI endpoint**

Append the following to `tests/test_normalization_mapper.py`:

```python
# --- FastAPI endpoint smoke test ---

class TestNormalizeEndpoint:
    """Tests the POST /internal/normalize endpoint with a real mapper but mocked MinIO."""

    def test_normalize_endpoint_returns_200(self, sample_bundle, monkeypatch):
        """POST /internal/normalize returns 200 with canonical case JSON."""
        import os
        from fastapi.testclient import TestClient

        # Monkeypatch MinioStore.upload to avoid real MinIO
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
```

- [ ] **Step 9.4: Run all mapper + endpoint tests**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/workflow-engine
uv run pytest tests/test_normalization_mapper.py -v
```

Expected: all tests pass (35 original + 3 endpoint tests = 38 total).

---

## Task 10: Run Full Normalization Test Suite

- [ ] **Step 10.1: Run all normalization tests together**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/workflow-engine
uv run pytest tests/test_normalization_mapper.py tests/test_normalization_storage.py -v --timeout=120
```

Expected: 38 + 7 = 45 tests, all pass.

- [ ] **Step 10.2: Run the full test suite to confirm no regressions**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/workflow-engine
uv run pytest --timeout=120 -v
```

Expected: all previously-passing tests still pass, plus the 45 new ones.

---

## Task 11: Wire into Makefile + CI, Mark T07 Done

**Files modified:** `Makefile`, `.github/workflows/ci.yml`, `.claude/task-graph.md`

- [ ] **Step 11.1: Verify `make test` includes workflow-engine tests**

Check `Makefile` target at the monorepo root. Confirm `cd services/workflow-engine && uv run pytest` is present. If the Makefile has no workflow-engine target, add:

```makefile
.PHONY: test-workflow
test-workflow:
	cd services/workflow-engine && uv run pytest --timeout=120

test: test-workflow
```

Run:
```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar
make test-workflow
```

Expected: all workflow-engine tests pass.

- [ ] **Step 11.2: Verify uvicorn start works**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/workflow-engine
uv run uvicorn enstellar_workflow.main:app --host 0.0.0.0 --port 8001 &
sleep 2
curl -s http://localhost:8001/health | python3 -m json.tool
kill %1
```

Expected:
```json
{
    "status": "ok"
}
```

- [ ] **Step 11.3: Mark T07 done in `.claude/task-graph.md`**

Open `.claude/task-graph.md` and change the T07 entry from `[ ]` to `[x]`.

---

## Task 12: Commit

- [ ] **Step 12.1: Stage the new files**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar
git add services/workflow-engine/pyproject.toml
git add services/workflow-engine/enstellar_workflow/normalization/
git add services/workflow-engine/enstellar_workflow/main.py
git add services/workflow-engine/tests/test_normalization_mapper.py
git add services/workflow-engine/tests/test_normalization_storage.py
git add services/workflow-engine/tests/fixtures/sample_pas_bundle.json
git add .claude/task-graph.md
```

- [ ] **Step 12.2: Confirm staged files**

```bash
git diff --cached --name-only
```

Expected:
```
.claude/task-graph.md
services/workflow-engine/enstellar_workflow/main.py
services/workflow-engine/enstellar_workflow/normalization/__init__.py
services/workflow-engine/enstellar_workflow/normalization/api.py
services/workflow-engine/enstellar_workflow/normalization/config.py
services/workflow-engine/enstellar_workflow/normalization/mapper.py
services/workflow-engine/enstellar_workflow/normalization/storage.py
services/workflow-engine/pyproject.toml
services/workflow-engine/tests/fixtures/sample_pas_bundle.json
services/workflow-engine/tests/test_normalization_mapper.py
services/workflow-engine/tests/test_normalization_storage.py
```

- [ ] **Step 12.3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(T07): FHIR→canonical normalization — PasBundleMapper, MinioStore, /internal/normalize

Implements lossless PAS Bundle → Case mapping with tenant_id propagation to
all sub-entities (Member, Provider, Coverage, ServiceLine). Raw bundles are
stored in MinIO before any transformation (store-first pattern). Exposes
POST /internal/normalize for T06 NormalizationClient integration.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

Expected: `[<branch> <sha>] feat(T07): FHIR→canonical normalization ...`

---

## Definition of Done Checklist

- [ ] `PasBundleMapper.map()` converts sample PAS bundle to a valid canonical `Case` — all 35 mapper tests pass.
- [ ] `tenant_id` is present on `Case`, `Member`, `Provider`, `Coverage`, every `ServiceLine`.
- [ ] `Case.case_id`, `Member.member_id`, `Provider.provider_id`, `Coverage.coverage_id`, `ServiceLine.service_line_id` are UUIDs.
- [ ] `Case.created_at` / `updated_at` are timezone-aware.
- [ ] Round-trip test: `Case.model_dump(mode="json")` → `Case.model_validate(...)` is lossless.
- [ ] `MinioStore.upload()` stores raw bundle and returns a key containing `{tenant_id}` and `{correlation_id}` — all 7 storage tests pass.
- [ ] `POST /internal/normalize` returns HTTP 200 with canonical Case + `_raw_bundle_key` field — 3 endpoint tests pass.
- [ ] Empty bundle returns HTTP 422.
- [ ] All pre-existing workflow-engine tests still pass (no regressions).
