"""Add human_signoffs table and update workflow_instances.

Adds:
  - human_signoffs table (one active sign-off per case per tenant)
  - workflow_instances.assignee_queue TEXT DEFAULT 'standard'
  - workflow_instances.human_signoff_id UUID FK → human_signoffs.signoff_id

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-06
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "human_signoffs",
        sa.Column(
            "signoff_id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("case_id", UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("actor_id", sa.Text, nullable=False),
        sa.Column("actor_type", sa.Text, nullable=False),
        sa.Column(
            "signed_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("outcome_context", sa.Text, nullable=True),
        sa.CheckConstraint("tenant_id != ''", name="ck_human_signoffs_tenant_id_not_empty"),
        sa.UniqueConstraint("case_id", "tenant_id", name="uq_human_signoffs_case_tenant"),
    )
    op.create_index("ix_human_signoffs_case_id", "human_signoffs", ["case_id"])
    op.create_index("ix_human_signoffs_tenant_id", "human_signoffs", ["tenant_id"])

    op.add_column(
        "workflow_instances",
        sa.Column("assignee_queue", sa.Text, nullable=False, server_default=sa.text("'standard'")),
    )
    op.add_column(
        "workflow_instances",
        sa.Column(
            "human_signoff_id",
            UUID(as_uuid=True),
            sa.ForeignKey("human_signoffs.signoff_id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("workflow_instances", "human_signoff_id")
    op.drop_column("workflow_instances", "assignee_queue")
    op.drop_index("ix_human_signoffs_tenant_id")
    op.drop_index("ix_human_signoffs_case_id")
    op.drop_table("human_signoffs")
