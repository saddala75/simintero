"""notification_templates and notification_log tables

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_templates",
        sa.Column(
            "template_id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("event_type", sa.Text, nullable=False),
        sa.Column("channel", sa.Text, nullable=False),
        sa.Column("subject_template", sa.Text, nullable=False),
        sa.Column("body_template", sa.Text, nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default=sa.text("1")),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("TRUE")),
        sa.CheckConstraint("tenant_id != ''", name="ck_notification_templates_tenant_id_not_empty"),
        sa.UniqueConstraint(
            "tenant_id", "event_type", "channel", "version",
            name="uq_notification_templates_tenant_event_channel_version",
        ),
    )

    op.create_table(
        "notification_log",
        sa.Column(
            "notification_id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("case_id", UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.Text, nullable=False),
        sa.Column("channel", sa.Text, nullable=False),
        sa.Column(
            "template_id",
            UUID(as_uuid=True),
            sa.ForeignKey("notification_templates.template_id"),
            nullable=True,
        ),
        sa.Column("rendered_subject", sa.Text, nullable=False),
        sa.Column(
            "sent_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("status", sa.Text, nullable=False, server_default=sa.text("'sent'")),
        sa.CheckConstraint("tenant_id != ''", name="ck_notification_log_tenant_id_not_empty"),
    )


def downgrade() -> None:
    op.drop_table("notification_log")
    op.drop_table("notification_templates")
