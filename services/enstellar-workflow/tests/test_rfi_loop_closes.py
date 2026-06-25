"""P1 (FINAL) — prove the RFI loop closes through the REAL route.

DISTINCT from tests/test_completeness_gating_loop.py (which synthesizes the
RFIResponseReceived event by hand and does NO fabric write). This test drives the
loop through the ACTUAL POST /internal/rfi-response route so the real fabric write
(source='rfi-response') AND the real published RFIResponseReceived envelope are
exercised:

    incomplete -> pend_rfi + RFI
      -> [ROUTE] writes response to fabric as source='rfi-response' + publishes
         RFIResponseReceived
      -> RfiResponseConsumer re-gates (the REAL published envelope drives it)
      -> re-evaluate -> approved   (or clinical_review when still incomplete)

Single Testcontainers Postgres: the WORKFLOW pool and the FABRIC pool point at the
same DB, so we stand up fabric.resource on pg_pool and hand pg_pool to the route as
its fabric_pool. The route coroutine is invoked directly with a fake Request whose
.app.state.fabric_pool is pg_pool (and a CaseService(pg_pool)).
"""
from __future__ import annotations

import json
import uuid
from types import SimpleNamespace

import asyncpg
import pytest

from canonical_model import EventEnvelope, Identifier, Status
from enstellar_connectors.digicore.client import DigiCoreClient
from simintero_outbox import SchemaRef
from simintero_tenant_context import tenant_transaction
from unittest.mock import AsyncMock

from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.clocks.model import ClockDefinition
from enstellar_workflow.clocks.service import ClockService
from enstellar_workflow.consumers.rfi_response_consumer import RfiResponseConsumer
from enstellar_workflow.engine.auto_determination import (
    AutoDeterminator,
    _FHIR_LOGICAL_ID_SYSTEM,
    _stable_member_ref,
)
from enstellar_workflow.engine.transitions import TransitionEngine
from enstellar_workflow.normalization.api import RfiResponseRequest, rfi_response
from enstellar_workflow.outbox.publisher import OutboxPublisher
from tests.conftest import make_case

# Shared loop helpers (re-evaluate pass, clock state, RFI count, meets_all response).
from tests.test_completeness_gating_loop import (
    _approved_response,
    _clock_state,
    _count_rfi_dispatched,
    _run_auto,
)
from tests.test_auto_determination import _fetch_rfi_dispatched, _gap_response

pytestmark = pytest.mark.asyncio

# Mirror the platform fabric.resource table (V002 + V014 ens columns), RLS-forced,
# so the route's evidence-before-event write hits a faithful tenant-isolated table.
_FABRIC_DDL = """
CREATE SCHEMA IF NOT EXISTS fabric;
CREATE TABLE IF NOT EXISTS fabric.resource (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT NOT NULL,
  resource_type  TEXT NOT NULL,
  fhir_id        TEXT NOT NULL,
  version        INT NOT NULL DEFAULT 1,
  profile        TEXT,
  content        JSONB NOT NULL,
  provenance_ref TEXT,
  source         TEXT NOT NULL,
  last_updated   TIMESTAMPTZ NOT NULL DEFAULT now(),
  member_ref     TEXT,
  classification TEXT DEFAULT 'standard',
  UNIQUE (tenant_id, resource_type, fhir_id)
);
ALTER TABLE fabric.resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE fabric.resource FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fabric.resource;
CREATE POLICY tenant_isolation ON fabric.resource
  USING (tenant_id = current_setting('sim.tenant_id', true));
"""


def _bundle(member_ref: str, obs_code: str) -> dict:
    """Supplemental bundle: a Patient + an Observation with a code (>=1 decisioning
    resource). The route forces every fabric row's member_ref to the case's stable
    member_ref regardless of the Patient id, so this is enough to exercise the write."""
    return {
        "resourceType": "Bundle",
        "entry": [
            {"resource": {"resourceType": "Patient", "id": member_ref, "gender": "male"}},
            {
                "resource": {
                    "resourceType": "Observation",
                    "id": "obs-rfi-loop-1",
                    "status": "final",
                    "code": {"coding": [{"system": "http://loinc.org", "code": obs_code}]},
                    "subject": {"reference": f"Patient/{member_ref}"},
                }
            },
        ],
    }


