"""grievances — member complaint lifecycle (RLS-isolated, decoupled from cases) (P5)"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "grievances",
        sa.Column("grievance_id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("member_ref", sa.Text, nullable=False),
        sa.Column("case_id", UUID(as_uuid=True), nullable=True),
        sa.Column("category", sa.Text, nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("urgency", sa.Text, nullable=False, server_default=sa.text("'standard'")),
        sa.Column("lob", sa.Text, nullable=True),
        sa.Column("status", sa.Text, nullable=False, server_default=sa.text("'filed'")),
        sa.Column("filed_by", sa.Text, nullable=False),
        sa.Column("filed_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("acknowledged_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("acknowledged_by", sa.Text, nullable=True),
        sa.Column("assigned_to", sa.Text, nullable=True),
        sa.Column("assigned_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("assigned_by", sa.Text, nullable=True),
        sa.Column("resolved_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("resolution", sa.Text, nullable=True),
        sa.Column("resolved_by", sa.Text, nullable=True),
        sa.Column("acknowledgement_due_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("resolution_due_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("tenant_id != ''", name="ck_grievances_tenant_not_empty"),
    )
    op.create_index("ix_grievances_member", "grievances", ["tenant_id", "member_ref"])
    op.create_index("ix_grievances_assigned", "grievances", ["tenant_id", "assigned_to", "status"])
    op.execute("ALTER TABLE grievances ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE grievances FORCE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY tenant_isolation ON grievances USING (tenant_id = current_setting('sim.tenant_id', true))")
    op.execute("SELECT set_config('sim.tenant_id', 'demo-tenant', true)")
    op.execute(
        """
        INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES
          ('demo-tenant', 'commercial', 'grievance', '{"standard": {"acknowledgement_days": 2, "resolution_days": 30}, "expedited": {"acknowledgement_days": 1, "resolution_days": 7}}'::jsonb),
          ('demo-tenant', 'ma',         'grievance', '{"standard": {"acknowledgement_days": 2, "resolution_days": 30}, "expedited": {"acknowledgement_days": 1, "resolution_days": 7}}'::jsonb)
        ON CONFLICT (tenant_id, lob, domain) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM workflow_config WHERE domain='grievance'")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON grievances")
    op.drop_table("grievances")
