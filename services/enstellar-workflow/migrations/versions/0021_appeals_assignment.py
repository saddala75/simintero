"""appeals assignment columns (P2)

Adds an explicit reviewer-assignment surface to the appeals table:
  * assigned_to  — the reviewer the appeal is assigned to
  * assigned_at  — when the assignment was stamped
  * assigned_by  — the assigner (coordinator) who made the assignment

Revision ID: 0021
Revises: 0020
"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("appeals", sa.Column("assigned_to", sa.Text(), nullable=True))
    op.add_column(
        "appeals", sa.Column("assigned_at", sa.TIMESTAMP(timezone=True), nullable=True)
    )
    op.add_column("appeals", sa.Column("assigned_by", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("appeals", "assigned_by")
    op.drop_column("appeals", "assigned_at")
    op.drop_column("appeals", "assigned_to")
