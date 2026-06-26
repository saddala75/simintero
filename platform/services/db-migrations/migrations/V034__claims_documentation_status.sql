-- V034: Add documentation tracking columns to claims.claim for CMS-0053-F attachment workflow
ALTER TABLE claims.claim
  ADD COLUMN documentation_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (documentation_status IN ('not_requested', 'requested', 'received', 'rejected')),
  ADD COLUMN rfai_doc_id TEXT;
