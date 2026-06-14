from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone

import asyncpg
from jinja2.sandbox import SandboxedEnvironment
from jinja2 import StrictUndefined

from enstellar_events import Actor, EventEnvelope, SchemaRef
from enstellar_workflow.outbox.publisher import OutboxPublisher

logger = logging.getLogger(__name__)

_jinja = SandboxedEnvironment(loader=None, undefined=StrictUndefined, autoescape=False)

TERMINAL_OUTCOMES = frozenset({"approved", "denied", "partially_denied", "adverse_modification"})

# PHI field names that must never appear in rendered notification context
_PHI_FIELDS = frozenset({
    "member_name", "dob", "ssn", "date_of_birth", "member_id",
    "address", "phone", "email", "npi", "mrn", "gender",
})


class NotificationService:
    def __init__(self, publisher: OutboxPublisher) -> None:
        self._pub = publisher

    async def render_and_dispatch(
        self,
        conn: asyncpg.Connection,
        tenant_id: str,
        case_id: str,
        event_type: str,
        context: dict,
        actor: Actor,
    ) -> list[str]:
        """Render all active templates for the given event_type and persist log + outbox events.

        PHI fields are stripped from the render context before template expansion to enforce
        minimum-necessary data principle (invariant #3).

        Returns the list of notification_ids created.
        """
        if not conn.is_in_transaction():
            raise RuntimeError(
                "render_and_dispatch must be called inside an active transaction"
            )
        # Strip PHI fields from context before rendering (invariant #3 — PHI minimum-necessary)
        safe_context = {k: v for k, v in context.items() if k not in _PHI_FIELDS}

        templates = await conn.fetch(
            "SELECT * FROM notification_templates "
            "WHERE tenant_id=$1 AND event_type=$2 AND active=TRUE",
            tenant_id, event_type,
        )
        notification_ids: list[str] = []
        for tmpl in templates:
            try:
                subject = _jinja.from_string(tmpl["subject_template"]).render(**safe_context)
                body = _jinja.from_string(tmpl["body_template"]).render(**safe_context)
            except Exception as exc:
                logger.error(
                    "Template render failed for template_id=%s: %s",
                    tmpl["template_id"], exc,
                )
                continue
            nid = await conn.fetchval(
                "INSERT INTO notification_log "
                "(tenant_id, case_id, event_type, channel, template_id, rendered_subject) "
                "VALUES ($1, $2, $3, $4, $5, $6) RETURNING notification_id",
                tenant_id, uuid.UUID(case_id), event_type,
                tmpl["channel"], tmpl["template_id"], subject,
            )
            await self._pub.publish(
                conn,
                EventEnvelope(
                    event_id=uuid.uuid4(),
                    tenant_id=tenant_id,
                    case_id=uuid.UUID(case_id),
                    correlation_id=str(uuid.uuid4()),
                    schema_ref=SchemaRef.NOTIFICATION_SENT,
                    occurred_at=datetime.now(timezone.utc),
                    actor=actor,
                    payload={
                        "channel": tmpl["channel"],
                        "event_type": event_type,
                        "notification_id": str(nid),
                        "subject": subject,
                        "body": body,
                    },
                ),
            )
            notification_ids.append(str(nid))
        return notification_ids
