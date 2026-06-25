"""directory — assignable reviewers/investigators roster (RLS, seeded) (B2)"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "directory",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("sub", sa.Text, nullable=False),
        sa.Column("display_name", sa.Text, nullable=False),
        sa.Column("role", sa.Text, nullable=False),
        sa.Column("email", sa.Text, nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "sub", "role", name="uq_directory_tenant_sub_role"),
        sa.CheckConstraint("tenant_id != ''", name="ck_directory_tenant_not_empty"),
    )
    op.create_index("ix_directory_tenant_role", "directory", ["tenant_id", "role"])
    op.execute("ALTER TABLE directory ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE directory FORCE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY tenant_isolation ON directory USING (tenant_id = current_setting('sim.tenant_id', true))")
    op.execute("SELECT set_config('sim.tenant_id', 'tenant-dev', true)")
    op.execute(
        """
        INSERT INTO directory (tenant_id, sub, display_name, role, email) VALUES
          ('tenant-dev', '11111111-1111-1111-1111-111111111111', 'E2E Reviewer',     'reviewer', 'e2e-reviewer@enstellar.local'),
          ('tenant-dev', '22222222-2222-2222-2222-222222222222', 'Medical Director', 'reviewer', 'md-reviewer@enstellar.local'),
          ('tenant-dev', '33333333-3333-3333-3333-333333333333', 'Janet Jones',      'reviewer', 'dr-jones@enstellar.local'),
          ('tenant-dev', '44444444-4444-4444-4444-444444444444', 'Sam Smith',        'reviewer', 'dr-smith@enstellar.local')
        ON CONFLICT (tenant_id, sub, role) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON directory")
    op.drop_table("directory")
