CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Schemas needed by migrations — the full migrations run separately via db-migrations service.
-- This seed is only for the extension required by gen_random_uuid().
