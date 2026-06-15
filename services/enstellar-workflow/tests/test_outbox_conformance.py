"""C2a conformance verification — requires PostgreSQL (Testcontainers).

Drives ONE real case event through the engine into ``shared.outbox`` and asserts
the persisted ``envelope`` validates against the published platform envelope via
the conformance kit, and that the row's ``topic`` matches ``topic_for(schema_ref)``.

This deliberately exercises a *real emitted* event (via ``CaseService.create_case``,
which publishes through the OutboxPublisher) — not a hand-built envelope.
"""
import json
import uuid

import asyncpg
import pytest

from simintero_conformance import assert_envelope_valid
from simintero_outbox import topic_for
from enstellar_workflow.cases.service import CaseService
from tests.conftest import make_case


@pytest.mark.asyncio
async def test_emitted_case_event_conforms_and_routes(pg_pool: asyncpg.Pool):
    # Drive a real case event through the engine -> shared.outbox.
    service = CaseService(pg_pool)
    case = make_case(correlation_id=f"corr-conformance-{uuid.uuid4()}")
    await service.create_case(case)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT topic, envelope FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1",
            str(case.case_id),
        )

    assert row is not None, "create_case must have emitted an outbox event"

    raw = row["envelope"]
    envelope = json.loads(raw) if isinstance(raw, str) else raw

    # 1) The emitted envelope validates against the published platform envelope.
    validated = assert_envelope_valid(envelope)  # must NOT raise

    # 2) The row's topic matches the kit's routing for the envelope's schema_ref.
    assert topic_for(envelope["schema_ref"]) == row["topic"]
    assert topic_for(validated.schema_ref) == row["topic"]
