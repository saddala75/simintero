-- V1: Base schema — fhir_resource table
-- Stores FHIR resources as JSON text; resource_json is cast to jsonb at query time
-- for containment searches (resource_json::jsonb @> ...).
-- No HAPI JPA DAOs: all persistence is via FhirResourceRepository (custom JPA).

CREATE TABLE IF NOT EXISTS fhir_resource (
    id            VARCHAR(255)  PRIMARY KEY,
    resource_type VARCHAR(100)  NOT NULL,
    tenant_id     VARCHAR(255)  NOT NULL,
    resource_json TEXT          NOT NULL,
    version_id    BIGINT        NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ   NOT NULL,
    updated_at    TIMESTAMPTZ   NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fhir_type_tenant
    ON fhir_resource (resource_type, tenant_id);

CREATE INDEX IF NOT EXISTS idx_fhir_tenant
    ON fhir_resource (tenant_id);
