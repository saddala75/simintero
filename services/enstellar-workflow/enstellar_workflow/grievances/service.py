"""GrievanceService — member grievance lifecycle, PARALLEL to (and fully
decoupled from) the case workflow.

A grievance moves filed → acknowledged → investigating → resolved. Each
transition is a single status-guarded atomic UPDATE (wrong-state → conflict),
resolve additionally requires the resolver to be the assigned investigator
(assignment gate). Every step emits an outbox event + renders an LOB-aware
member notice.

This service NEVER imports/calls engine.apply / TransitionEngine and NEVER
touches workflow_instances / workflow_events — grievances are their own entity.
"""
from __future__ import annotations

import asyncpg

from simintero_outbox import SchemaRef, make_envelope
from simintero_tenant_context import tenant_transaction

from ..comms.service import NotificationService
from ..outbox.publisher import OutboxPublisher
from ..workflow_config import ConfigService
from .repository import GrievanceRepository


class GrievanceConflictError(Exception):
    """Raised when a grievance is not in the expected state for a transition
    (mapped to HTTP 409)."""


class NotAssignedError(Exception):
    """Raised when someone other than the assigned investigator tries to resolve
    a grievance (mapped to HTTP 403)."""


class GrievanceNotFoundError(Exception):
    """Raised when a grievance does not exist for the tenant (mapped to HTTP 404)."""


def _iso(value):
    return value.isoformat() if value is not None else None


