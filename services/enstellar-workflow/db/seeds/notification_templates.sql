-- db/seeds/notification_templates.sql
-- Sample templates for local dev / design partner demo
-- PHI-safe: only case_id, outcome, decided_at, lob, appeal_deadline_days in context.
-- `lob` NULL = the generic fallback template; a non-NULL lob = an LOB-specific
-- template, preferred over the generic when the case's lob matches (P4).
-- appeal_deadline_days is resolved per-LOB from workflow_config (commercial 180 / ma 65).

INSERT INTO notification_templates (tenant_id, lob, event_type, channel, subject_template, body_template)
VALUES
  ('tenant-dev', NULL, 'approved',  'portal',
   'Prior Authorization Approved — Case {{ case_id }}',
   'Your prior authorization request (Case {{ case_id }}) has been approved on {{ decided_at }}.'),
  ('tenant-dev', NULL, 'denied',    'portal',
   'Determination on your request',
   'Your request received a determination of {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} You have the right to appeal this determination. To file an appeal, contact your plan within {{ appeal_deadline_days }} days.'),
  -- MA-specific denial (Medicare Advantage) — preferred over the generic for ma cases.
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
  -- Grievances (P5) — member complaint lifecycle, parallel to cases.
  ('tenant-dev', NULL, 'grievance_filed', 'portal',
   'Grievance received',
   'We received your grievance and will respond within {{ resolution_days }} days.'),
  ('tenant-dev', NULL, 'grievance_acknowledged', 'portal',
   'Grievance acknowledged',
   'Your grievance has been acknowledged and is being reviewed.'),
  ('tenant-dev', NULL, 'grievance_resolved', 'portal',
   'Grievance resolved',
   'Your grievance has been resolved.')
ON CONFLICT (tenant_id, COALESCE(lob,''), event_type, channel, version) DO NOTHING;
