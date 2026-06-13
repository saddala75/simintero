CREATE TABLE IF NOT EXISTS ctrl.operation (
  operation_id  TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('provision','suspend','archive','migrate')),
  tenant_id     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed')),
  result        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ctrl schema has no RLS (control-plane DB, not a cell DB)
