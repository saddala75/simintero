"""grievance SLA poller: sim_relay grant + breach-flag columns (B3)

The in-process GrievanceSlaPoller scans non-resolved grievances whose due-dates
have passed, across ALL tenants — like SlaPoller (0016) it SET ROLE's to the
BYPASSRLS ``sim_relay`` role on the scan connection, so sim_relay needs explicit
SELECT on ``grievances``. The two breach-flag columns make the stamp idempotent:
a flag is set once on the FRESH breach, so a re-poll never re-escalates.

Revision ID: 0026
Revises: 0025
"""
from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("GRANT SELECT ON grievances TO sim_relay")
    op.add_column("grievances", sa.Column("acknowledgement_breached_at", sa.TIMESTAMP(timezone=True), nullable=True))
    op.add_column("grievances", sa.Column("resolution_breached_at", sa.TIMESTAMP(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("grievances", "resolution_breached_at")
    op.drop_column("grievances", "acknowledgement_breached_at")
    op.execute("REVOKE SELECT ON grievances FROM sim_relay")
