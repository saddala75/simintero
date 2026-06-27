-- Add digicore_library_ref column to qual.measure_definition
-- This column holds the URL of the VKAS cql_library artifact
ALTER TABLE qual.measure_definition
  ADD COLUMN digicore_library_ref TEXT;

-- Point the BCS-E demo measure at its VKAS cql_library artifact.
-- measure_ref = 'hedis:BCS-E' matches the V020 seed exactly.
UPDATE qual.measure_definition
SET digicore_library_ref = 'https://artifacts.simintero.io/shared/cql_library/bcs-e'
WHERE measure_ref = 'hedis:BCS-E';
