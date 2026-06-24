-- db/seeds/notification_templates.sql
-- Sample templates for local dev / design partner demo
-- PHI-safe: only case_id, outcome, decided_at in context

INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template)
VALUES
  ('demo-tenant', 'approved',  'portal',
   'Prior Authorization Approved — Case {{ case_id }}',
   'Your prior authorization request (Case {{ case_id }}) has been approved on {{ decided_at }}.'),
  ('demo-tenant', 'denied',    'portal',
   'Determination on your request',
   'Your request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to appeal this determination. To file an appeal, contact your plan within the appeal period stated in your plan documents.'),
  ('demo-tenant', 'approved',  'email',
   'PA Approved: {{ case_id }}',
   'Authorization approved. Reference: {{ case_id }}. Date: {{ decided_at }}.'),
  ('demo-tenant', 'partially_denied', 'portal',
   'Determination on your request',
   'Your request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to appeal this determination. To file an appeal, contact your plan within the appeal period stated in your plan documents.'),
  ('demo-tenant', 'adverse_modification', 'portal',
   'Determination on your request',
   'Your request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to appeal this determination. To file an appeal, contact your plan within the appeal period stated in your plan documents.')
ON CONFLICT (tenant_id, event_type, channel, version) DO NOTHING;
