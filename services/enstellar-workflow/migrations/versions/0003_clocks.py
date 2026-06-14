"""Create clocks table for SLA / clock management.

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clocks",
        sa.Column(
            "clock_id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("case_id", UUID(as_uuid=True), nullable=False),
        sa.Column("clock_type", sa.Text, nullable=False),
        sa.Column("state", sa.Text, nullable=False, server_default="running"),
        sa.Column("urgency", sa.Text, nullable=False),
        sa.Column("duration_calendar_days", sa.Integer, nullable=False),
        sa.Column(
            "started_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deadline", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("paused_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "total_paused_seconds",
            sa.Float,
            nullable=False,
            server_default="0",
        ),
        sa.Column("breached_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint("tenant_id != ''", name="ck_clocks_tenant_id_not_empty"),
        sa.UniqueConstraint("case_id", "clock_type", name="uq_clocks_case_clock_type"),
    )
    op.create_index(
        "ix_clocks_deadline",
        "clocks",
        ["deadline"],
        postgresql_where=sa.text("state = 'running'"),
    )


def downgrade() -> None:
    op.drop_index("ix_clocks_deadline")
    op.drop_table("clocks")
