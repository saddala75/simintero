import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest

from enstellar_workflow.appeals import AppealsRepository
from simintero_tenant_context import tenant_transaction

TENANT = "appeals-test-tenant"
OTHER_TENANT = "appeals-other-tenant"


async def _seed_case(conn: asyncpg.Connection, case_id: uuid.UUID, tenant_id: str) -> None:
    """Insert a minimal workflow_instances row so workflow_events FK is satisfied."""
    await conn.execute(
        """
        INSERT INTO workflow_instances (case_id, tenant_id, correlation_id, lob, case_json)
        VALUES ($1, $2, $3, 'commercial', '{}'::jsonb)
        """,
        case_id, tenant_id, f"corr-{case_id}",
    )


async def _seed_event(
    conn: asyncpg.Connection,
    case_id: uuid.UUID,
    tenant_id: str,
    *,
    to_state: str,
    actor_id: str,
    actor_type: str,
    occurred_at: datetime,
) -> None:
    await conn.execute(
        """
        INSERT INTO workflow_events
          (case_id, tenant_id, event_type, from_state, to_state,
           actor_id, actor_type, correlation_id, occurred_at)
        VALUES ($1, $2, 'sim.case.lifecycle/CaseStateChanged/v1', NULL, $3,
                $4, $5, $6, $7)
        """,
        case_id, tenant_id, to_state, actor_id, actor_type,
        f"corr-{case_id}", occurred_at,
    )


@pytest.mark.asyncio
async def test_insert_fetch_latest_and_record_outcome(pg_pool):
    repo = AppealsRepository()
    case_id = uuid.uuid4()

    async with tenant_transaction(pg_pool, TENANT) as conn:
        appeal = await repo.insert_appeal(
            conn,
            case_id=case_id,
            tenant_id=TENANT,
            level=1,
            appealed_ref="decision-123",
            filed_by="member-7",
            reason="Disagree with the denial",
        )

    appeal_id = appeal["appeal_id"]
    assert isinstance(appeal_id, uuid.UUID)
    assert appeal["level"] == 1
    assert appeal["status"] == "under_review"
    assert appeal["appealed_ref"] == "decision-123"
    assert appeal["filed_at"] is not None
    assert appeal["decided_at"] is None

    # fetch + latest return the inserted row
    async with tenant_transaction(pg_pool, TENANT) as conn:
        fetched = await repo.fetch(conn, appeal_id, TENANT)
        latest = await repo.latest_appeal(conn, case_id, TENANT)
    assert fetched is not None and fetched["appeal_id"] == appeal_id
    assert latest is not None and latest["appeal_id"] == appeal_id
    assert latest["level"] == 1

    # record an outcome → returns the updated (decided) row
    async with tenant_transaction(pg_pool, TENANT) as conn:
        decided = await repo.record_outcome(
            conn,
            appeal_id=appeal_id,
            tenant_id=TENANT,
            status="overturned",
            outcome_reason="New evidence accepted",
            reviewer_actor="reviewer-9",
        )
    assert decided is not None
    assert decided["status"] == "overturned"
    assert decided["outcome_reason"] == "New evidence accepted"
    assert decided["reviewer_actor"] == "reviewer-9"
    assert decided["decided_at"] is not None

    # a 2nd record_outcome on the now-not-under_review row → None (idempotent guard)
    async with tenant_transaction(pg_pool, TENANT) as conn:
        again = await repo.record_outcome(
            conn,
            appeal_id=appeal_id,
            tenant_id=TENANT,
            status="upheld",
            outcome_reason="should not apply",
            reviewer_actor="reviewer-9",
        )
    assert again is None


@pytest.mark.asyncio
async def test_latest_appeal_returns_highest_level(pg_pool):
    repo = AppealsRepository()
    case_id = uuid.uuid4()
    # Insert L1 and decide it (uphold) before inserting L2 — mirrors the real
    # appeal ladder and is required by the partial unique index on
    # (case_id, tenant_id) WHERE status='under_review': only one active appeal
    # per case at a time.
    async with tenant_transaction(pg_pool, TENANT) as conn:
        l1 = await repo.insert_appeal(
            conn, case_id=case_id, tenant_id=TENANT, level=1,
            appealed_ref="dec-1", filed_by="m1", reason=None,
        )
        await repo.record_outcome(
            conn, appeal_id=l1["appeal_id"], tenant_id=TENANT,
            status="upheld", outcome_reason="held", reviewer_actor="rev-x",
        )
        l2 = await repo.insert_appeal(
            conn, case_id=case_id, tenant_id=TENANT, level=2,
            appealed_ref="appeal-1", filed_by="m1", reason=None,
        )
    async with tenant_transaction(pg_pool, TENANT) as conn:
        latest = await repo.latest_appeal(conn, case_id, TENANT)
    assert latest is not None
    assert latest["level"] == 2
    assert latest["appeal_id"] == l2["appeal_id"]