async def _ensure_fabric(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(_FABRIC_DDL)


async def _seed_incomplete_case(pool: asyncpg.Pool, tenant_id: str, member_ref: str):
    """A case in auto_determination with a running clock AND a stable member_ref.

    make_case yields a Member with NO identifiers, so _stable_member_ref would be
    None and the route would 422. We inject the urn:enstellar:fhir-logical-id
    identifier so the route can resolve the stable member_ref.
    """
    case = make_case(tenant_id=tenant_id, status=Status.auto_determination)
    member = case.member.model_copy(
        update={"identifiers": [Identifier(system=_FHIR_LOGICAL_ID_SYSTEM, value=member_ref)]}
    )
    case = case.model_copy(update={"member": member})

    service = CaseService(pool)
    await service.create_case(case)

    clock_svc = ClockService(OutboxPublisher())
    async with tenant_transaction(pool, tenant_id) as conn:
        try:
            await clock_svc.start(
                conn,
                tenant_id=tenant_id,
                case_id=case.case_id,
                definition=ClockDefinition.for_case(case.urgency.value),
            )
        except ValueError:
            pass  # already started by create_case — non-fatal
    return case


async def _post_rfi_response(pool: asyncpg.Pool, case, bundle: dict) -> dict:
    """Invoke the REAL route coroutine directly (fake Request -> fabric_pool=pool)."""
    fake_request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(fabric_pool=pool))
    )
    req = RfiResponseRequest(
        bundle=bundle, tenant_id=case.tenant_id, case_id=case.case_id
    )
    return await rfi_response(req, fake_request, CaseService(pool))


async def _fetch_rfi_response_envelope(pool: asyncpg.Pool, case) -> EventEnvelope | None:
    """The REAL RFIResponseReceived envelope the route wrote to shared.outbox."""
    async with tenant_transaction(pool, case.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT envelope FROM shared.outbox"
            " WHERE envelope->>'schema_ref' = $1"
            "   AND envelope->'payload'->>'case_id' = $2",
            SchemaRef.RFI_RESPONSE_RECEIVED,
            str(case.case_id),
        )
    if row is None:
        return None
    env = row["envelope"]
    if isinstance(env, str):
        env = json.loads(env)
    return EventEnvelope.model_validate(env)


# ---------------------------------------------------------------------------
# Route -> fabric(source='rfi-response') -> real event -> re-gate -> APPROVED
# ---------------------------------------------------------------------------


async def test_rfi_response_route_closes_loop_to_approved(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-rfiloop-ok-{uuid.uuid4()}"
    member_ref = f"pat-rfiloop-{uuid.uuid4().hex[:8]}"
    await _ensure_fabric(pg_pool)
    case = await _seed_incomplete_case(pg_pool, tenant_id, member_ref)

    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.side_effect = [
        _gap_response(gap_ids=("imaging_documented",)),
        _approved_response(),
    ]
    auto = AutoDeterminator(engine=TransitionEngine(), digicore=digicore)

    # --- Pass 1: incomplete -> pend_rfi + RFI dispatched + clock paused + rfi_gated_at.
    result = await _run_auto(auto, pg_pool, case)
    assert result.status == Status.pend_rfi

    envelope = await _fetch_rfi_dispatched(pg_pool, case)
    assert envelope is not None
    assert envelope["payload"]["requirement_ids"] == ["imaging_documented"]
    assert await _clock_state(pg_pool, case) == "paused"

    async with tenant_transaction(pg_pool, case.tenant_id) as conn:
        gated = await conn.fetchval(
            "SELECT rfi_gated_at FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id,
            case.tenant_id,
        )
    assert gated is not None

    # --- The REAL route: writes the response to fabric + publishes RFIResponseReceived.
    body = await _post_rfi_response(pg_pool, case, _bundle(member_ref, "12345-6"))
    assert body["status"] == "rfi_response_received"  # 200-equivalent (no HTTPException)
    assert body["fabric_rows"] >= 1

    stable_ref = _stable_member_ref(case)
    assert stable_ref == member_ref

    # --- Fabric: a row written as source='rfi-response' under the stable member_ref.
    async with tenant_transaction(pg_pool, tenant_id) as conn:
        rfi_rows = await conn.fetch(
            "SELECT source, member_ref FROM fabric.resource"
            " WHERE tenant_id=$1 AND member_ref=$2",
            tenant_id,
            stable_ref,
        )
    assert any(
        r["source"] == "rfi-response" and r["member_ref"] == stable_ref for r in rfi_rows
    ), f"no rfi-response evidence row under member_ref={stable_ref}: {rfi_rows}"

    # --- Digicore-retrievable proxy: the real predicate excludes ai-extraction rows.
    # Insert one ai-extraction row for the SAME member_ref; the retrievable count must
    # exclude it while still counting the rfi-response evidence.
    async with tenant_transaction(pg_pool, tenant_id) as conn:
        await conn.execute(
            "INSERT INTO fabric.resource"
            " (tenant_id, resource_type, fhir_id, content, source, member_ref)"
            " VALUES ($1, 'Observation', $2, '{}'::jsonb, 'ai-extraction', $3)",
            tenant_id,
            f"ai-extract-{uuid.uuid4().hex[:8]}",
            stable_ref,
        )
        retrievable = await conn.fetchval(
            "SELECT count(*) FROM fabric.resource"
            " WHERE member_ref=$1 AND source <> 'ai-extraction'",
            stable_ref,
        )
        excluded = await conn.fetchval(
            "SELECT count(*) FROM fabric.resource"
            " WHERE member_ref=$1 AND source = 'ai-extraction'",
            stable_ref,
        )
    assert retrievable >= 1  # the rfi-response evidence WOULD be retrieved
    assert excluded >= 1  # the ai-extraction row exists but is NOT retrievable

    # --- The REAL published RFIResponseReceived envelope drives the re-gate.
    real_event = await _fetch_rfi_response_envelope(pg_pool, case)
    assert real_event is not None
    assert real_event.schema_ref == SchemaRef.RFI_RESPONSE_RECEIVED
    assert real_event.payload["case_id"] == str(case.case_id)
    assert real_event.tenant.tenant_id == tenant_id

    await RfiResponseConsumer(pg_pool).handle(real_event)

    repo = CaseRepository()
    async with tenant_transaction(pg_pool, case.tenant_id) as conn:
        regated = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)
    assert regated.status == Status.auto_determination
    assert await _clock_state(pg_pool, case) == "running"

    # --- Pass 2 (re-gate): the arrived evidence now meets_all -> approved.
    final = await _run_auto(auto, pg_pool, case)
    assert final.status == Status.approved

    assert await _count_rfi_dispatched(pg_pool, case) == 1
    assert digicore.evaluate_request.call_count == 2


