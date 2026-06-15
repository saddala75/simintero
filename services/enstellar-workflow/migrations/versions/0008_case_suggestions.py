"""case_suggestions table

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "case_suggestions",
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
        sa.Column("agent_id", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column(
            "confidence",
            sa.Numeric(precision=4, scale=3),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "citations",
            JSONB,
            nullable=True,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "status",
            sa.Text,
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("reviewer_id", sa.Text, nullable=True),
        sa.Column(
            "reviewed_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("tenant_id != ''", name="ck_case_suggestions_tenant_id_not_empty"),
        sa.CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected')",
            name="ck_case_suggestions_status_valid",
        ),
    )
    op.create_index(
        "ix_case_suggestions_case_tenant",
        "case_suggestions",
        ["case_id", "tenant_id"],
    )
    op.create_index(
        "ix_case_suggestions_status",
        "case_suggestions",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("ix_case_suggestions_status", table_name="case_suggestions")
    op.drop_index("ix_case_suggestions_case_tenant", table_name="case_suggestions")
    op.drop_table("case_suggestions")
