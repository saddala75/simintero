import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest

from enstellar_workflow.normalization import fabric_writer
from enstellar_workflow.normalization.fabric_writer import (
    collect_evidence_rows,
    write_case_evidence,
)

PATIENT = {"resourceType": "Patient", "id": "pat-001", "gender": "female"}
COVERAGE = {"resourceType": "Coverage", "id": "cov-1", "beneficiary": {"reference": "Patient/pat-001"}}
CLAIM = {
    "resourceType": "Claim", "id": "claim-1",
    "patient": {"reference": "Patient/pat-001"},
    "diagnosis": [
        {"sequence": 1, "diagnosisCodeableConcept": {"coding": [
            {"system": "http://hl7.org/fhir/sid/icd-10-cm", "code": "M17.0", "display": "Bilateral OA knee"}]}}
    ],
    "item": [{"sequence": 1, "productOrService": {"coding": [
        {"system": "http://www.ama-assn.org/go/cpt", "code": "29828"}]}}],
}
BUNDLE = {"resourceType": "Bundle", "entry": [
    {"resource": PATIENT}, {"resource": COVERAGE}, {"resource": CLAIM}]}


def _by_type(rows):
    out = {}
    for r in rows:
        out.setdefault(r["resource_type"], []).append(r)
    return out


def test_collects_standalone_patient_and_coverage_with_bare_member_ref():
    rows = collect_evidence_rows(BUNDLE, "pat-001")
    t = _by_type(rows)
    assert any(r["fhir_id"] == "pat-001" and r["member_ref"] == "pat-001" for r in t["Patient"])
    assert any(r["fhir_id"] == "cov-1" and r["member_ref"] == "pat-001" for r in t["Coverage"])


def test_derives_condition_from_claim_diagnosis_icd10():
    rows = collect_evidence_rows(BUNDLE, "pat-001")
    conds = _by_type(rows).get("Condition", [])
    assert len(conds) == 1
    c = conds[0]["content"]
    assert c["resourceType"] == "Condition"
    assert c["subject"]["reference"] == "Patient/pat-001"
    assert c["code"]["coding"][0]["code"] == "M17.0"
    assert c["clinicalStatus"]["coding"][0]["code"] == "active"
    assert conds[0]["member_ref"] == "pat-001"
    assert conds[0]["fhir_id"]  # deterministic, non-empty


def test_skips_non_decisioning_resources():
    b = {"resourceType": "Bundle", "entry": [
        {"resource": {"resourceType": "Practitioner", "id": "pr-1"}},
        {"resource": PATIENT}]}
    types = {r["resource_type"] for r in collect_evidence_rows(b, "pat-001")}
    assert "Practitioner" not in types
    assert "Patient" in types


def test_idempotent_deterministic_ids():
    a = collect_evidence_rows(BUNDLE, "pat-001")
    b = collect_evidence_rows(BUNDLE, "pat-001")
    assert [r["fhir_id"] for r in a] == [r["fhir_id"] for r in b]


@pytest.mark.asyncio
async def test_write_case_evidence_none_pool_short_circuits():
    n = await write_case_evidence(None, "tenant-a", "pat-001", "raw/key", BUNDLE)
    assert n == 0


@pytest.mark.asyncio
async def test_write_case_evidence_upserts_one_execute_per_row(monkeypatch):
    conn = MagicMock()
    conn.execute = AsyncMock()

    @asynccontextmanager
    async def fake_tx(pool, tenant_id):
        # Mirror cases/service.py form: yields a conn with an awaitable execute.
        fake_tx.calls.append((pool, tenant_id))
        yield conn

    fake_tx.calls = []
    monkeypatch.setattr(fabric_writer, "tenant_transaction", fake_tx)

    pool = object()
    n = await write_case_evidence(pool, "tenant-a", "pat-001", "raw/key", BUNDLE)

    rows = collect_evidence_rows(BUNDLE, "pat-001")
    assert n == len(rows)
    # tenant_transaction was opened once with the pool + tenant.
    assert fake_tx.calls == [(pool, "tenant-a")]
    # One execute per evidence row.
    assert conn.execute.await_count == len(rows)

    for call, row in zip(conn.execute.await_args_list, rows):
        args = call.args
        sql = args[0]
        assert "INSERT INTO fabric.resource" in sql
        assert "ON CONFLICT (tenant_id, resource_type, fhir_id) DO UPDATE" in sql
        assert "$6::jsonb" in sql
        # Positional params: tenant, type, fhir_id, member_ref, raw_key, content-json
        assert args[1] == "tenant-a"
        assert args[2] == row["resource_type"]
        assert args[3] == row["fhir_id"]
        assert args[4] == row["member_ref"]
        assert args[5] == "raw/key"
        # JSONB param must be a JSON string, not a dict.
        assert isinstance(args[6], str)
        assert json.loads(args[6]) == row["content"]


@pytest.mark.asyncio
async def test_write_case_evidence_empty_bundle_no_db_calls(monkeypatch):
    @asynccontextmanager
    async def fake_tx(pool, tenant_id):
        fake_tx.opened = True
        yield MagicMock()

    fake_tx.opened = False
    monkeypatch.setattr(fabric_writer, "tenant_transaction", fake_tx)

    n = await write_case_evidence(object(), "tenant-a", "pat-001", "raw/key",
                                  {"resourceType": "Bundle", "entry": []})
    assert n == 0
    assert fake_tx.opened is False
