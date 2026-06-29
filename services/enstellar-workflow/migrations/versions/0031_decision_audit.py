"""decision_audit_log — clinical decision audit trail table with RLS (Task 2A-1)"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS ens")
    op.create_table(
        "decision_audit_log",
        sa.Column("audit_id", pg.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.Text(), nullable=False),
        sa.Column("case_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("decided_by", sa.Text(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("rule_ids", pg.JSONB(), nullable=False, server_default="[]"),
        sa.Column("ai_advisory_used", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("evidence_refs", pg.JSONB(), nullable=False, server_default="[]"),
        sa.Column("rationale", sa.Text(), nullable=False, server_default=""),
        schema="ens",
    )
    op.execute("ALTER TABLE ens.decision_audit_log ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE ens.decision_audit_log FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON ens.decision_audit_log
        USING (tenant_id = current_setting('sim.tenant_id', true))
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_decision_audit_log_case ON ens.decision_audit_log (tenant_id, case_id)"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON ens.decision_audit_log")
    op.drop_table("decision_audit_log", schema="ens")
