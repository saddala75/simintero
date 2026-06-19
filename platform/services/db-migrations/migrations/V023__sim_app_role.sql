-- V023: dedicated non-superuser application role for the simintero DB.
-- All simintero-DB services connect as this role so FORCE RLS actually applies
-- (the bootstrap `sim` role is the cluster SUPERUSER and bypasses RLS entirely).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sim_app') THEN
    CREATE ROLE sim_app LOGIN PASSWORD 'devpassword' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- Schemas the app touches (ctrl.* is RBAC-only / no RLS, but control-plane needs CRUD on it).
GRANT USAGE ON SCHEMA
  shared, vkas, task, docs, ens, fabric, qual, revital,
  search, analytics, claims, automation, market, ctrl
  TO sim_app;

-- Existing tables + sequences, and default privileges for future ones (created by `sim`).
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['shared','vkas','task','docs','ens','fabric','qual',
                           'revital','search','analytics','claims','automation','market','ctrl']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO sim_app', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO sim_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sim_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO sim_app', s);
  END LOOP;
END $$;
