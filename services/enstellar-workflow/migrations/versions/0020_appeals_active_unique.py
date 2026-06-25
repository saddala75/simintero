"""Partial unique index — at most one under_review appeal per (case_id, tenant_id).

Prevents the concurrent double-file race: two requests that both pass the
case-eligibility check can no longer both INSERT successfully.  The service
layer catches the resulting UniqueViolationError and raises
AppealNotAllowedError (→ HTTP 409).

Revision ID: 0020
Revises: 0019
"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_appeals_active",
        "appeals",
        ["case_id", "tenant_id"],
        unique=True,
        postgresql_where=sa.text("status = 'under_review'"),
    )


def downgrade() -> None:
    op.drop_index("uq_appeals_active", table_name="appeals")
