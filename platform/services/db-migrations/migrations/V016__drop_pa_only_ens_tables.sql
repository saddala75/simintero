-- C3b: retire the TS Enstellar twin's PA-only tables (resolves N-001).
-- ens.case is KEPT (shared platform case table used by claims/automation;
-- claims.claim / claims.appeal FK -> ens.case remain valid).
-- Drop the event-sourcing journal + the PA-only child tables.
DROP TABLE IF EXISTS ens.case_event    CASCADE;
DROP TABLE IF EXISTS ens.determination CASCADE;
DROP TABLE IF EXISTS ens.rfi           CASCADE;
DROP TABLE IF EXISTS ens.service_line  CASCADE;
DROP TABLE IF EXISTS ens.case_pin      CASCADE;
DROP TABLE IF EXISTS ens.task          CASCADE;
DROP TABLE IF EXISTS ens.communication CASCADE;

-- The ens.case_event append-only trigger function is now orphaned (its table is gone).
DROP FUNCTION IF EXISTS ens.prevent_case_event_mutation() CASCADE;
