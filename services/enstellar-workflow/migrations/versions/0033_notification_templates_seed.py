"""notification_templates_seed — wire seed file into migrations (P2.1)"""
from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # RLS requires sim.tenant_id to be set before the INSERT; SET LOCAL is
    # transaction-scoped so it auto-reverts at COMMIT and never leaks to the pool.
    op.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
    op.execute("""
        INSERT INTO notification_templates (tenant_id, lob, event_type, channel, subject_template, body_template)
        VALUES
          ('tenant-dev', NULL, 'approved',  'portal',
           'Prior Authorization Approved — Case {{ case_id }}',
           'Your prior authorization request (Case {{ case_id }}) has been approved on {{ decided_at }}.'),
          ('tenant-dev', NULL, 'denied',    'portal',
           'Determination on your request',
           'Your request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to appeal this determination. To file an appeal, contact your plan within {{ appeal_deadline_days }} days.'),
          ('tenant-dev', 'ma', 'denied',    'portal',
           'Medicare Advantage — Determination on your request',
           'Your Medicare Advantage request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to request a reconsideration. You must file your appeal within {{ appeal_deadline_days }} days of this notice.'),
          ('tenant-dev', NULL, 'approved',  'email',
           'PA Approved: {{ case_id }}',
           'Authorization approved. Reference: {{ case_id }}. Date: {{ decided_at }}.'),
          ('tenant-dev', NULL, 'partially_denied', 'portal',
           'Determination on your request',
           'Your request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to appeal this determination. To file an appeal, contact your plan within {{ appeal_deadline_days }} days.'),
          ('tenant-dev', NULL, 'adverse_modification', 'portal',
           'Determination on your request',
           'Your request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to appeal this determination. To file an appeal, contact your plan within {{ appeal_deadline_days }} days.'),
          ('tenant-dev', NULL, 'appeal_filed', 'portal',
           'Appeal update',
           'Your appeal (level {{ level }}) has been received and is under review.{% if reason %} Reason on file: {{ reason }}.{% endif %}'),
          ('tenant-dev', NULL, 'appeal_overturned', 'portal',
           'Appeal update',
           'Your appeal (level {{ level }}) was overturned — the prior determination is reversed.'),
          ('tenant-dev', NULL, 'appeal_upheld', 'portal',
           'Appeal update',
           'Your appeal (level {{ level }}) was upheld.'),
          ('tenant-dev', NULL, 'grievance_filed', 'portal',
           'Grievance received',
           'We received your grievance and will respond within {{ resolution_days }} days.'),
          ('tenant-dev', NULL, 'grievance_acknowledged', 'portal',
           'Grievance acknowledged',
           'Your grievance has been acknowledged and is being reviewed.'),
          ('tenant-dev', NULL, 'grievance_resolved', 'portal',
           'Grievance resolved',
           'Your grievance has been resolved.'),
          ('tenant-dev', NULL, 'grievance_acknowledgement_overdue', 'internal',
           'Grievance acknowledgement overdue',
           'Internal alert: grievance {{ grievance_id }} has passed its acknowledgement deadline.'),
          ('tenant-dev', NULL, 'grievance_resolution_overdue', 'internal',
           'Grievance resolution overdue',
           'Internal alert: grievance {{ grievance_id }} has passed its resolution deadline.')
        ON CONFLICT (tenant_id, COALESCE(lob,''), event_type, channel, version) DO NOTHING
    """)
    # PHI-permitted member letter template (channel='mail', member_phi=TRUE)
    op.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
    op.execute("""
        INSERT INTO notification_templates (tenant_id, lob, event_type, channel, subject_template, body_template, member_phi)
        VALUES
          ('tenant-dev', NULL, 'denied', 'mail',
           'Notice of Adverse Determination',
           'Dear {{ member_name }} (DOB {{ dob }}, Member ID {{ member_id }}): your request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to appeal within {{ appeal_deadline_days }} days.',
           true)
        ON CONFLICT (tenant_id, COALESCE(lob,''), event_type, channel, version) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
    op.execute("DELETE FROM notification_templates WHERE tenant_id = 'tenant-dev'")
