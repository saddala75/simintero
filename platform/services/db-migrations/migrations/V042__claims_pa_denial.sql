-- V042: record PA denial outcome on claims.claim for Claims/EOB handoff
-- Adds three columns that the claims-service internal /pa-denial endpoint writes
-- whenever a DECISION_RECORDED event carries an adverse outcome
-- (denied | partially_denied | adverse_modification).
-- No new table → no RLS checklist needed; claims.claim already has RLS enabled.
ALTER TABLE claims.claim
  ADD COLUMN IF NOT EXISTS pa_decision      TEXT,
  ADD COLUMN IF NOT EXISTS pa_denied_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pa_denial_reason TEXT;
