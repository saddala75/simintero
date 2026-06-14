"""Enable RLS tenant isolation policies on all tenant-scoped tables.

Tables without a tenant_id column (processed_events) are deliberately excluded.

Revision ID: 0010
Revises: 0009
Create Date: 2026-06-13
"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

_TENANT_TABLES = [
    "outbox",
    "workflow_instances",
    "workflow_events",
    "clocks",
    "human_signoffs",
    "notification_templates",
    "notification_log",
    "case_criteria",
    "case_suggestions",
]

_POLICY = "tenant_isolation"
_SETTING = "sim.tenant_id"


def upgrade() -> None:
    for table in _TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {_POLICY} ON {table} "
            f"USING (tenant_id = current_setting('{_SETTING}', true))"
        )


def downgrade() -> None:
    for table in reversed(_TENANT_TABLES):
        op.execute(f"DROP POLICY IF EXISTS {_POLICY} ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
