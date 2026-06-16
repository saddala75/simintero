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

-- ── sim_relay (BYPASSRLS outbox relay role) must be created HERE, as superuser. ──
-- Alembic migration services/enstellar-workflow/migrations/versions/0011_shared_outbox.py
-- runs `CREATE ROLE sim_relay BYPASSRLS`, but it runs as the `workflow` login role.
-- In Postgres, creating a BYPASSRLS role requires the creator to itself have both
-- CREATEROLE and BYPASSRLS — which `workflow` (a deliberately non-superuser, RLS-
-- enforced role) does not, and must not (granting it BYPASSRLS would break the
-- FORCE ROW LEVEL SECURITY guarantee above). Without this, the workflow-engine
-- container crashes on first migrate ("permission denied to create role").
-- The migration's CREATE is guarded by `IF NOT EXISTS (... rolname='sim_relay')`,
-- so pre-creating the role here makes that step a no-op while its subsequent
-- GRANTs (which `workflow` CAN issue on its own schema/table) still run.
CREATE ROLE sim_relay BYPASSRLS;
