from __future__ import annotations
import asyncio
import logging
import uuid
from datetime import datetime, timezone

import asyncpg
from jinja2.sandbox import SandboxedEnvironment
from jinja2 import StrictUndefined

from simintero_outbox import SchemaRef, make_envelope
from enstellar_workflow.outbox.publisher import OutboxPublisher
from ..workflow_config import ConfigService
from ..normalization.storage import MinioStore
from ..normalization.config import get_normalization_settings

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
        actor_id: str,
        actor_type: str,
        correlation_id: str | None = None,
        causation_id: str | None = None,
        lob: str | None = None,
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

        # Resolve per-(tenant, lob) notice params + expose lob; caller's safe_context
        # wins on key collision. lob=None is a DEFINED key → StrictUndefined-safe.
        params = await ConfigService().resolve_notice_params(conn, tenant_id=tenant_id, lob=lob)
        render_ctx = {**params, "lob": lob, **safe_context}
        # UNstripped context — includes member PHI; used ONLY for member_phi templates,
        # whose rendered body goes to MinIO (never the event plane).
        full_ctx = {**params, "lob": lob, **context}

        # LOB-preferring per-channel select: keep the LOB-specific row when present,
        # else fall back to the generic (lob IS NULL) row. One template per channel.
        templates = await conn.fetch(
            "SELECT DISTINCT ON (channel) * FROM notification_templates "
            "WHERE tenant_id=$1 AND event_type=$2 AND active=TRUE "
            "  AND (lob = $3 OR lob IS NULL) "
            "ORDER BY channel, (lob IS NULL) ASC, version DESC",
            tenant_id, event_type, lob,
        )
        if not templates:
            # Compliance-critical: an adverse determination/appeal notice that
            # matches NO template (no LOB-specific row AND no generic lob=NULL
            # fallback) is silently never sent. Surface it loudly so a missing
            # per-LOB template is caught, not dropped.
            logger.warning(
                "no notification template matched — notice NOT sent "
                "(tenant=%s case=%s event_type=%s lob=%s)",
                tenant_id, case_id, event_type, lob,
            )
        notification_ids: list[str] = []
        store = None
        for tmpl in templates:
            is_phi = bool(tmpl["member_phi"])
            ctx = full_ctx if is_phi else render_ctx
            try:
                subject = _jinja.from_string(tmpl["subject_template"]).render(**ctx)
                body = _jinja.from_string(tmpl["body_template"]).render(**ctx)
            except Exception as exc:
                logger.error(
                    "Template render failed for template_id=%s: %s",
                    tmpl["template_id"], exc,
                )
                continue
            nid = await conn.fetchval(
                "INSERT INTO notification_log "
                "(tenant_id, case_id, event_type, channel, template_id, rendered_subject, lob) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7) "
                "ON CONFLICT (tenant_id, case_id, event_type, channel) DO NOTHING "
                "RETURNING notification_id",
                tenant_id, uuid.UUID(case_id), event_type,
                tmpl["channel"], tmpl["template_id"], subject, lob,
            )
            if nid is None:
                logger.info(
                    "notice already sent for case=%s event_type=%s channel=%s — skipping",
                    case_id, event_type, tmpl["channel"],
                )
                continue  # do not publish NOTIFICATION_SENT for an already-sent notice
            if is_phi:
                # PHI body → MinIO (off the event plane); event carries ONLY a reference.
                # Fail-loud: a PHI notice MUST have a secure body — NEVER fall back to PHI-in-event.
                if store is None:
                    store = MinioStore(get_normalization_settings())
                body_ref = await asyncio.to_thread(store.upload_notice, tenant_id, str(nid), body)
                payload = {
                    "case_id": case_id,
                    "channel": tmpl["channel"],
                    "event_type": event_type,
                    "notification_id": str(nid),
                    "lob": lob,
                    "body_ref": body_ref,
                    "member_phi": True,
                }
            else:
                to_address_raw = tmpl.get("to_address")
                to_address: str | None = None
                if to_address_raw:
                    try:
                        to_address = _jinja.from_string(to_address_raw).render(**render_ctx)
                    except Exception as exc:
                        logger.error(
                            "to_address render failed template_id=%s: %s",
                            tmpl["template_id"], exc,
                        )
                payload = {
                    "case_id": case_id,
                    "channel": tmpl["channel"],
                    "event_type": event_type,
                    "notification_id": str(nid),
                    "subject": subject,
                    "body": body,
                    "lob": lob,
                    **({"to_address": to_address} if to_address else {}),
                }
            await self._pub.publish(
                conn,
                make_envelope(
                    SchemaRef.NOTIFICATION_SENT,
                    tenant_id=tenant_id,
                    actor_id=actor_id,
                    actor_type=actor_type,
                    # Preserve the triggering event's correlation_id (do NOT
                    # regenerate); fall back to a fresh id only on synchronous
                    # paths that supply no triggering event.
                    correlation_id=correlation_id or str(uuid.uuid4()),
                    causation_id=causation_id,
                    payload=payload,
                ),
            )
            notification_ids.append(str(nid))
        return notification_ids
