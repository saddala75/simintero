"""LOB-specific notices: notification_templates.lob + notification_log.lob + notifications config (P4)"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notification_templates", sa.Column("lob", sa.Text(), nullable=True))
    op.drop_constraint(
        "uq_notification_templates_tenant_event_channel_version",
        "notification_templates",
        type_="unique",
    )
    # COALESCE so NULL (generic) collapses to '' → exactly one generic row per key.
    op.execute(
        "CREATE UNIQUE INDEX ux_notification_templates_lob "
        "ON notification_templates (tenant_id, COALESCE(lob,''), event_type, channel, version)"
    )
    op.add_column("notification_log", sa.Column("lob", sa.Text(), nullable=True))
    # Seed demo-tenant notifications config (RLS-safe: set the tenant GUC).
    # commercial=180 / ma=65 are DEMONSTRATIVE defaults — NOT legal advice.
    op.execute("SELECT set_config('sim.tenant_id', 'demo-tenant', true)")
    op.execute(
        """
        INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES
          ('demo-tenant', 'commercial', 'notifications', '{"appeal_deadline_days": 180}'::jsonb),
          ('demo-tenant', 'ma',         'notifications', '{"appeal_deadline_days": 65}'::jsonb)
        ON CONFLICT (tenant_id, lob, domain) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM workflow_config WHERE domain='notifications'")
    op.drop_column("notification_log", "lob")
    op.execute("DROP INDEX IF EXISTS ux_notification_templates_lob")
    op.create_unique_constraint(
        "uq_notification_templates_tenant_event_channel_version",
        "notification_templates",
        ["tenant_id", "event_type", "channel", "version"],
    )
    op.drop_column("notification_templates", "lob")
