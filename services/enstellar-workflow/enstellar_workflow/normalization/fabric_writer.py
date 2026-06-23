"""Fabric evidence bridge — collect a PAS bundle's clinical resources (+ derive
Conditions/Procedures from Claim.diagnosis/Claim.item) and upsert them into
``fabric.resource`` keyed by the bare Patient logical id (``member_ref``).

``collect_evidence_rows`` is a PURE function (no DB) so the interesting collection
+ derivation logic is unit-tested without a database. ``write_case_evidence``
performs the upsert under the ``tenant_transaction`` GUC helper (FORCE RLS).
"""
from __future__ import annotations

import json
import logging
from typing import Any

from simintero_tenant_context.db import tenant_transaction

log = logging.getLogger(__name__)

# Clinical resource types the CQL-vs-FHIR engine retrieves for decisioning.
DECISIONING_TYPES = {"Patient", "Coverage", "Condition", "Observation",
                     "Procedure", "MedicationStatement", "DiagnosticReport"}

_ACTIVE = {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                       "code": "active"}]}

UPSERT = (
    "INSERT INTO fabric.resource "
    "(tenant_id, resource_type, fhir_id, member_ref, source, provenance_ref, content) "
    "VALUES ($1,$2,$3,$4,'pas-intake',$5,$6::jsonb) "
    "ON CONFLICT (tenant_id, resource_type, fhir_id) DO UPDATE SET "
    "content=EXCLUDED.content, member_ref=EXCLUDED.member_ref, "
    "version=fabric.resource.version+1, last_updated=now()"
)


def _row(resource_type: str, fhir_id: str, member_ref: str, content: dict[str, Any]) -> dict[str, Any]:
    return {"resource_type": resource_type, "fhir_id": fhir_id,
            "member_ref": member_ref, "content": content}


def collect_evidence_rows(bundle: dict[str, Any], member_logical_id: str) -> list[dict[str, Any]]:
    """Return upsert-ready rows for the bundle's decisioning evidence.

    Each row is ``{resource_type, fhir_id, member_ref, content}``. Standalone
    decisioning resources are kept verbatim; Conditions are derived from
    ``Claim.diagnosis[].diagnosisCodeableConcept`` (ICD-10) and Procedures from
    ``Claim.item[].productOrService`` (CPT). ``member_ref`` is always the bare
    logical id (e.g. ``pat-001``) — the value digicore retrieves by.
    """
    rows: list[dict[str, Any]] = []
    claim: dict[str, Any] | None = None
    for entry in bundle.get("entry", []):
        res = entry.get("resource") or {}
        rtype, rid = res.get("resourceType"), res.get("id")
        if not rtype or not rid:
            continue
        if rtype == "Claim":
            claim = res
        if rtype in DECISIONING_TYPES:
            rows.append(_row(rtype, rid, member_logical_id, res))

    # Derive Conditions from Claim.diagnosis[].diagnosisCodeableConcept (ICD-10-coded).
    if claim is not None:
        cid = claim.get("id", "claim")
        for i, dx in enumerate(claim.get("diagnosis", [])):
            cc = dx.get("diagnosisCodeableConcept")
            if not cc:  # diagnosisReference is covered by the standalone pass
                continue
            fid = f"{cid}-dx-{dx.get('sequence', i)}"
            cond = {"resourceType": "Condition", "id": fid,
                    "subject": {"reference": f"Patient/{member_logical_id}"},
                    "clinicalStatus": _ACTIVE, "code": cc}
            rows.append(_row("Condition", fid, member_logical_id, cond))
        # Secondary: derive Procedure from Claim.item[].productOrService (CPT).
        for i, item in enumerate(claim.get("item", [])):
            svc = item.get("productOrService")
            if not svc:
                continue
            fid = f"{cid}-svc-{item.get('sequence', i)}"
            proc = {"resourceType": "Procedure", "id": fid, "status": "completed",
                    "subject": {"reference": f"Patient/{member_logical_id}"}, "code": svc}
            rows.append(_row("Procedure", fid, member_logical_id, proc))
    return rows


async def write_case_evidence(
    fabric_pool: Any,
    tenant_id: str,
    member_logical_id: str,
    raw_key: str,
    bundle: dict[str, Any],
) -> int:
    """Upsert the bundle's evidence rows into ``fabric.resource``.

    Returns the number of rows written. No-ops (returns 0) when ``fabric_pool``
    is unset (the bridge is optional) or the bundle yields no decisioning rows.
    """
    if fabric_pool is None:
        log.warning("fabric_pool unset; skipping evidence bridge for tenant=%s", tenant_id)
        return 0
    rows = collect_evidence_rows(bundle, member_logical_id)
    if not rows:
        return 0
    written = 0
    async with tenant_transaction(fabric_pool, tenant_id) as conn:
        for r in rows:
            await conn.execute(
                UPSERT,
                tenant_id,
                r["resource_type"],
                r["fhir_id"],
                r["member_ref"],
                raw_key,
                json.dumps(r["content"]),
            )
            written += 1
    return written
