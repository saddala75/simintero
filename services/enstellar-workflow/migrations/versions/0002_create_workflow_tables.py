"""Create workflow_instances and workflow_events tables.

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workflow_instances",
        sa.Column("case_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("correlation_id", sa.Text, nullable=False),
        sa.Column("lob", sa.Text, nullable=False),
        sa.Column("program", sa.Text, nullable=True),
        sa.Column("status", sa.Text, nullable=False, server_default="intake"),
        sa.Column("urgency", sa.Text, nullable=False, server_default="standard"),
        sa.Column("workflow_def_version", sa.Text, nullable=False, server_default="v1"),
        sa.Column("case_json", JSONB, nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("correlation_id", name="uq_workflow_instances_correlation_id"),
        sa.CheckConstraint("tenant_id != ''", name="ck_workflow_instances_tenant_id_not_empty"),
    )
    op.create_index("ix_workflow_instances_tenant_id", "workflow_instances", ["tenant_id"])
    op.create_index("ix_workflow_instances_status", "workflow_instances", ["status"])

    op.create_table(
        "workflow_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "case_id",
            UUID(as_uuid=True),
            sa.ForeignKey("workflow_instances.case_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("event_type", sa.Text, nullable=False),
        sa.Column("from_state", sa.Text, nullable=True),
        sa.Column("to_state", sa.Text, nullable=True),
        sa.Column("actor_id", sa.Text, nullable=False),
        sa.Column("actor_type", sa.Text, nullable=False),
        sa.Column("correlation_id", sa.Text, nullable=False),
        sa.Column("payload", JSONB, nullable=False, server_default=sa.text("'{}'")),
        sa.Column(
            "occurred_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_workflow_events_case_id", "workflow_events", ["case_id"])
    op.create_index("ix_workflow_events_tenant_id", "workflow_events", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_workflow_events_tenant_id")
    op.drop_index("ix_workflow_events_case_id")
    op.drop_table("workflow_events")
    op.drop_index("ix_workflow_instances_status")
    op.drop_index("ix_workflow_instances_tenant_id")
    op.drop_table("workflow_instances")
