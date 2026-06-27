-- V038: grant the BYPASSRLS sim_relay role SELECT on qual.measure_definition
-- so the qualitron-aggregation MeasureBatchSchedule can perform cross-tenant
-- scans (SET ROLE sim_relay before SELECT). sim_app has NOBYPASSRLS, so
-- FORCE RLS on measure_definition returns zero rows when no tenant GUC is set
-- (the batch context). The relay role bypasses RLS; per-tenant HTTP triggers
-- then carry the tenant_id in x-sim-tenant-id headers to the execution service.
GRANT SELECT ON qual.measure_definition TO sim_relay;
