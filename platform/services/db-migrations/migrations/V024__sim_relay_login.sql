-- V024: give the BYPASSRLS relay role LOGIN so the platform @sim/relay service can
-- connect as it. sim_app is NOT granted membership — only the relay bypasses RLS,
-- preserving the slice-0.1 tenant-isolation guarantee.
ALTER ROLE sim_relay LOGIN PASSWORD 'devpassword';
GRANT USAGE ON SCHEMA shared TO sim_relay;
GRANT SELECT, UPDATE ON shared.outbox TO sim_relay;