# ---------------------------------------------------------------------------
# Route -> fabric -> real event -> re-gate -> STILL incomplete -> CLINICAL_REVIEW
# ---------------------------------------------------------------------------


async def test_rfi_response_still_incomplete_routes_to_clinical_review(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-rfiloop-cr-{uuid.uuid4()}"
    member_ref = f"pat-rfiloop-{uuid.uuid4().hex[:8]}"
    await _ensure_fabric(pg_pool)
    case = await _seed_incomplete_case(pg_pool, tenant_id, member_ref)

    digicore = AsyncMock(spec=DigiCoreClient)
    # Gaps on BOTH passes — the supplemental evidence still didn't satisfy Digicore.
    digicore.evaluate_request.side_effect = [
        _gap_response(gap_ids=("imaging_documented",)),
        _gap_response(gap_ids=("imaging_documented",)),
    ]
    auto = AutoDeterminator(engine=TransitionEngine(), digicore=digicore)

    # --- Pass 1: pend + the one and only RFI.
    result = await _run_auto(auto, pg_pool, case)
    assert result.status == Status.pend_rfi
    assert await _count_rfi_dispatched(pg_pool, case) == 1

    # --- The REAL route still writes evidence + publishes (the response WAS submitted).
    body = await _post_rfi_response(pg_pool, case, _bundle(member_ref, "12345-6"))
    assert body["status"] == "rfi_response_received"
    assert body["fabric_rows"] >= 1

    stable_ref = _stable_member_ref(case)
    async with tenant_transaction(pg_pool, tenant_id) as conn:
        wrote = await conn.fetchval(
            "SELECT count(*) FROM fabric.resource"
            " WHERE member_ref=$1 AND source='rfi-response'",
            stable_ref,
        )
    assert wrote >= 1

    # --- The REAL published envelope drives the re-gate.
    real_event = await _fetch_rfi_response_envelope(pg_pool, case)
    assert real_event is not None
    await RfiResponseConsumer(pg_pool).handle(real_event)

    # --- Pass 2 (re-gate): still gaps, but already RFI-gated -> clinical_review.
    final = await _run_auto(auto, pg_pool, case)
    assert final.status == Status.clinical_review

    # The rfi_gated_at guard held: exactly ONE RFI total — no second dispatch.
    assert await _count_rfi_dispatched(pg_pool, case) == 1
