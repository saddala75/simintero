"""SLA: grant the BYPASSRLS sim_relay role SELECT on the SlaPoller scan tables

The in-process SlaPoller scans RUNNING clocks joined to their workflow_instances
across ALL tenants. Like OutboxRelay (shared.outbox, 0011) and RevitalPoller
(revital_inflight, 0012), it SET ROLE's to the BYPASSRLS ``sim_relay`` role on
the scan connection. BYPASSRLS removes the RLS predicate but NOT table-level
GRANTs, so sim_relay needs explicit SELECT on the scanned tables or the scan
fails with "permission denied for table clocks". (The per-clock writes run in a
separate tenant_transaction, so SELECT is sufficient here.)

Revision ID: 0016
Revises: 0015
"""
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("GRANT SELECT ON clocks TO sim_relay")
    op.execute("GRANT SELECT ON workflow_instances TO sim_relay")


def downgrade() -> None:
    op.execute("REVOKE SELECT ON workflow_instances FROM sim_relay")
    op.execute("REVOKE SELECT ON clocks FROM sim_relay")
