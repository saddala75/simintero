import { describe, it, expect } from "vitest";
import { transitionStatus, StatusTransitionError } from "./lifecycle.js";

describe("transitionStatus", () => {
  it("allows draft → in_review", () => {
    expect(transitionStatus("draft", "in_review")).toBe("in_review");
  });

  it("allows in_review → approved", () => {
    expect(transitionStatus("in_review", "approved")).toBe("approved");
  });

  it("allows approved → active", () => {
    expect(transitionStatus("approved", "active")).toBe("active");
  });

  it("allows active → retired", () => {
    expect(transitionStatus("active", "retired")).toBe("retired");
  });

  it("allows active → rolled_back", () => {
    expect(transitionStatus("active", "rolled_back")).toBe("rolled_back");
  });

  it("throws on invalid transition (active → superseded)", () => {
    expect(() => transitionStatus("active", "superseded" as never)).toThrow(StatusTransitionError);
  });

  it("allows in_review → draft (send back for revision)", () => {
    expect(transitionStatus("in_review", "draft")).toBe("draft");
  });

  it("allows approved → in_review (send back for re-review)", () => {
    expect(transitionStatus("approved", "in_review")).toBe("in_review");
  });

  it("throws on invalid transition (draft → active)", () => {
    expect(() => transitionStatus("draft", "active")).toThrow(StatusTransitionError);
  });

  it("throws on invalid transition (retired → active)", () => {
    expect(() => transitionStatus("retired", "active")).toThrow(StatusTransitionError);
  });

  it("throws on invalid transition (approved → draft)", () => {
    expect(() => transitionStatus("approved", "draft")).toThrow(StatusTransitionError);
  });
});
