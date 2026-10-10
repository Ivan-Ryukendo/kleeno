import { describe, expect, it } from "vitest";
import { deriveReadiness, type ReadinessInput } from "@/core/workflow/readiness";

const input = (): ReadinessInput => ({
  requirements: [{ id: "hours", label: "Approved hours", required: true, freshAfter: "2026-10-01T00:00:00Z" }],
  evidence: [{ requirementId: "hours", ref: "import-1", receivedAt: "2026-10-07T05:00:00Z", observedAt: "2026-10-06T00:00:00Z", valid: true }],
  cutoff: { at: "2026-10-07T12:00:00+06:00", timeZone: "Asia/Dhaka" }, now: "2026-10-07T07:00:00Z", validationProblems: [],
});
describe("explicit period readiness", () => {
  it("reports the evidence numerator and configured cutoff", () => {
    expect(deriveReadiness(input())).toMatchObject({ ready: true, expected: 1, received: 1, blockers: [], items: [{ status: "RECEIVED", ref: "import-1" }] });
  });
  it.each(["requirements", "cutoff"] as const)("blocks missing %s configuration", field => {
    expect(deriveReadiness({ ...input(), [field]: null }).ready).toBe(false);
  });
  it("blocks invalid timezone and missing timestamp offset", () => {
    expect(deriveReadiness({ ...input(), cutoff: { at: "2026-10-07T12:00:00", timeZone: "Asia/Dhaka" } }).ready).toBe(false);
    expect(deriveReadiness({ ...input(), cutoff: { at: "2026-10-07T06:00:00Z", timeZone: "invented" } }).ready).toBe(false);
  });
  it.each(["MISSING", "STALE", "LATE", "INVALID"] as const)("blocks %s mandatory evidence", status => {
    const v = input();
    if (status === "MISSING") v.evidence = [];
    if (status === "STALE") v.evidence[0].observedAt = "2026-09-30T00:00:00Z";
    if (status === "LATE") v.evidence[0].receivedAt = "2026-10-07T06:00:01Z";
    if (status === "INVALID") v.evidence[0].valid = false;
    expect(deriveReadiness(v)).toMatchObject({ ready: false, received: 0, items: [{ status }] });
  });
  it("records a missing-input waiver without bypassing validation or late data", () => {
    const v = input(); v.requirements![0].waiver = { reason: "No hours for this period", evidenceRef: "decision-1" }; v.evidence = [];
    expect(deriveReadiness(v)).toMatchObject({ ready: false, received: 0, items: [{ status: "WAIVED" }] });
    v.requirements![0].required = false;
    expect(deriveReadiness(v).ready).toBe(true);
    expect(deriveReadiness({ ...v, validationProblems: ["Unresolved exception"] }).ready).toBe(false);
    v.evidence = [{ ...input().evidence[0], receivedAt: "2026-10-07T06:01:00Z" }];
    expect(deriveReadiness(v)).toMatchObject({ ready: false, items: [{ status: "LATE" }] });
  });
  it("does not hide a newer invalid revision behind earlier valid evidence", () => {
    const v = input(); v.evidence.push({ ...v.evidence[0], ref: "import-2", receivedAt: "2026-10-07T05:10:00Z", valid: false });
    expect(deriveReadiness(v)).toMatchObject({ ready: false, items: [{ status: "INVALID", ref: "import-2" }] });
  });
});
