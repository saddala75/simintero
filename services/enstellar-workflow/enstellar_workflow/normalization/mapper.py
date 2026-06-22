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

# Synthetic identifier system used to preserve the bundle Patient's FHIR logical
# id (e.g. "pat-001") as a STABLE member reference inside Member.identifiers.
# The canonical Member.member_id is a random UUID (and is a strict UUID-typed
# generated field we must not repurpose), so we stash the stable ref here so it
# can flow downstream as Digicore's member_ref (slice 1.1).
# TODO(slice-data-plane): a member_ref that actually MATCHES Digicore's seeded
# member fabric depends on the deferred intake→fabric evidence-plane slice; for
# now we thread the bundle's own logical id as-is to establish the wire contract.
FHIR_LOGICAL_ID_SYSTEM = "urn:enstellar:fhir-logical-id"


class PasBundleMapper:
    """Maps a PAS Claim/$submit Bundle dict to a canonical Case."""

    def map(
        self,
        bundle: dict[str, Any],
        tenant_id: str,
        correlation_id: str,
    ) -> Case:
        if not tenant_id or not tenant_id.strip():
            raise ValueError("tenant_id must not be blank — invariant #5")

        resources: dict[str, dict[str, Any]] = {
            f"{e['resource']['resourceType']}/{e['resource']['id']}": e["resource"]
            for e in bundle.get("entry", [])
            if "resource" in e
            and "resourceType" in e.get("resource", {})
            and "id" in e.get("resource", {})
        }

        claim = next(
            (r for r in resources.values() if r.get("resourceType") == "Claim"),
            None,
        )
        if not claim:
            raise ValueError("Bundle contains no Claim resource")

        patient_ref = claim.get("patient", {}).get("reference", "")
        patient = resources.get(patient_ref)

        requesting_ref = claim.get("provider", {}).get("reference", "")
        requesting_pract = resources.get(requesting_ref)

        care_team = claim.get("careTeam", [])
        servicing_ref = (
            care_team[0].get("provider", {}).get("reference") if care_team else None
        )
        servicing_pract = resources.get(servicing_ref) if servicing_ref else None

        insurance_list = claim.get("insurance", [])
        insurance = insurance_list[0] if insurance_list else {}
        coverage_ref = insurance.get("coverage", {}).get("reference", "")
        coverage_res = resources.get(coverage_ref)

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


def _map_member(
    patient: dict[str, Any] | None,
    tenant_id: str,
    member_id: uuid.UUID,
) -> Member:
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
        (i.get("value") for i in raw_identifiers if "mrn" in i.get("system", "").lower()),
        None,
    )
    identifiers = [
        Identifier(system=i.get("system", ""), value=i.get("value", ""))
        for i in raw_identifiers
    ]

    # Preserve the bundle Patient's FHIR logical id as a stable member reference.
    # member_id itself is a random UUID, so without this the only durable handle
    # on the originating patient would be lost. This is what flows to Digicore as
    # member_ref (slice 1.1).
    logical_id = patient.get("id")
    if logical_id:
        identifiers.append(
            Identifier(system=FHIR_LOGICAL_ID_SYSTEM, value=str(logical_id))
        )

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
        (i.get("value") for i in raw_identifiers if NPI_SYSTEM in i.get("system", "")),
        None,
    )
    if not npi:
        resource_id = pract.get("id", "unknown")
        raise ValueError(
            f"NPI not found in Practitioner/{resource_id} identifiers — "
            f"system {NPI_SYSTEM!r} required"
        )

    identifiers = [
        Identifier(system=i.get("system", ""), value=i.get("value", ""))
        for i in raw_identifiers
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
    if not coverage_res:
        raise ValueError("Coverage resource not found in bundle — required for Coverage mapping")

    plan_id: str | None = None
    group_id: str | None = None
    for cls in coverage_res.get("class") or []:
        type_codings = cls.get("type", {}).get("coding") or []
        codes = {c.get("code", "") for c in type_codings}
        if "plan" in codes:
            plan_id = cls.get("value")
        elif "group" in codes:
            group_id = cls.get("value")

    if not plan_id:
        plan_id = group_id or "UNKNOWN"

    payor_list = coverage_res.get("payor") or [{}]
    payer_name = payor_list[0].get("display", "Unknown Payer")

    subscriber_id = coverage_res.get("subscriberId", "")

    period = coverage_res.get("period") or {}
    effective_date = (
        date.fromisoformat(period["start"])
        if "start" in period
        else datetime.now(timezone.utc).date()
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


def _extract_lob(coverage_res: dict[str, Any]) -> str:
    payor_list = coverage_res.get("payor") or [{}]
    payor_name = payor_list[0].get("display", "").lower()
    if "medicare" in payor_name:
        return "medicare"
    if "medicaid" in payor_name:
        return "medicaid"

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
        seq = item.get("sequence")
        if seq is None:
            raise ValueError("Claim.item is missing required 'sequence' field")

        prod_codings = item.get("productOrService", {}).get("coding") or []
        cpt = next(
            (c["code"] for c in prod_codings if CPT_SYSTEM in c.get("system", "")),
            None,
        )
        if not cpt:
            cpt = prod_codings[0].get("code", "UNKNOWN") if prod_codings else "UNKNOWN"

        procedure_description: str | None = next(
            (c.get("display") for c in prod_codings if c.get("display")),
            None,
        )

        qty_obj = item.get("quantity") or {}
        quantity: float | None = qty_obj.get("value")
        units: str | None = qty_obj.get("unit")

        diag_seqs: list[int] = item.get("diagnosisSequence") or []
        diag_codes: list[str] = [diag_map[s] for s in diag_seqs if s in diag_map]

        category_codings = item.get("category", {}).get("coding") or []
        service_type_code = (
            category_codings[0].get("code", "1") if category_codings else "1"
        )

        loc = item.get("locationCodeableConcept", {})
        loc_codings = loc.get("coding") or []
        place_of_service: str | None = (
            loc_codings[0].get("code") if loc_codings else None
        )

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
