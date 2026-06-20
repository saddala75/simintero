-- V024: give the BYPASSRLS relay role LOGIN so the platform @sim/relay service can
-- connect as it. sim_app is NOT granted membership — only the relay bypasses RLS,
-- preserving the slice-0.1 tenant-isolation guarantee.
-- The role is normally created by the postgres bootstrap (infra/postgres/init/00-databases.sql),
-- but that init script does not run in CI (which applies migrations to a bare DB), so guard-create
-- it here too (idempotent) — mirrors V023's handling of sim_app.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sim_relay') THEN
    CREATE ROLE sim_relay BYPASSRLS;
  END IF;
END $$;

ALTER ROLE sim_relay LOGIN PASSWORD 'devpassword';
GRANT USAGE ON SCHEMA shared TO sim_relay;
GRANT SELECT, UPDATE ON shared.outbox TO sim_relay;
