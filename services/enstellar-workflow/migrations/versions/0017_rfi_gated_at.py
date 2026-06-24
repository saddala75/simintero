"""Slice S4 completeness gating: workflow_instances.rfi_gated_at

Records when a case was pended for an auto-RFI seeded with Digicore gap
requirement_ids. Used to bound the auto-RFI loop to at most once per case:
once rfi_gated_at is set, a still-incomplete re-gate routes to clinical_review
instead of dispatching a second RFI.

Revision ID: 0017
Revises: 0016
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workflow_instances",
        sa.Column("rfi_gated_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workflow_instances", "rfi_gated_at")
