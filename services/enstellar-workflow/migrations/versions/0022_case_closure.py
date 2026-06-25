"""case closure columns (P3)

Adds explicit closure surface to workflow_instances:
  * disposition — the settled outcome the case closed on (e.g. "denied")
  * closed_at   — when the case was formally closed
  * closed_by   — the actor (user id or "system") that closed it

Revision ID: 0022
Revises: 0021
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workflow_instances", sa.Column("disposition", sa.Text(), nullable=True))
    op.add_column(
        "workflow_instances",
        sa.Column("closed_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column("workflow_instances", sa.Column("closed_by", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("workflow_instances", "closed_by")
    op.drop_column("workflow_instances", "closed_at")
    op.drop_column("workflow_instances", "disposition")
