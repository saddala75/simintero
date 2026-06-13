-- Control-plane: impersonation session persistence (no RLS — ctrl schema)
CREATE TABLE IF NOT EXISTS ctrl.impersonation_session (
  session_id   TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES ctrl.tenant(tenant_id),
  created_by   TEXT NOT NULL DEFAULT 'system',
  expires_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ctrl_impersonation_session_active_idx
  ON ctrl.impersonation_session (tenant_id, expires_at)
  WHERE ended_at IS NULL;
