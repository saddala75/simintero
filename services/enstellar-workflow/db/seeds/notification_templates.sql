-- db/seeds/notification_templates.sql
-- Sample templates for local dev / design partner demo
-- PHI-safe: only case_id, outcome, decided_at in context

INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template)
VALUES
  ('demo-tenant', 'approved',  'portal',
   'Prior Authorization Approved — Case {{ case_id }}',
   'Your prior authorization request (Case {{ case_id }}) has been approved on {{ decided_at }}.'),
  ('demo-tenant', 'denied',    'portal',
   'Prior Authorization Determination — Case {{ case_id }}',
   'Your prior authorization request (Case {{ case_id }}) received a determination of {{ outcome }} on {{ decided_at }}. Please contact your provider for next steps.'),
  ('demo-tenant', 'approved',  'email',
   'PA Approved: {{ case_id }}',
   'Authorization approved. Reference: {{ case_id }}. Date: {{ decided_at }}.')
ON CONFLICT (tenant_id, event_type, channel, version) DO NOTHING;
