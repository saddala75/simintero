"""Cut over to the platform shared.outbox + shared.processed_events.

Destructive (pre-prod, no data to migrate): drops the legacy flattened
``outbox`` and ``processed_events`` tables and recreates them under the
``shared`` schema with the platform EventEnvelope shape (event_id ULID PK,
topic, key, envelope jsonb, tenant_id).

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS shared")

    # --- Drop the legacy flattened tables (pre-prod: no data to preserve) ---
    # 0010 enabled RLS + a tenant_isolation policy on the public outbox; drop the
    # whole table (the policy goes with it).
    op.execute("DROP TABLE IF EXISTS outbox CASCADE")
    op.execute("DROP TABLE IF EXISTS processed_events CASCADE")

    # --- shared.outbox: platform envelope shape ---
    op.create_table(
        "outbox",
        sa.Column("event_id", sa.Text, primary_key=True),
        sa.Column("topic", sa.Text, nullable=False),
        sa.Column("key", sa.Text, nullable=True),
        sa.Column("envelope", JSONB, nullable=False),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("published_at", sa.TIMESTAMP(timezone=True), nullable=True),
        schema="shared",
    )
    # Partial index for the relay's "unpublished" scan, ordered by event_id
    # (ULID is lexicographically time-ordered, so this preserves FIFO-ish order).
    op.create_index(
        "ix_shared_outbox_unpublished",
        "outbox",
        ["event_id"],
        schema="shared",
        postgresql_where=sa.text("published_at IS NULL"),
    )

    # --- shared.processed_events: consumer dedup ledger ---
    op.create_table(
        "processed_events",
        sa.Column("event_id", sa.Text, nullable=False),
        sa.Column("consumer_group", sa.Text, nullable=False),
        sa.Column(
            "processed_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint(
            "event_id", "consumer_group", name="pk_shared_processed_events"
        ),
        schema="shared",
    )

    # --- RLS tenant isolation on shared.outbox ---
    op.execute("ALTER TABLE shared.outbox ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE shared.outbox FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON shared.outbox "
        "USING (tenant_id = current_setting('sim.tenant_id', true))"
    )

    # --- Relay role (BYPASSRLS) so the relay can read every tenant's rows ---
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sim_relay') THEN
                CREATE ROLE sim_relay BYPASSRLS;
            END IF;
        END
        $$
        """
    )
    op.execute("GRANT USAGE ON SCHEMA shared TO sim_relay")
    op.execute("GRANT SELECT, UPDATE ON shared.outbox TO sim_relay")


def downgrade() -> None:
    op.execute("REVOKE SELECT, UPDATE ON shared.outbox FROM sim_relay")
    op.execute("REVOKE USAGE ON SCHEMA shared FROM sim_relay")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON shared.outbox")
    op.drop_index(
        "ix_shared_outbox_unpublished", table_name="outbox", schema="shared"
    )
    op.drop_table("processed_events", schema="shared")
    op.drop_table("outbox", schema="shared")
    op.execute("DROP SCHEMA IF EXISTS shared")
