-- V5: CMS-0053-F attachment correlation tables

CREATE SCHEMA IF NOT EXISTS interop;

CREATE TABLE IF NOT EXISTS interop.rfai_correlation (
    rfai_id         TEXT        PRIMARY KEY,
    claim_id        TEXT        NOT NULL,
    tenant_id       TEXT        NOT NULL,
    case_ref        TEXT        NOT NULL,
    loinc_codes     TEXT[]      NOT NULL DEFAULT '{}',
    control_number  TEXT,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fulfilled_at    TIMESTAMPTZ,
    doc_id          TEXT
);

CREATE INDEX rfai_correlation_claim_idx   ON interop.rfai_correlation (claim_id, tenant_id);
CREATE INDEX rfai_correlation_control_idx ON interop.rfai_correlation (control_number) WHERE control_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS interop.attachment_signature_audit (
    audit_id        TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    rfai_id         TEXT        REFERENCES interop.rfai_correlation(rfai_id),
    doc_id          TEXT,
    tenant_id       TEXT        NOT NULL,
    cert_subject    TEXT,
    cert_sha256     TEXT,
    sig_valid       BOOLEAN     NOT NULL,
    rejection_reason TEXT,
    verified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
