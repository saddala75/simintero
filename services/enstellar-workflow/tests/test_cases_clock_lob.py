"""Integration test — the decision clock starts with the LOB-aware duration
resolved from the workflow_config substrate (slice S2, Task 3).

Both cases are created under the SAME tenant (demo-tenant, seeded in migration
0014 with commercial standard-decision = 5d and ma = 7d). Same urgency, same
tenant, different LOB → different clock duration. Proves the call-site swap from
the urgency-only CLOCK_RULES to ConfigService.resolve_clock.
"""
import uuid

import asyncpg
import pytest

from simintero_tenant_context import tenant_transaction

from enstellar_workflow.cases.service import CaseService
from tests.conftest import make_case

TENANT = "demo-tenant"


async def _read_clock(pg_pool: asyncpg.Pool, case_id: uuid.UUID) -> asyncpg.Record:
    async with tenant_transaction(pg_pool, TENANT) as conn:
        return await conn.fetchrow(
            "SELECT duration_calendar_days, deadline, started_at "
            "FROM clocks WHERE case_id = $1 AND clock_type = 'decision'",
            case_id,
        )


@pytest.mark.asyncio
async def test_decision_clock_duration_is_lob_aware(pg_pool: asyncpg.Pool):
    service = CaseService(pg_pool)

    commercial_case = make_case(
        tenant_id=TENANT, correlation_id=f"corr-lob-comm-{uuid.uuid4()}"
    )  # make_case defaults lob='commercial'
    ma_case = make_case(
        tenant_id=TENANT, correlation_id=f"corr-lob-ma-{uuid.uuid4()}"
    ).model_copy(update={"lob": "ma"})

    await service.create_case(commercial_case)
    await service.create_case(ma_case)

    comm_clock = await _read_clock(pg_pool, commercial_case.case_id)
    ma_clock = await _read_clock(pg_pool, ma_case.case_id)

    assert comm_clock is not None, "commercial case should have a decision clock"
    assert ma_clock is not None, "ma case should have a decision clock"

    # SAME tenant, SAME urgency (standard), different LOB → different duration
    assert comm_clock["duration_calendar_days"] == 5
    assert ma_clock["duration_calendar_days"] == 7

    # deadline ≈ started_at + N calendar days
    assert (comm_clock["deadline"] - comm_clock["started_at"]).days == 5
    assert (ma_clock["deadline"] - ma_clock["started_at"]).days == 7
