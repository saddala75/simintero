import { describe, it, expect } from "vitest";
import { resolveEffectiveVersion } from "./resolve.js";

const artifacts = [
  {
    canonical_url: "https://artifacts.simintero.io/shared/coverage_rule/knee-arthroscopy",
    version: "2.0.0",
    tenant_id: "t_test",
    artifact_type: "coverage_rule",
    status: "active",
    effective_from: new Date("2025-01-01"),
    effective_to: null,
    applicability: { lob: ["MA"], region: ["TX"] },
    content: { rule: "v2" },
    content_hash: "abc",
    relations: [],
    metadata: {},
    created_by: "analyst@test",
    created_at: new Date(),
  },
  {
    canonical_url: "https://artifacts.simintero.io/shared/coverage_rule/knee-arthroscopy",
    version: "1.0.0",
    tenant_id: "t_test",
    artifact_type: "coverage_rule",
    status: "active",
    effective_from: new Date("2024-01-01"),
    effective_to: new Date("2025-01-01"),  // exclusive — v1.0.0 valid through Dec 31, 2024 inclusive
    applicability: { lob: ["MA"], region: ["TX"] },
    content: { rule: "v1" },
    content_hash: "xyz",
    relations: [],
    metadata: {},
    created_by: "analyst@test",
    created_at: new Date(),
  },
];

describe("resolveEffectiveVersion", () => {
  it("returns the version effective on a given date", () => {
    const result = resolveEffectiveVersion(artifacts, {
      asOf: new Date("2026-06-10"),
      ctx: { lob: "MA", region: "TX" },
    });
    expect(result?.version).toBe("2.0.0");
  });

  it("returns the older version for a past date", () => {
    const result = resolveEffectiveVersion(artifacts, {
      asOf: new Date("2024-06-01"),
      ctx: { lob: "MA", region: "TX" },
    });
    expect(result?.version).toBe("1.0.0");
  });

  it("returns null when no version was effective", () => {
    const result = resolveEffectiveVersion(artifacts, {
      asOf: new Date("2023-01-01"),
      ctx: { lob: "MA", region: "TX" },
    });
    expect(result).toBeNull();
  });

  it("returns null when lob does not match applicability", () => {
    const result = resolveEffectiveVersion(artifacts, {
      asOf: new Date("2026-06-10"),
      ctx: { lob: "MEDICAID", region: "TX" },
    });
    expect(result).toBeNull();
  });

  it("returns null when region does not match applicability", () => {
    const result = resolveEffectiveVersion(artifacts, {
      asOf: new Date("2026-06-10"),
      ctx: { lob: "MA", region: "CA" },
    });
    expect(result).toBeNull();
  });

  it("returns v1.0.0 on its last effective day (Dec 31, 2024)", () => {
    const result = resolveEffectiveVersion(artifacts, {
      asOf: new Date("2024-12-31"),
      ctx: { lob: "MA", region: "TX" },
    });
    expect(result?.version).toBe("1.0.0");
  });

  it("transitions to v2.0.0 on the boundary date (Jan 1, 2025)", () => {
    const result = resolveEffectiveVersion(artifacts, {
      asOf: new Date("2025-01-01"),
      ctx: { lob: "MA", region: "TX" },
    });
    expect(result?.version).toBe("2.0.0");
  });
});
