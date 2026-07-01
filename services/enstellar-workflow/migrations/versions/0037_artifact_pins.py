"""Add artifact_pins column to workflow_instances for pin-based appeal replay (P2.7).

Stores the artifact-version URNs returned by Digicore at original determination
time. The replay endpoint (GET /cases/{case_id}/replay-evaluation) reads these
pins and passes them back to Digicore so PinResolver bypasses VKAS and evaluates
against the exact original policy version.

No RLS checklist needed: workflow_instances already has RLS; this adds a column,
not a table.

Revision ID: 0037
Revises: 0036
"""
from alembic import op
import sqlalchemy as sa

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workflow_instances",
        sa.Column(
            "artifact_pins",
            sa.ARRAY(sa.Text),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("workflow_instances", "artifact_pins")
