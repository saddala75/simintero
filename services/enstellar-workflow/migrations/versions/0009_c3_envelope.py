"""Add C-3 envelope columns to outbox: schema_ref, causation_id, trace_ref.

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("outbox", sa.Column("schema_ref", sa.Text, nullable=True))
    op.add_column("outbox", sa.Column("causation_id", sa.Text, nullable=True))
    op.add_column("outbox", sa.Column("trace_ref", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("outbox", "trace_ref")
    op.drop_column("outbox", "causation_id")
    op.drop_column("outbox", "schema_ref")
