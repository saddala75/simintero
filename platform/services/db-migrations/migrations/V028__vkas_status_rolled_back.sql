-- V028__vkas_status_rolled_back.sql
-- Slice 1.3: align the DB status CHECK with the app (lifecycle.ts) + generated types,
-- which use 'rolled_back'. Keep 'superseded' (the demotion trail + immutability trigger reference it).
ALTER TABLE vkas.artifact DROP CONSTRAINT IF EXISTS artifact_status_check;
ALTER TABLE vkas.artifact ADD CONSTRAINT artifact_status_check
  CHECK (status IN ('draft','in_review','approved','active','retired','superseded','rolled_back'));
