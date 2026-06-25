from __future__ import annotations

import asyncpg


class GrievanceRepository:
    """Reads/writes the grievances table. Every method takes a `conn` already
    inside the caller's tenant_transaction (sets sim.tenant_id → RLS isolates).

    Grievances are a NEW entity PARALLEL to cases — this repository NEVER touches
    workflow_instances / workflow_events. Every transition is status-guarded in a
    single atomic UPDATE … WHERE status=<expected> RETURNING, returning the row or
    None so the service can map a no-op (wrong-state) to a conflict.
    """

    async def insert(
        self,
        conn: asyncpg.Connection,
        *,
        tenant_id: str,
        member_ref: str,
        case_id,
        category: str | None,
        description: str | None,
        urgency: str,
        lob: str | None,
        filed_by: str,
        ack_days: int,
        resolution_days: int,
    ) -> dict:
        row = await conn.fetchrow(
            """
            INSERT INTO grievances
              (tenant_id, member_ref, case_id, category, description, urgency, lob, filed_by,
               acknowledgement_due_at, resolution_due_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                    now() + ($9 || ' days')::interval, now() + ($10 || ' days')::interval)
            RETURNING *
            """,
            tenant_id, member_ref, case_id, category, description, urgency, lob, filed_by,
            str(ack_days), str(resolution_days),
        )
        return dict(row)

    async def fetch(self, conn: asyncpg.Connection, grievance_id, tenant_id: str) -> dict | None:
        row = await conn.fetchrow(
            "SELECT * FROM grievances WHERE grievance_id=$1 AND tenant_id=$2",
            grievance_id, tenant_id,
        )
        return dict(row) if row is not None else None

    async def acknowledge(
        self, conn: asyncpg.Connection, *, grievance_id, tenant_id: str, acknowledged_by: str
    ) -> dict | None:
        row = await conn.fetchrow(
            "UPDATE grievances SET acknowledged_at=now(), acknowledged_by=$3, status='acknowledged' "
            "WHERE grievance_id=$1 AND tenant_id=$2 AND status='filed' RETURNING *",
            grievance_id, tenant_id, acknowledged_by,
        )
        return dict(row) if row is not None else None

    async def assign(
        self, conn: asyncpg.Connection, *, grievance_id, tenant_id: str,
        investigator_id: str, assigned_by: str,
    ) -> dict | None:
        row = await conn.fetchrow(
            "UPDATE grievances SET assigned_to=$3, assigned_at=now(), assigned_by=$4, status='investigating' "
            "WHERE grievance_id=$1 AND tenant_id=$2 AND status='acknowledged' RETURNING *",
            grievance_id, tenant_id, investigator_id, assigned_by,
        )
        return dict(row) if row is not None else None

    async def resolve(
        self, conn: asyncpg.Connection, *, grievance_id, tenant_id: str,
        resolution: str | None, resolved_by: str,
    ) -> dict | None:
        row = await conn.fetchrow(
            "UPDATE grievances SET resolved_at=now(), resolution=$3, resolved_by=$4, status='resolved' "
            "WHERE grievance_id=$1 AND tenant_id=$2 AND status='investigating' RETURNING *",
            grievance_id, tenant_id, resolution, resolved_by,
        )
        return dict(row) if row is not None else None

    async def assigned_open(
        self, conn: asyncpg.Connection, *, tenant_id: str, investigator_sub: str
    ) -> list[dict]:
        rows = await conn.fetch(
            "SELECT * FROM grievances WHERE tenant_id=$1 AND assigned_to=$2 AND status='investigating' "
            "ORDER BY filed_at",
            tenant_id, investigator_sub,
        )
        return [dict(r) for r in rows]
