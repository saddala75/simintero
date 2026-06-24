"""Slice S4 — end-to-end proof of the completeness-gating LOOP.

This is the authoritative integration proof that the full loop closes:

    auto_determination (Digicore gaps)
        → pend_rfi  + RFI_DISPATCHED(requirement_ids) + clock paused + rfi_gated_at set
    rfi.response.received  (RfiResponseConsumer)
        → auto_determination  (re-gate) + clock resumed
    auto_determination (re-evaluate the now-arrived evidence)
        → approved              (evidence complete), OR
        → clinical_review       (still incomplete — but NO second RFI; the
                                 rfi_gated_at guard bounds the loop to one auto-RFI)

The single DigiCore client is driven with `side_effect=[first, second]` so the
FIRST evaluate returns gaps and the SECOND returns the re-gate outcome —
simulating the evidence arriving between the two passes.

Real TransitionEngine + Postgres (testcontainers); the two AutoDeterminator
runs and the RfiResponseConsumer.handle are chained explicitly (matching how the
real event plane would carry CASE_STATE_CHANGED → auto_determination back into
the AutoDeterminator).
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest

from canonical_model.case import Status
from enstellar_connectors.digicore.client import DigiCoreClient
from enstellar_connectors.digicore.models import DecisionResponse
from simintero_outbox import SchemaRef, make_envelope
from simintero_tenant_context import tenant_transaction
from unittest.mock import AsyncMock

from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.consumers.rfi_response_consumer import RfiResponseConsumer
from enstellar_workflow.engine.auto_determination import AutoDeterminator
from enstellar_workflow.engine.transitions import TransitionEngine

# Reuse the proven gap-response builder + seed/fetch helpers from the unit suite.
from tests.test_auto_determination import (
    MOCK_TRACE,
    _fetch_rfi_dispatched,
    _gap_response,
    _seed_auto_determination_case,
)

pytestmark = pytest.mark.asyncio


def _approved_response() -> DecisionResponse:
    """meets_all — the evidence has arrived and now satisfies every requirement."""
    return DecisionResponse(
        decision="approved",
        requirements=[],
        structured_trace=MOCK_TRACE,
        pins=[],
    )


async def _count_rfi_dispatched(pool, case) -> int:
    async with tenant_transaction(pool, case.tenant_id) as conn:
        return await conn.fetchval(
            "SELECT COUNT(*) FROM shared.outbox"
            " WHERE envelope->>'schema_ref' = $1"
            "   AND envelope->'payload'->>'case_id' = $2",
            SchemaRef.RFI_DISPATCHED,
            str(case.case_id),
        )


async def _clock_state(pool, case) -> str | None:
    async with tenant_transaction(pool, case.tenant_id) as conn:
        return await conn.fetchval(
            "SELECT state FROM clocks WHERE case_id=$1 AND tenant_id=$2",
            case.case_id,
            case.tenant_id,
        )


def _rfi_response_event(case):
    """An rfi.response.received envelope for the pended case (evidence arrived)."""
    return make_envelope(
        "sim.case.lifecycle/RFIResponseReceived/v1",
        tenant_id=case.tenant_id,
        actor_id="system",
        actor_type="system",
        correlation_id=str(uuid.uuid4()),
        payload={
            "case_id": str(case.case_id),
            "provider_npi": "",
            "document_types": [],
        },
    )


async def _run_auto(auto: AutoDeterminator, pool, case):
    """Fetch the case fresh from the DB and drive one AutoDeterminator pass."""
    repo = CaseRepository()
    async with tenant_transaction(pool, case.tenant_id) as conn:
        fresh = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)
        return await auto.run(conn, fresh, f"corr-{uuid.uuid4()}")


# ---------------------------------------------------------------------------
# The loop: gate → pend/RFI → re-gate → APPROVED
# ---------------------------------------------------------------------------


async def test_incomplete_case_pends_rfi_then_re_gates_to_approved(pg_pool: asyncpg.Pool):
    """Incomplete → pend+RFI; the RFI response re-gates; now meets_all → approved."""
    case = await _seed_auto_determination_case(pg_pool, f"tenant-s4loop-ok-{uuid.uuid4()}")

    digicore = AsyncMock(spec=DigiCoreClient)
    # First evaluate: gaps. Second evaluate (after the RFI response): meets_all.
    digicore.evaluate_request.side_effect = [
        _gap_response(gap_ids=("imaging_documented",)),
        _approved_response(),
    ]
    auto = AutoDeterminator(engine=TransitionEngine(), digicore=digicore)

    # --- Pass 1: the completeness gate pends the incomplete case + dispatches an RFI.
    result = await _run_auto(auto, pg_pool, case)
    assert result.status == Status.pend_rfi

    envelope = await _fetch_rfi_dispatched(pg_pool, case)
    assert envelope is not None
    assert envelope["payload"]["requirement_ids"] == ["imaging_documented"]
    assert await _clock_state(pg_pool, case) == "paused"

    repo = CaseRepository()
    async with tenant_transaction(pg_pool, case.tenant_id) as conn:
        gated = await conn.fetchval(
            "SELECT rfi_gated_at FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id,
            case.tenant_id,
        )
    assert gated is not None

    # --- The RFI response arrives → re-enter auto_determination + resume the clock.
    consumer = RfiResponseConsumer(pg_pool)
    await consumer.handle(_rfi_response_event(case))

    async with tenant_transaction(pg_pool, case.tenant_id) as conn:
        regated = await repo.fetch_by_id(conn, case.case_id, case.tenant_id)
    assert regated.status == Status.auto_determination
    assert await _clock_state(pg_pool, case) == "running"

    # --- Pass 2 (the re-gate): the evidence is now complete → approved.
    final = await _run_auto(auto, pg_pool, case)
    assert final.status == Status.approved

    # Exactly one RFI was ever dispatched for this case.
    assert await _count_rfi_dispatched(pg_pool, case) == 1
    assert digicore.evaluate_request.call_count == 2


# ---------------------------------------------------------------------------
# The loop: gate → pend/RFI → re-gate → still incomplete → CLINICAL_REVIEW (one RFI)
# ---------------------------------------------------------------------------


async def test_still_incomplete_after_rfi_routes_to_clinical_review(pg_pool: asyncpg.Pool):
    """Still incomplete after the RFI → clinical_review, and NEVER a second RFI
    (the rfi_gated_at guard bounds the loop to exactly one auto-RFI)."""
    case = await _seed_auto_determination_case(pg_pool, f"tenant-s4loop-cr-{uuid.uuid4()}")

    digicore = AsyncMock(spec=DigiCoreClient)
    # Gaps on BOTH passes — the evidence never arrived.
    digicore.evaluate_request.side_effect = [
        _gap_response(gap_ids=("imaging_documented",)),
        _gap_response(gap_ids=("imaging_documented",)),
    ]
    auto = AutoDeterminator(engine=TransitionEngine(), digicore=digicore)

    # --- Pass 1: pend + the one and only RFI.
    result = await _run_auto(auto, pg_pool, case)
    assert result.status == Status.pend_rfi
    assert await _count_rfi_dispatched(pg_pool, case) == 1

    # --- RFI response → re-gate.
    consumer = RfiResponseConsumer(pg_pool)
    await consumer.handle(_rfi_response_event(case))

    # --- Pass 2 (the re-gate): still gaps, but already RFI-gated → clinical_review.
    final = await _run_auto(auto, pg_pool, case)
    assert final.status == Status.clinical_review

    # The guard held: exactly ONE RFI total — no second dispatch on the re-gate.
    assert await _count_rfi_dispatched(pg_pool, case) == 1


# ---------------------------------------------------------------------------
# Regression: a complete case is never pended.
# ---------------------------------------------------------------------------


async def test_complete_case_is_not_pended(pg_pool: asyncpg.Pool):
    """A case that meets_all on the first evaluate is approved directly — never
    pended, never RFI'd (the gate adds a branch only for gaps)."""
    case = await _seed_auto_determination_case(pg_pool, f"tenant-s4loop-noop-{uuid.uuid4()}")

    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.return_value = _approved_response()
    auto = AutoDeterminator(engine=TransitionEngine(), digicore=digicore)

    result = await _run_auto(auto, pg_pool, case)

    assert result.status == Status.approved
    assert await _fetch_rfi_dispatched(pg_pool, case) is None
    assert await _count_rfi_dispatched(pg_pool, case) == 0
