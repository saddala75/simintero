CREATE SCHEMA IF NOT EXISTS ens;

CREATE TABLE ens.case (
  case_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL,
  lob         TEXT NOT NULL,
  program     TEXT,
  product     TEXT,
  region      TEXT,
  state       TEXT NOT NULL,
  urgency     TEXT NOT NULL CHECK (urgency IN ('standard','expedited')),
  channel     TEXT NOT NULL CHECK (channel IN ('PAS','X12_278','PORTAL','FAX_OCR')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ens.case ENABLE ROW LEVEL SECURITY;
ALTER TABLE ens.case FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ens.case
  USING (tenant_id = current_setting('sim.tenant_id', true));

CREATE TABLE ens.case_event (
  case_id     UUID NOT NULL REFERENCES ens.case(case_id),
  seq         INT NOT NULL,
  tenant_id   TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  trace_ref   TEXT,
  actor       JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, seq)
);

ALTER TABLE ens.case_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE ens.case_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ens.case_event
  USING (tenant_id = current_setting('sim.tenant_id', true));

-- Worklist projection index: queue by state and urgency
CREATE INDEX ens_case_worklist_idx ON ens.case (tenant_id, state, urgency, created_at);