@pytest.mark.asyncio
async def test_adverse_determiner_returns_human_actor_ignoring_system(pg_pool):
    repo = AppealsRepository()
    case_id = uuid.uuid4()
    base = datetime.now(timezone.utc)

    async with tenant_transaction(pg_pool, TENANT) as conn:
        await _seed_case(conn, case_id, TENANT)
        # The human adverse determination (earlier).
        await _seed_event(
            conn, case_id, TENANT,
            to_state="denied", actor_id="clinician-7", actor_type="user",
            occurred_at=base,
        )
        # A later SYSTEM row — must be ignored even though it is adverse.
        await _seed_event(
            conn, case_id, TENANT,
            to_state="denied", actor_id="system-bot", actor_type="system",
            occurred_at=base + timedelta(minutes=5),
        )
        # A non-adverse system row — must be ignored (not an adverse state).
        await _seed_event(
            conn, case_id, TENANT,
            to_state="intake", actor_id="orchestrator", actor_type="service",
            occurred_at=base + timedelta(minutes=10),
        )
        determiner = await repo.adverse_determiner(conn, case_id, TENANT)

    assert determiner == "clinician-7"


@pytest.mark.asyncio
async def test_adverse_determiner_none_when_no_adverse_row(pg_pool):
    repo = AppealsRepository()
    case_id = uuid.uuid4()
    base = datetime.now(timezone.utc)

    async with tenant_transaction(pg_pool, TENANT) as conn:
        await _seed_case(conn, case_id, TENANT)
        # Only a non-adverse human row exists.
        await _seed_event(
            conn, case_id, TENANT,
            to_state="approved", actor_id="clinician-7", actor_type="user",
            occurred_at=base,
        )
        determiner = await repo.adverse_determiner(conn, case_id, TENANT)

    assert determiner is None


@pytest.mark.asyncio
async def test_appeal_at_level_returns_prior_level_row(pg_pool):
    repo = AppealsRepository()
    case_id = uuid.uuid4()

    async with tenant_transaction(pg_pool, TENANT) as conn:
        l1 = await repo.insert_appeal(
            conn, case_id=case_id, tenant_id=TENANT, level=1,
            appealed_ref="dec-1", filed_by="m1", reason=None,
        )
        await repo.record_outcome(
            conn, appeal_id=l1["appeal_id"], tenant_id=TENANT,
            status="upheld", outcome_reason="held", reviewer_actor="rev-1",
        )
        await repo.insert_appeal(
            conn, case_id=case_id, tenant_id=TENANT, level=2,
            appealed_ref="appeal-1", filed_by="m1", reason=None,
        )

    async with tenant_transaction(pg_pool, TENANT) as conn:
        prior = await repo.appeal_at_level(conn, case_id, TENANT, 1)
        missing = await repo.appeal_at_level(conn, case_id, TENANT, 3)

    assert prior is not None
    assert prior["level"] == 1
    assert prior["reviewer_actor"] == "rev-1"
    assert missing is None


# ---------------------------------------------------------------------------
# RLS isolation: the testcontainers default role is a SUPERUSER (bypasses RLS),
# so the cross-tenant probe must connect as a NON-SUPERUSER app role — mirroring
# tests/test_tenancy_authz_conformance.py.
# ---------------------------------------------------------------------------
APP_USER = "appeals_rls_app_user"
APP_PASSWORD = "appeals_rls_app_pw"


def _app_dsn(admin_dsn: str) -> str:
    after_scheme = admin_dsn.split("://", 1)[1]
    host_part = after_scheme.split("@", 1)[1]
    return f"postgresql://{APP_USER}:{APP_PASSWORD}@{host_part}"


@pytest.mark.asyncio
async def test_rls_isolates_appeals_across_tenants(db_dsn):
    """A non-superuser SELECT under tenant B's GUC must NOT see tenant A's appeal."""
    case_id = uuid.uuid4()
    admin = await asyncpg.connect(db_dsn)
    try:
        await admin.execute(
            f"""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_USER}') THEN
                    REVOKE ALL ON appeals FROM {APP_USER};
                    DROP ROLE {APP_USER};
                END IF;
            END
            $$;
            CREATE ROLE {APP_USER} LOGIN PASSWORD '{APP_PASSWORD}';
            GRANT SELECT, INSERT, UPDATE, DELETE ON appeals TO {APP_USER};
            """
        )
    finally:
        await admin.close()

    pool = await asyncpg.create_pool(_app_dsn(db_dsn), min_size=1, max_size=2)
    try:
        # Seed an appeal for TENANT (as the app role, under TENANT's GUC).
        async with tenant_transaction(pool, TENANT) as conn:
            await conn.execute(
                "INSERT INTO appeals (case_id, tenant_id, level, appealed_ref, filed_by) "
                "VALUES ($1, $2, 1, 'dec-x', 'm1')",
                case_id, TENANT,
            )
        # Under OTHER_TENANT's GUC, the row is invisible.
        async with tenant_transaction(pool, OTHER_TENANT) as conn:
            rows = await conn.fetch(
                "SELECT * FROM appeals WHERE case_id = $1", case_id
            )
        assert rows == []
        # Under TENANT's GUC, the row IS visible (proves the table is not just empty).
        async with tenant_transaction(pool, TENANT) as conn:
            rows = await conn.fetch(
                "SELECT * FROM appeals WHERE case_id = $1", case_id
            )
        assert len(rows) == 1
    finally:
        await pool.close()
