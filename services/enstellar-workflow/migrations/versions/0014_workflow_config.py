"""workflow_config — per-(tenant, lob) operational config substrate (clocks now)

Revision ID: 0014
Revises: 0013
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workflow_config",
        sa.Column("config_id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("lob", sa.Text, nullable=False),
        sa.Column("domain", sa.Text, nullable=False),
        sa.Column("config", JSONB, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("TRUE")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("tenant_id != ''", name="ck_workflow_config_tenant_not_empty"),
        sa.UniqueConstraint("tenant_id", "lob", "domain",
                            name="uq_workflow_config_tenant_lob_domain"),
    )
    # Seed two DISTINCT LOB clock profiles for the demo tenant BEFORE enabling RLS
    # (commercial standard-decision = 5 days vs ma = 7 — the differing cell that proves
    #  LOB-aware resolution). Idempotent.
    op.execute(
        """
        INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES
          ('demo-tenant', 'commercial', 'clocks',
           '{"decision": {"standard": 5, "expedited": 3, "concurrent": 1}}'::jsonb),
          ('demo-tenant', 'ma', 'clocks',
           '{"decision": {"standard": 7, "expedited": 3, "concurrent": 1}}'::jsonb)
        ON CONFLICT (tenant_id, lob, domain) DO NOTHING
        """
    )
    # RLS tenant isolation (mirror 0010_rls_policies.py) — AFTER the seed
    op.execute("ALTER TABLE workflow_config ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE workflow_config FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON workflow_config "
        "USING (tenant_id = current_setting('sim.tenant_id', true))"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON workflow_config")
    op.drop_table("workflow_config")
