"""SLA: clocks.warned_at + domain='sla' config seed

Revision ID: 0015
Revises: 0014
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "clocks",
        sa.Column("warned_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    # workflow_config already has FORCE RLS (0014) → set the GUC so the policy's
    # WITH CHECK accepts the demo-tenant seed (all rows below are demo-tenant).
    op.execute("SET LOCAL sim.tenant_id = 'demo-tenant'")
    op.execute(
        """
        INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES
          ('demo-tenant', 'commercial', 'sla',
           '{"warning_threshold_pct": 75, "escalation_queue": "md_review"}'::jsonb),
          ('demo-tenant', 'ma', 'sla',
           '{"warning_threshold_pct": 80, "escalation_queue": "md_review"}'::jsonb)
        ON CONFLICT (tenant_id, lob, domain) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM workflow_config WHERE domain='sla' AND tenant_id='demo-tenant'")
    op.drop_column("clocks", "warned_at")
