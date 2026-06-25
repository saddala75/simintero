"""Phase 3 · Slice S7 — the MUST-PASS two-LOB end-to-end pilot proof.

Drives the FULL assembled UM lifecycle in-process for TWO line-of-business
profiles (Commercial vs MA) and asserts the LOB-specific clocks/SLAs are
honored with NO code fork — the same code path, config-driven per LOB:

    intake + LOB decision clock (commercial 5d / ma 7d)
      → LOB SLA warning threshold (commercial 75% / ma 80%)
      → auto-determination (mock Digicore 'denied') → clinical_review
      → human adverse (denied) + sign-off → exactly ONE compliant notice
      → appeal filed (appeal_review + running appeal clock)
      → COI block (determiner cannot self-review) → independent overturn
      → appeal_overturned (terminal == closure)

This is the Phase-3 pilot exit gate. It CHAINS the segments proven
independently in S1-S6 (create_case, AutoDeterminator, TransitionEngine,
DecisionRecordedConsumer, AppealService) against the suite's test DB. The
`demo-tenant` carries the workflow_config clock (5/7) + sla (75/80) seeds
(migrations 0014/0015), so the DISTINCT 5≠7 / 75≠80 asserts fail loudly if a
seed is missing.
"""
from __future__ import annotations

import json
import uuid

import asyncpg
import pytest

from canonical_model.case import Status
from enstellar_connectors.digicore.client import DigiCoreClient
from enstellar_connectors.digicore.models import DecisionResponse, StructuredTrace
from simintero_outbox import SchemaRef
from simintero_tenant_context import tenant_transaction
from unittest.mock import AsyncMock

from enstellar_workflow.appeals.service import AppealService, COIError
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.clocks.sla_poller import TERMINAL_STATES
from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
from enstellar_workflow.comms.service import NotificationService
from enstellar_workflow.engine.auto_determination import AutoDeterminator
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from enstellar_workflow.outbox.publisher import OutboxPublisher
from enstellar_workflow.workflow_config import ConfigService
from tests.conftest import make_case

_DECISION_RECORDED_REF = "sim.case.lifecycle/DecisionRecorded/v1"
# The human who records the adverse denial — and therefore the COI determiner
# who must be BLOCKED from later deciding the appeal (vs the independent reviewer).
_DETERMINER = "clinician-A"
_INDEPENDENT_REVIEWER = "reviewer-IRE"


async def _seed_denied_template(pool: asyncpg.Pool, tenant_id: str) -> None:
    """Seed a `denied` notice template (reason-guarded + appeal-rights text).

    Idempotent (ON CONFLICT DO NOTHING) so both LOB parametrizations can seed the
    same demo-tenant template without colliding on the session-scoped DB.
    StrictUndefined-safe: the optional `reason` is `{% if %}`-guarded.
    """
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'denied', 'portal', 'Determination on your request', "
            "'Your request received a determination of {{ outcome }}."
            "{% if reason %} Reason: {{ reason }}.{% endif %}"
            " You have the right to appeal this determination.') "
            "ON CONFLICT (tenant_id, event_type, channel, version) DO NOTHING",
            tenant_id,
        )


async def _seed_appeal_templates(pool: asyncpg.Pool, tenant_id: str) -> None:
    """Seed the appeal notice templates (idempotent — see _seed_denied_template)."""
    async with pool.acquire() as conn:
        for event_type, body in (
            ("appeal_filed",
             "Your appeal (level {{ level }}) has been received and is under review."),
            ("appeal_overturned",
             "Your appeal (level {{ level }}) was overturned — "
             "the prior determination is reversed."),
            ("appeal_upheld",
             "Your appeal (level {{ level }}) was upheld."),
        ):
            await conn.execute(
                "INSERT INTO notification_templates "
                "(tenant_id, event_type, channel, subject_template, body_template) "
                "VALUES ($1, $2, 'portal', 'Appeal update', $3) "
                "ON CONFLICT (tenant_id, event_type, channel, version) DO NOTHING",
                tenant_id, event_type, body,
            )


async def _fetch_decision_recorded_envelope(pg_pool: asyncpg.Pool, case_id):
    """Read the single DECISION_RECORDED outbox row for this case and reconstruct
    the EventEnvelope the live consumer would receive."""
    from canonical_model import EventEnvelope

    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT envelope FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' = $2",
            str(case_id),
            _DECISION_RECORDED_REF,
        )
    assert len(rows) == 1, f"expected exactly one DECISION_RECORDED row, got {len(rows)}"
    return EventEnvelope.model_validate_json(rows[0]["envelope"])


