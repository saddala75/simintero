"""revital_inflight AI provenance columns (model_binding + prompt)

Revision ID: 0018
Revises: 0017
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for col in ("model_binding_ref", "model_binding_version", "prompt_ref", "prompt_version"):
        op.add_column("revital_inflight", sa.Column(col, sa.Text, nullable=True))


def downgrade() -> None:
    for col in ("prompt_version", "prompt_ref", "model_binding_version", "model_binding_ref"):
        op.drop_column("revital_inflight", col)
