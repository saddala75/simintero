"""notification_log.delivered_at + notification_templates.to_address (Gap 2)"""
from alembic import op
import sqlalchemy as sa

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notification_log",
        sa.Column("delivered_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        "notification_templates",
        sa.Column("to_address", sa.Text, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notification_templates", "to_address")
    op.drop_column("notification_log", "delivered_at")
