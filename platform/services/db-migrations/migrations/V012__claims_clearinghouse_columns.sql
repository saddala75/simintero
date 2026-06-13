-- Clearinghouse ACK tracking on claims
ALTER TABLE claims.claim
  ADD COLUMN IF NOT EXISTS ack_status     TEXT,
  ADD COLUMN IF NOT EXISTS control_number TEXT;
