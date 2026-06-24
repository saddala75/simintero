"""appeals — multi-level appeal lifecycle records (RLS-isolated)

Revision ID: 0019
Revises: 0018
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "appeals",
        sa.Column("appeal_id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("case_id", UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("level", sa.Integer, nullable=False, server_default=sa.text("1")),
        sa.Column("appealed_ref", sa.Text, nullable=False),
        sa.Column("filed_by", sa.Text, nullable=False),
        sa.Column("filed_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("status", sa.Text, nullable=False,
                  server_default=sa.text("'under_review'")),
        sa.Column("outcome_reason", sa.Text, nullable=True),
        sa.Column("reviewer_actor", sa.Text, nullable=True),
        sa.Column("decided_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("tenant_id != ''", name="ck_appeals_tenant_not_empty"),
    )
    op.create_index("ix_appeals_case", "appeals", ["tenant_id", "case_id", "level"])
    # RLS tenant isolation (mirror 0014_workflow_config.py) — no seed, so no SET LOCAL needed.
    op.execute("ALTER TABLE appeals ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE appeals FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON appeals "
        "USING (tenant_id = current_setting('sim.tenant_id', true))"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON appeals")
    op.drop_table("appeals")
