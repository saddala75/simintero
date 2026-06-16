-- C4a: unified Postgres init. Runs once on first container init (as POSTGRES_USER=sim).
-- Creates the additional databases + per-service NON-SUPERUSER roles with scoped grants.
-- Per-service users are required for RLS: a superuser bypasses RLS; the tenant tables
-- use FORCE ROW LEVEL SECURITY so even a DB owner is enforced.

-- ── Roles (non-superuser; passwords match the service envs in docker-compose.yml) ──
CREATE ROLE hapi     LOGIN PASSWORD 'hapi_secret';
CREATE ROLE workflow LOGIN PASSWORD 'workflow_secret';
CREATE ROLE keycloak LOGIN PASSWORD 'keycloak_secret';

-- ── Databases owned by their service role ──
CREATE DATABASE hapi     OWNER hapi;
CREATE DATABASE workflow OWNER workflow;
CREATE DATABASE keycloak OWNER keycloak;

GRANT ALL PRIVILEGES ON DATABASE hapi     TO hapi;
GRANT ALL PRIVILEGES ON DATABASE workflow TO workflow;
GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak;

-- ── sim_relay (BYPASSRLS outbox relay role) is NOT created here. ──
-- Alembic migration services/enstellar-workflow/migrations/versions/0011_shared_outbox.py
-- already creates it (guarded, BYPASSRLS) and grants it on shared.outbox in the
-- workflow DB. The migration owns it; adding it here would duplicate that ownership.
