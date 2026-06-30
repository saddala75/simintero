"""grievance_sla_medicaid — seed grievance SLA config for tenant-dev and medicaid LOB (P2.4)"""
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None

_MEDICAID_SLA = (
    '{"standard": {"acknowledgement_days": 3, "resolution_days": 90},'
    ' "expedited": {"acknowledgement_days": 1, "resolution_days": 3}}'
)
_COMMERCIAL_MA_SLA = (
    '{"standard": {"acknowledgement_days": 2, "resolution_days": 30},'
    ' "expedited": {"acknowledgement_days": 1, "resolution_days": 7}}'
)


def upgrade() -> None:
    op.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
    op.execute(f"""
        INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES
          ('tenant-dev', 'commercial', 'grievance', '{_COMMERCIAL_MA_SLA}'::jsonb),
          ('tenant-dev', 'ma',         'grievance', '{_COMMERCIAL_MA_SLA}'::jsonb),
          ('tenant-dev', 'medicaid',   'grievance', '{_MEDICAID_SLA}'::jsonb)
        ON CONFLICT (tenant_id, lob, domain) DO NOTHING
    """)
    op.execute("SET LOCAL sim.tenant_id = 'demo-tenant'")
    op.execute(f"""
        INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES
          ('demo-tenant', 'medicaid', 'grievance', '{_MEDICAID_SLA}'::jsonb)
        ON CONFLICT (tenant_id, lob, domain) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
    op.execute(
        "DELETE FROM workflow_config WHERE domain='grievance' AND tenant_id='tenant-dev'"
    )
    op.execute("SET LOCAL sim.tenant_id = 'demo-tenant'")
    op.execute(
        "DELETE FROM workflow_config WHERE domain='grievance' AND lob='medicaid' AND tenant_id='demo-tenant'"
    )