async def _channel_counts(pg_pool: asyncpg.Pool, tenant_id, case_id, event_type) -> dict:
    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT channel, COUNT(*) AS n FROM notification_log "
            "WHERE tenant_id=$1 AND case_id=$2 AND event_type=$3 "
            "GROUP BY channel",
            tenant_id, uuid.UUID(str(case_id)), event_type,
        )
    return {r["channel"]: r["n"] for r in rows}


async def _notice_bodies_for_case(pg_pool, case_id, event_type) -> list[str]:
    """The rendered NOTIFICATION_SENT bodies for THIS case + event_type (case-scoped
    so the two demo-tenant parametrizations never cross-read each other)."""
    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT envelope FROM shared.outbox "
            "WHERE envelope->>'schema_ref' = $1 "
            "AND envelope->'payload'->>'case_id' = $2 "
            "AND envelope->'payload'->>'event_type' = $3",
            SchemaRef.NOTIFICATION_SENT, str(case_id), event_type,
        )
    bodies = []
    for r in rows:
        env = r["envelope"]
        if isinstance(env, str):
            env = json.loads(env)
        bodies.append(env["payload"]["body"])
    return bodies


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "lob, expected_clock_days, expected_sla_pct",
    [("commercial", 5, 75), ("ma", 7, 80)],
)
async def test_two_lob_full_lifecycle(
    pg_pool: asyncpg.Pool, lob, expected_clock_days, expected_sla_pct
):
    """The assembled UM lifecycle, driven end-to-end for one LOB profile.

    Same code path for both LOBs — only the demo-tenant config differs, so the
    clock (5/7) and SLA (75/80) asserts prove LOB-aware resolution with no fork.
    """
    tenant_id = "demo-tenant"  # has the clocks(5/7)+sla(75/80) seeds (0014/0015)

    # ── Stage 1 · Intake + LOB-specific decision clock ──────────────────────
    case = make_case(tenant_id=tenant_id, lob=lob)
    await CaseService(pg_pool).create_case(case)

    async with tenant_transaction(pg_pool, tenant_id) as conn:
        clock_days = await conn.fetchval(
            "SELECT duration_calendar_days FROM clocks "
            "WHERE case_id=$1 AND tenant_id=$2 AND clock_type='decision'",
            case.case_id, tenant_id,
        )
    assert clock_days == expected_clock_days, (
        f"{lob}: decision clock must be {expected_clock_days}d "
        f"(LOB-resolved, same code path), got {clock_days}"
    )

    # ── Stage 2 · LOB-specific SLA warning threshold ────────────────────────
    async with tenant_transaction(pg_pool, tenant_id) as conn:
        sla = await ConfigService().resolve_sla(conn, tenant_id=tenant_id, lob=lob)
    assert sla.warning_threshold_pct == expected_sla_pct, (
        f"{lob}: SLA warning threshold must be {expected_sla_pct}%, "
        f"got {sla.warning_threshold_pct}%"
    )

    # ── Stage 3 · Auto-determination (Digicore 'denied') → clinical_review ───
    # INVARIANT #1: a Digicore 'denied' NEVER auto-denies — it routes to a human.
    digicore = AsyncMock(spec=DigiCoreClient)
    digicore.evaluate_request.return_value = DecisionResponse(
        decision="denied",
        requirements=[],
        structured_trace=StructuredTrace(
            artifact="policy-v2", version="2.1.0",
            source="digicore-rules", logic_branch="deny",
        ),
        pins=[],
    )
    auto = AutoDeterminator(engine=TransitionEngine(), digicore=digicore)
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            routed = await auto.run(conn, case, f"corr-{uuid.uuid4()}")
    assert routed.status == Status.clinical_review, (
        f"{lob}: Digicore 'denied' must route to clinical_review, got {routed.status}"
    )

    # ── Stage 4 · Human adverse (denied) + sign-off → exactly ONE notice ────
    await _seed_denied_template(pg_pool, tenant_id)
    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=case.case_id,
        tenant_id=tenant_id,
        to_state="denied",
        actor_id=_DETERMINER,
        actor_type="user",  # HUMAN — this actor becomes the COI determiner
        correlation_id=case.correlation_id,
        human_signoff_recorded=True,
        payload={
            "reason": "conservative therapy not documented",
            "reason_codes": ["X"],
            "determination_type": "denied",
        },
    )
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            denied, _ = await engine.apply(conn, req)
    assert denied.status.value == "denied"

    event = await _fetch_decision_recorded_envelope(pg_pool, case.case_id)
    assert event.payload["outcome"] == "denied"
    assert event.payload["decided_by"] == "human"

    consumer = DecisionRecordedConsumer(pg_pool, NotificationService(OutboxPublisher()))
    await consumer.handle(event)

    counts = await _channel_counts(pg_pool, tenant_id, case.case_id, "denied")
    assert counts == {"portal": 1}, f"{lob}: expected ONE denied notice, got {counts}"
    bodies = await _notice_bodies_for_case(pg_pool, case.case_id, "denied")
    assert len(bodies) == 1, f"{lob}: expected one denied notice body, got {bodies}"
    assert "conservative therapy not documented" in bodies[0], bodies[0]
    assert "right to appeal" in bodies[0], bodies[0]

    # ── Stage 5 · Appeal filed → appeal_review + running appeal clock ───────
    await _seed_appeal_templates(pg_pool, tenant_id)
    svc = AppealService(pg_pool)
    filed = await svc.file_appeal(
        case_id=case.case_id,
        tenant_id=tenant_id,
        filed_by="member-1",
        reason="disagree with the denial",
    )
    assert filed["status"] == "appeal_review"
    appeal_id = uuid.UUID(filed["appeal_id"])

    async with pg_pool.acquire() as conn:
        case_status = await conn.fetchval(
            "SELECT status FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id, tenant_id,
        )
        appeal_clock = await conn.fetchval(
            "SELECT state FROM clocks "
            "WHERE case_id=$1 AND tenant_id=$2 AND clock_type='appeal'",
            case.case_id, tenant_id,
        )
    assert case_status == "appeal_review"
    assert appeal_clock == "running", f"{lob}: appeal clock must be running"

    # ── Stage 5b · COI — the determiner cannot decide their own appeal ──────
    # Force-assign the conflicted determiner directly (assign_reviewer would
    # reject this on COI) so the decide passes the assignment gate and hits COI.
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "UPDATE appeals SET assigned_to=$1 WHERE appeal_id=$2 AND tenant_id=$3",
            _DETERMINER, appeal_id, tenant_id,
        )
    with pytest.raises(COIError):
        await svc.decide_appeal(
            case_id=case.case_id,
            tenant_id=tenant_id,
            appeal_id=appeal_id,
            outcome="overturned",
            reviewer_actor=_DETERMINER,  # == the adverse determiner → blocked
            reason="self-review attempt",
            human_signoff_recorded=False,
        )

    # ── Stage 5c · Independent reviewer overturns ───────────────────────────
    # Reassign to the independent reviewer (COI-clean) before they decide.
    await svc.assign_reviewer(
        case_id=case.case_id, tenant_id=tenant_id,
        appeal_id=appeal_id, reviewer_id=_INDEPENDENT_REVIEWER, assigned_by="coord",
    )
    decided = await svc.decide_appeal(
        case_id=case.case_id,
        tenant_id=tenant_id,
        appeal_id=appeal_id,
        outcome="overturned",
        reviewer_actor=_INDEPENDENT_REVIEWER,
        reason="medical necessity established on independent review",
        human_signoff_recorded=False,
    )
    assert decided["status"] == "appeal_overturned"

    # ── Stage 6 · Terminal == closure (SLA monitor no longer touches it) ────
    # appeal_overturned is cleanly-final → auto-closed (closed, disposition kept).
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, disposition FROM workflow_instances "
            "WHERE case_id=$1 AND tenant_id=$2",
            case.case_id, tenant_id,
        )
        final_status = row["status"]
        running_clocks = await conn.fetchval(
            "SELECT COUNT(*) FROM clocks "
            "WHERE case_id=$1 AND tenant_id=$2 AND state='running'",
            case.case_id, tenant_id,
        )
    assert final_status == "closed"
    assert row["disposition"] == "appeal_overturned"
    assert final_status in TERMINAL_STATES, (
        f"{lob}: closed must be terminal (excluded from SLA scan)"
    )
    # Terminal-as-closure: the SLA poller scans only running clocks of non-terminal
    # cases — this case is terminal AND its appeal clock is stopped, so the monitor
    # never breaches/warns/escalates it again.
    assert running_clocks == 0, f"{lob}: terminal case must have no running clock"
