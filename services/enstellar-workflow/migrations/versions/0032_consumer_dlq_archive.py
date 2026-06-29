"""consumer_dlq_archive — archive table for long-term storage of purged DLQ entries (Task 2E-1)"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "consumer_dlq_archive",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.Text, nullable=False),
        sa.Column("consumer_group", sa.Text, nullable=False),
        sa.Column("topic", sa.Text, nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column(
            "failed_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("replayed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "archived_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="shared",
    )


def downgrade() -> None:
    op.drop_table("consumer_dlq_archive", schema="shared")
