-- V4: Drop the custom FHIR resource table.
-- HAPI JPA (via the external hapiproject/hapi container) now owns all FHIR resource storage.
-- The decision_store table (V2, V3) remains — still used by PasInquireController.

DROP TABLE IF EXISTS fhir_resource;
