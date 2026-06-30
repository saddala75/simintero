"""Track AI bypass on case row for NCQA AI governance (P2.6).

Adds revital_bypassed BOOLEAN NOT NULL DEFAULT FALSE to workflow_instances.
Set to TRUE by _emit_failed_event when Revital is unavailable and the case
proceeds without AI input.

Revision ID: 0035
Revises: 0034
"""
from alembic import op
import sqlalchemy as sa

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workflow_instances",
        sa.Column(
            "revital_bypassed",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("FALSE"),
        ),
    )


def downgrade() -> None:
    op.drop_column("workflow_instances", "revital_bypassed")
