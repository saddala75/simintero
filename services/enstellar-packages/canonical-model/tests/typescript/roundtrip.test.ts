// AUTO-GENERATED — packages/canonical-model/tests/typescript/roundtrip.test.ts
import { describe, expect, it } from "vitest";
import type { Case, Member, Coverage, Provider, ServiceLine } from "../../generated/typescript/index.js";

const sampleMember: Member = {
  memberId: "11111111-0000-0000-0000-000000000001",
  tenantId: "tenant-test",
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: "1985-04-12",
  mrn: "MRN-001",
  gender: "F",
  identifiers: [],
};

const sampleCoverage: Coverage = {
  coverageId: "22222222-0000-0000-0000-000000000002",
  tenantId: "tenant-test",
  memberId: "11111111-0000-0000-0000-000000000001",
  planId: "PLAN-GOLD-001",
  subscriberId: "SUB-001",
  payerName: "Acme Health",
  lob: "commercial",
  effectiveDate: "2025-01-01",
};

const sampleProvider: Provider = {
  providerId: "33333333-0000-0000-0000-000000000003",
  tenantId: "tenant-test",
  npi: "1234567890",
  name: "Dr. Alice Smith",
  specialty: "Orthopedics",
  identifiers: [],
};

const sampleServiceLine: ServiceLine = {
  serviceLineId: "44444444-0000-0000-0000-000000000004",
  tenantId: "tenant-test",
  sequence: 1,
  serviceTypeCode: "73",
  procedureCode: "27447",
  procedureDescription: "Total knee replacement",
  quantity: 1,
  units: "UN",
  diagnosisCodes: ["M17.11"],
  placeOfService: "21",
  requestedStartDate: "2026-07-01",
};

const sampleCase: Case = {
  caseId: "55555555-0000-0000-0000-000000000005",
  tenantId: "tenant-test",
  correlationId: "corr-abc-123",
  lob: "commercial",
  status: "intake",
  urgency: "standard",
  member: sampleMember,
  coverage: sampleCoverage,
  requestingProvider: sampleProvider,
  serviceLines: [sampleServiceLine],
  decisions: [],
  createdAt: "2026-06-05T10:00:00Z",
  updatedAt: "2026-06-05T10:00:00Z",
};

describe("TypeScript canonical model round-trips", () => {
  it("Member round-trips through JSON.stringify/parse", () => {
    const json = JSON.stringify(sampleMember);
    const result = JSON.parse(json) as Member;
    expect(result).toEqual(sampleMember);
  });

  it("Case round-trips through JSON.stringify/parse", () => {
    const json = JSON.stringify(sampleCase);
    const result = JSON.parse(json) as Case;
    expect(result).toEqual(sampleCase);
  });

  it("Case JSON contains tenant_id on root and nested entities", () => {
    const payload = JSON.parse(JSON.stringify(sampleCase)) as Record<string, unknown>;
    expect((payload as Case).tenantId).toBe("tenant-test");
    expect(((payload as Case).member as Member).tenantId).toBe("tenant-test");
  });
});
