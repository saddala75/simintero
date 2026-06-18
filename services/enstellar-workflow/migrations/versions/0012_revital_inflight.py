"""revital_inflight: tracks submitted Revital analyses for the poll-based bridge.

Revision ID: 0012
Revises: 0011
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "revital_inflight",
        sa.Column("analysis_id", sa.Text, primary_key=True),
        sa.Column("case_id", UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("correlation_id", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="processing"),
        sa.Column(
            "submitted_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_revital_inflight_processing",
        "revital_inflight",
        ["analysis_id"],
        postgresql_where=sa.text("status = 'processing'"),
    )
    # RLS tenant isolation (mirror 0010).
    op.execute("ALTER TABLE revital_inflight ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE revital_inflight FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON revital_inflight "
        "USING (tenant_id = current_setting('sim.tenant_id', true))"
    )
    # The poller scans every tenant's processing rows via the BYPASSRLS sim_relay
    # role (created in 0011), exactly like OutboxRelay. Grant it access.
    op.execute("GRANT SELECT, UPDATE ON revital_inflight TO sim_relay")


def downgrade() -> None:
    op.execute("REVOKE SELECT, UPDATE ON revital_inflight FROM sim_relay")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON revital_inflight")
    op.drop_index("ix_revital_inflight_processing", table_name="revital_inflight")
    op.drop_table("revital_inflight")
