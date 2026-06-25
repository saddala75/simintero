"""GrievanceService lifecycle tests (P5).

A grievance is a NEW entity PARALLEL to cases: filed → acknowledged →
investigating → resolved, status-guarded, with an assignment gate on resolve and
LOB-aware member notices. It NEVER calls engine.apply / touches workflow_instances.

Grievances has FORCE ROW LEVEL SECURITY, so grievance rows are read back via a
tenant_transaction (which sets sim.tenant_id); the outbox + notification_log (RLS
but not forced) are read with the plain superuser pool, mirroring the comms tests.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from simintero_outbox import SchemaRef
from simintero_tenant_context import tenant_transaction

from enstellar_workflow.grievances.service import (
    GrievanceConflictError,
    GrievanceService,
    NotAssignedError,
)


async def _seed_templates(pool, tenant_id):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, lob, subject_template, body_template) "
            "VALUES ($1,'grievance_filed','portal',NULL,'Grievance received',"
            "'We received your grievance. We will respond within {{ resolution_days }} days.')",
            tenant_id,
        )
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, lob, subject_template, body_template) "
            "VALUES ($1,'grievance_acknowledged','portal',NULL,'Grievance acknowledged',"
            "'Your grievance has been acknowledged.')",
            tenant_id,
        )
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, lob, subject_template, body_template) "
            "VALUES ($1,'grievance_resolved','portal',NULL,'Grievance resolved',"
            "'Your grievance has been resolved.')",
            tenant_id,
        )


async def _outbox_payload(pool, schema_ref, grievance_id):
    async with pool.acquire() as conn:
        env = await conn.fetchval(
            "SELECT envelope FROM shared.outbox "
            "WHERE envelope->>'schema_ref'=$1 "
            "AND envelope->'payload'->>'grievance_id'=$2",
            schema_ref, str(grievance_id),
        )
    if isinstance(env, str):
        env = json.loads(env)
    return env["payload"] if env is not None else None


async def _notice_body(pool, grievance_id, event_type):
    async with pool.acquire() as conn:
        env = await conn.fetchval(
            "SELECT envelope FROM shared.outbox "
            "WHERE envelope->>'schema_ref'=$1 "
            "AND envelope->'payload'->>'case_id'=$2 "
            "AND envelope->'payload'->>'event_type'=$3",
            SchemaRef.NOTIFICATION_SENT, str(grievance_id), event_type,
        )
    if isinstance(env, str):
        env = json.loads(env)
    return env["payload"]["body"] if env is not None else None


async def _grievance_row(pool, tenant_id, grievance_id):
    async with tenant_transaction(pool, tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM grievances WHERE grievance_id=$1 AND tenant_id=$2",
            uuid.UUID(grievance_id), tenant_id,
        )
    return dict(row) if row is not None else None


@pytest.mark.asyncio
async def test_full_lifecycle(pg_pool):
    tenant_id = f"griev-{uuid.uuid4()}"
    member_ref = f"member-{uuid.uuid4()}"
    await _seed_templates(pg_pool, tenant_id)
    svc = GrievanceService(pg_pool)

    filed = await svc.file_grievance(
        tenant_id=tenant_id,
        member_ref=member_ref,
        case_id=None,
        category="access",
        description="long wait",
        urgency="standard",
        lob="ma",
        filed_by="member-portal",
    )
    assert filed["status"] == "filed"
    gid = filed["grievance_id"]

    # DB row: filed, member_ref carried, resolution_due_at ~30 days out.
    row = await _grievance_row(pg_pool, tenant_id, gid)
    assert row["status"] == "filed"
    assert row["member_ref"] == member_ref
    now = datetime.now(timezone.utc)
    assert row["resolution_due_at"] > now + timedelta(days=29)
    assert row["resolution_due_at"] < now + timedelta(days=31)

    # GrievanceFiled outbox event + grievance_filed notice carrying resolution_days (30).
    payload = await _outbox_payload(pg_pool, SchemaRef.GRIEVANCE_FILED, gid)
    assert payload is not None and payload["member_ref"] == member_ref
    body = await _notice_body(pg_pool, gid, "grievance_filed")
    assert body is not None and "30" in body

    # acknowledge
    ack = await svc.acknowledge_grievance(
        tenant_id=tenant_id, grievance_id=uuid.UUID(gid), acknowledged_by="coord"
    )
    assert ack["status"] == "acknowledged"
    assert (await _grievance_row(pg_pool, tenant_id, gid))["status"] == "acknowledged"

    # assign
    assigned = await svc.assign_investigator(
        tenant_id=tenant_id, grievance_id=uuid.UUID(gid),
        investigator_id="inv-1", assigned_by="coord",
    )
    assert assigned["status"] == "investigating"
    assert assigned["assigned_to"] == "inv-1"
    row = await _grievance_row(pg_pool, tenant_id, gid)
    assert row["status"] == "investigating" and row["assigned_to"] == "inv-1"

    # resolve (by the assigned investigator)
    resolved = await svc.resolve_grievance(
        tenant_id=tenant_id, grievance_id=uuid.UUID(gid),
        resolution="addressed", resolved_by="inv-1",
    )
    assert resolved["status"] == "resolved"
    assert (await _grievance_row(pg_pool, tenant_id, gid))["status"] == "resolved"
    assert await _notice_body(pg_pool, gid, "grievance_resolved") is not None


@pytest.mark.asyncio
async def test_status_guards_and_assignment_gate(pg_pool):
    tenant_id = f"griev-{uuid.uuid4()}"
    await _seed_templates(pg_pool, tenant_id)
    svc = GrievanceService(pg_pool)

    filed = await svc.file_grievance(
        tenant_id=tenant_id, member_ref="m1", case_id=None, category="c",
        description="d", urgency="standard", lob="ma", filed_by="portal",
    )
    gid = uuid.UUID(filed["grievance_id"])

    # assign before acknowledge → conflict (not 'acknowledged')
    with pytest.raises(GrievanceConflictError):
        await svc.assign_investigator(
            tenant_id=tenant_id, grievance_id=gid,
            investigator_id="inv-1", assigned_by="coord",
        )

    await svc.acknowledge_grievance(
        tenant_id=tenant_id, grievance_id=gid, acknowledged_by="coord"
    )
    # double-acknowledge a non-'filed' grievance → conflict
    with pytest.raises(GrievanceConflictError):
        await svc.acknowledge_grievance(
            tenant_id=tenant_id, grievance_id=gid, acknowledged_by="coord"
        )

    await svc.assign_investigator(
        tenant_id=tenant_id, grievance_id=gid,
        investigator_id="inv-1", assigned_by="coord",
    )

    # resolve as a non-assigned investigator → NotAssignedError
    with pytest.raises(NotAssignedError):
        await svc.resolve_grievance(
            tenant_id=tenant_id, grievance_id=gid,
            resolution="x", resolved_by="inv-2",
        )

    # resolve by the assigned investigator → ok
    await svc.resolve_grievance(
        tenant_id=tenant_id, grievance_id=gid,
        resolution="addressed", resolved_by="inv-1",
    )
    # double-resolve a non-'investigating' grievance → conflict
    with pytest.raises(GrievanceConflictError):
        await svc.resolve_grievance(
            tenant_id=tenant_id, grievance_id=gid,
            resolution="again", resolved_by="inv-1",
        )


@pytest.mark.asyncio
async def test_decoupled_from_cases(pg_pool):
    """A full grievance lifecycle must never create/touch a workflow_instances row."""
    tenant_id = f"griev-{uuid.uuid4()}"
    await _seed_templates(pg_pool, tenant_id)
    svc = GrievanceService(pg_pool)

    filed = await svc.file_grievance(
        tenant_id=tenant_id, member_ref="m1", case_id=None, category="c",
        description="d", urgency="standard", lob="ma", filed_by="portal",
    )
    gid = uuid.UUID(filed["grievance_id"])
    await svc.acknowledge_grievance(tenant_id=tenant_id, grievance_id=gid, acknowledged_by="coord")
    await svc.assign_investigator(
        tenant_id=tenant_id, grievance_id=gid, investigator_id="inv-1", assigned_by="coord"
    )
    await svc.resolve_grievance(
        tenant_id=tenant_id, grievance_id=gid, resolution="done", resolved_by="inv-1"
    )

    async with tenant_transaction(pg_pool, tenant_id) as conn:
        count = await conn.fetchval(
            "SELECT count(*) FROM workflow_instances WHERE tenant_id=$1", tenant_id
        )
    assert count == 0