class GrievanceService:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool
        self._pub = OutboxPublisher()
        self._notify = NotificationService(self._pub)
        self._config = ConfigService()
        self._repo = GrievanceRepository()

    async def file_grievance(
        self,
        *,
        tenant_id: str,
        member_ref: str,
        case_id,
        category: str | None,
        description: str | None,
        urgency: str,
        lob: str | None,
        filed_by: str,
    ) -> dict:
        async with tenant_transaction(self._pool, tenant_id) as conn:
            sla = await self._config.resolve_grievance_sla(
                conn, tenant_id=tenant_id, lob=lob, urgency=urgency
            )
            g = await self._repo.insert(
                conn,
                tenant_id=tenant_id,
                member_ref=member_ref,
                case_id=case_id,
                category=category,
                description=description,
                urgency=urgency,
                lob=lob,
                filed_by=filed_by,
                ack_days=sla["acknowledgement_days"],
                resolution_days=sla["resolution_days"],
            )
            gid = str(g["grievance_id"])
            await self._pub.publish(
                conn,
                make_envelope(
                    SchemaRef.GRIEVANCE_FILED,
                    tenant_id=tenant_id,
                    actor_id=filed_by,
                    actor_type="user",
                    correlation_id=gid,
                    # Minimum-necessary: do NOT broadcast member_ref on the event
                    # plane — grievance_id is the handle; a consumer reads member_ref
                    # from the RLS-scoped grievance row if it needs it.
                    payload={
                        "grievance_id": gid,
                        "category": category,
                    },
                ),
            )
            await self._notify.render_and_dispatch(
                conn,
                tenant_id,
                gid,
                event_type="grievance_filed",
                context={
                    "grievance_id": gid,
                    "category": category,
                    "resolution_days": sla["resolution_days"],
                },
                actor_id=filed_by,
                actor_type="user",
                correlation_id=gid,
                lob=lob,
            )
        return {
            "grievance_id": gid,
            "status": "filed",
            "resolution_due_at": _iso(g.get("resolution_due_at")),
        }

    async def acknowledge_grievance(
        self, *, tenant_id: str, grievance_id, acknowledged_by: str
    ) -> dict:
        async with tenant_transaction(self._pool, tenant_id) as conn:
            row = await self._repo.acknowledge(
                conn,
                grievance_id=grievance_id,
                tenant_id=tenant_id,
                acknowledged_by=acknowledged_by,
            )
            if row is None:
                raise GrievanceConflictError(
                    f"grievance {grievance_id} is not in 'filed'"
                )
            gid = str(grievance_id)
            await self._pub.publish(
                conn,
                make_envelope(
                    SchemaRef.GRIEVANCE_ACKNOWLEDGED,
                    tenant_id=tenant_id,
                    actor_id=acknowledged_by,
                    actor_type="user",
                    correlation_id=gid,
                    payload={"grievance_id": gid},
                ),
            )
            await self._notify.render_and_dispatch(
                conn,
                tenant_id,
                gid,
                event_type="grievance_acknowledged",
                context={"grievance_id": gid},
                actor_id=acknowledged_by,
                actor_type="user",
                correlation_id=gid,
                lob=row["lob"],
            )
        return {"grievance_id": gid, "status": "acknowledged"}

    async def assign_investigator(
        self, *, tenant_id: str, grievance_id, investigator_id: str, assigned_by: str
    ) -> dict:
        async with tenant_transaction(self._pool, tenant_id) as conn:
            row = await self._repo.assign(
                conn,
                grievance_id=grievance_id,
                tenant_id=tenant_id,
                investigator_id=investigator_id,
                assigned_by=assigned_by,
            )
            if row is None:
                raise GrievanceConflictError(
                    f"grievance {grievance_id} is not in 'acknowledged'"
                )
        return {
            "grievance_id": str(grievance_id),
            "assigned_to": investigator_id,
            "status": "investigating",
        }

    async def resolve_grievance(
        self, *, tenant_id: str, grievance_id, resolution: str | None, resolved_by: str
    ) -> dict:
        async with tenant_transaction(self._pool, tenant_id) as conn:
            g = await self._repo.fetch(conn, grievance_id, tenant_id)
            if g is None:
                raise GrievanceNotFoundError(f"grievance {grievance_id} not found")
            if g["status"] != "investigating":
                raise GrievanceConflictError(
                    f"grievance {grievance_id} is not in 'investigating'"
                )
            # Assignment gate — only the assigned investigator may resolve.
            if g["assigned_to"] != resolved_by:
                raise NotAssignedError(
                    f"grievance {grievance_id} is not assigned to {resolved_by!r}"
                )
            row = await self._repo.resolve(
                conn,
                grievance_id=grievance_id,
                tenant_id=tenant_id,
                resolution=resolution,
                resolved_by=resolved_by,
            )
            if row is None:
                raise GrievanceConflictError(
                    f"grievance {grievance_id} is not in 'investigating'"
                )
            gid = str(grievance_id)
            await self._pub.publish(
                conn,
                make_envelope(
                    SchemaRef.GRIEVANCE_RESOLVED,
                    tenant_id=tenant_id,
                    actor_id=resolved_by,
                    actor_type="user",
                    correlation_id=gid,
                    payload={"grievance_id": gid, "resolution": resolution},
                ),
            )
            await self._notify.render_and_dispatch(
                conn,
                tenant_id,
                gid,
                event_type="grievance_resolved",
                context={"grievance_id": gid, "resolution": resolution},
                actor_id=resolved_by,
                actor_type="user",
                correlation_id=gid,
                lob=g["lob"],
            )
        return {"grievance_id": gid, "status": "resolved"}

    async def get_grievance(self, *, tenant_id: str, grievance_id) -> dict:
        async with tenant_transaction(self._pool, tenant_id) as conn:
            g = await self._repo.fetch(conn, grievance_id, tenant_id)
        if g is None:
            raise GrievanceNotFoundError(f"grievance {grievance_id} not found")
        return {
            "grievance_id": str(g["grievance_id"]),
            "member_ref": g.get("member_ref"),
            "case_id": str(g["case_id"]) if g.get("case_id") else None,
            "category": g.get("category"),
            "description": g.get("description"),
            "urgency": g.get("urgency"),
            "lob": g.get("lob"),
            "status": g.get("status"),
            "filed_by": g.get("filed_by"),
            "filed_at": _iso(g.get("filed_at")),
            "acknowledged_at": _iso(g.get("acknowledged_at")),
            "acknowledged_by": g.get("acknowledged_by"),
            "assigned_to": g.get("assigned_to"),
            "assigned_at": _iso(g.get("assigned_at")),
            "resolution": g.get("resolution"),
            "resolved_at": _iso(g.get("resolved_at")),
            "resolution_due_at": _iso(g.get("resolution_due_at")),
        }

    async def list_assigned(
        self, *, tenant_id: str, investigator_sub: str
    ) -> list[dict]:
        async with tenant_transaction(self._pool, tenant_id) as conn:
            rows = await self._repo.assigned_open(
                conn, tenant_id=tenant_id, investigator_sub=investigator_sub
            )
        return [
            {
                "grievance_id": str(r["grievance_id"]),
                "member_ref": str(r["member_ref"]) if r.get("member_ref") is not None else None,
                "case_id": str(r["case_id"]) if r.get("case_id") is not None else None,
                "category": r.get("category"),
                "urgency": r.get("urgency"),
                "lob": r.get("lob"),
                "status": r.get("status"),
                "assigned_to": r.get("assigned_to"),
                "filed_at": _iso(r.get("filed_at")),
                "assigned_at": _iso(r.get("assigned_at")),
                "resolution_due_at": _iso(r.get("resolution_due_at")),
            }
            for r in rows
        ]
