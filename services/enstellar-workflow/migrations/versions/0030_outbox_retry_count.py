"""Add retry_count, dlq_at, dlq_reason columns to shared.outbox.

Enables the OutboxRelay to:
- Track per-row failure counts (retry_count)
- Move poison messages to a dead-letter state (dlq_at, dlq_reason)
  after MAX_RELAY_RETRIES consecutive failures instead of retrying forever.
"""
from alembic import op
import sqlalchemy as sa

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "outbox",
        sa.Column(
            "retry_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        schema="shared",
    )
    op.add_column(
        "outbox",
        sa.Column(
            "dlq_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema="shared",
    )
    op.add_column(
        "outbox",
        sa.Column(
            "dlq_reason",
            sa.Text(),
            nullable=True,
        ),
        schema="shared",
    )
    # CONCURRENTLY cannot run inside a transaction; autocommit_block commits
    # the add_column DDL above first, then executes the index in autocommit mode.
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_shared_outbox_relay_pending
            ON shared.outbox (event_id ASC)
            WHERE published_at IS NULL AND dlq_at IS NULL
            """
        )


def downgrade() -> None:
    op.execute(
        "DROP INDEX IF EXISTS shared.ix_shared_outbox_relay_pending"
    )
    op.drop_column("outbox", "dlq_reason", schema="shared")
    op.drop_column("outbox", "dlq_at", schema="shared")
    op.drop_column("outbox", "retry_count", schema="shared")
