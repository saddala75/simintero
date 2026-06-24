"""notification_log unique per (tenant, case, event_type, channel) — one notice per determination

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-24
"""
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_notification_log_tenant_case_event_channel",
        "notification_log",
        ["tenant_id", "case_id", "event_type", "channel"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_notification_log_tenant_case_event_channel", "notification_log", type_="unique"
    )
