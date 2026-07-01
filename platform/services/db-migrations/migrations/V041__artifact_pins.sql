-- V041: add artifact_pins column to workflow_instances for pin-based appeal replay
-- Stores the artifact-version URNs returned by Digicore at original determination
-- time. On appeal, the replay endpoint passes these pins back to Digicore so
-- PinResolver bypasses VKAS and evaluates against the exact original policy version.
-- No RLS checklist needed: workflow_instances already has RLS; this is a new column,
-- not a new table.
ALTER TABLE workflow_instances
  ADD COLUMN IF NOT EXISTS artifact_pins TEXT[] NOT NULL DEFAULT '{}';
