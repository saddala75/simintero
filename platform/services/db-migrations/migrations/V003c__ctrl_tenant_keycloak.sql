-- Keycloak tenant group reference on ctrl.tenant
ALTER TABLE ctrl.tenant
  ADD COLUMN IF NOT EXISTS keycloak_group_id TEXT;
