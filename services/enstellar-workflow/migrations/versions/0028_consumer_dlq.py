"""consumer_failures + consumer_dlq — retry tracking and dead-letter tables (Gap 1)"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "consumer_failures",
        sa.Column("event_id", sa.Text, nullable=False),
        sa.Column("consumer_group", sa.Text, nullable=False),
        sa.Column("attempt_count", sa.Integer, nullable=False, server_default=sa.text("1")),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column(
            "last_attempted_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("event_id", "consumer_group", name="pk_consumer_failures"),
        schema="shared",
    )

    op.create_table(
        "consumer_dlq",
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
        schema="shared",
    )


def downgrade() -> None:
    op.drop_table("consumer_dlq", schema="shared")
    op.drop_table("consumer_failures", schema="shared")
