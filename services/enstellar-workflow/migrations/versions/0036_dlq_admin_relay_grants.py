"""Grant sim_relay SELECT on consumer_dlq tables for DLQ admin API (P2.8).

The DLQ admin endpoints use SET LOCAL ROLE "sim_relay" (BYPASSRLS) to read
across all tenants. shared.outbox already has SELECT, UPDATE grants to sim_relay
(migration 0011). The consumer_dlq and consumer_dlq_archive tables were created
in migrations 0028 and 0032 without explicit sim_relay grants — add them here.
"""
from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("GRANT SELECT ON shared.consumer_dlq TO sim_relay")
    op.execute("GRANT SELECT ON shared.consumer_dlq_archive TO sim_relay")


def downgrade() -> None:
    op.execute("REVOKE SELECT ON shared.consumer_dlq_archive FROM sim_relay")
    op.execute("REVOKE SELECT ON shared.consumer_dlq FROM sim_relay")
