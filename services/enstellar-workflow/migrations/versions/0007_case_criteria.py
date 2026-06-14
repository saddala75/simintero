"""case_criteria table

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "case_criteria",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "case_id",
            UUID(as_uuid=True),
            sa.ForeignKey("workflow_instances.case_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("criterion_id", sa.Text, nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column(
            "status",
            sa.Text,
            nullable=False,
            server_default=sa.text("'unknown'"),
        ),
        sa.Column("evidence", JSONB, nullable=True),
        sa.Column(
            "citations",
            JSONB,
            nullable=True,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("tenant_id != ''", name="ck_case_criteria_tenant_id_not_empty"),
        sa.CheckConstraint(
            "status IN ('met', 'gap', 'unknown')",
            name="ck_case_criteria_status_valid",
        ),
    )
    op.create_index(
        "ix_case_criteria_case_tenant",
        "case_criteria",
        ["case_id", "tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_case_criteria_case_tenant", table_name="case_criteria")
    op.drop_table("case_criteria")
