import { describe, expect, it } from "vitest";
import { daysLeftText, daysUntil, monthStrip, payDateFor, readinessSteps, type StepInput } from "@/lib/dashboard-model";

const base: StepInput = { runId: "r1", status: "EXCEPTIONS_PENDING", mode: "SIMULATION", policyVersion: 3, openExceptions: 2, liveEnabled: false, signedOff: false, inputs: { received: 5, expected: 5 }, matched: { count: 12, total: 14 }, canPayroll: true, canPay: false };
const states = (i: Partial<StepInput>) => readinessSteps({ ...base, ...i }).map((s) => s.state);

describe("readinessSteps", () => {
  it("has the seven mockup steps and blocks at Reconcile while exceptions are open", () => {
    const steps = readinessSteps(base);
    expect(steps.map((s) => s.label)).toEqual(["Policy", "Import", "Reconcile", "HR review", "Payroll approval", "Payment approval", "Settlement"]);
    expect(states({})).toEqual(["done", "done", "blocked", "pending", "unavailable", "unavailable", "unavailable"]);
    expect(steps[2].detail).toBe("12 of 14 records matched · 2 open");
    expect(steps[0].detail).toBe("v3 pinned");
    expect(steps[6].detail).toBe("Simulated, never pays");
  });
  it("makes HR review current once validated and done after sign-off; unknown sign-off is not shown as done", () => {
    expect(states({ status: "CALCULATION_VALIDATED", openExceptions: 0 })[3]).toBe("current");
    expect(states({ status: "CALCULATION_VALIDATED", openExceptions: 0, signedOff: true })[3]).toBe("done");
    const hidden = readinessSteps({ ...base, status: "CALCULATION_VALIDATED", openExceptions: 0, signedOff: null })[3];
    expect(hidden).toMatchObject({ state: "current", detail: "Sign-off status is not visible to your role" });
  });
  it("walks a live run through approval, payment approval and settlement", () => {
    const live = { mode: "LIVE_TESTNET", openExceptions: 0, liveEnabled: true, signedOff: true };
    expect(states({ ...live, status: "PENDING_APPROVAL" })).toEqual(["done", "done", "done", "done", "current", "pending", "pending"]);
    expect(states({ ...live, status: "OBLIGATIONS_CREATED" })).toEqual(["done", "done", "done", "done", "done", "current", "pending"]);
    expect(states({ ...live, status: "PAYMENT_IN_PROGRESS" })).toEqual(["done", "done", "done", "done", "done", "done", "current"]);
    expect(states({ ...live, status: "RECONCILED" }).every((s) => s === "done")).toBe(true);
    expect(states({ ...live, status: "REJECTED" })[4]).toBe("blocked");
    expect(readinessSteps({ ...base, ...live, status: "APPROVED", liveEnabled: false })[6]).toMatchObject({ state: "blocked", detail: "Live payments are off" });
  });
  it("marks every step unavailable for an unknown status", () => {
    expect(states({ status: "SURPRISE" }).every((s) => s === "unavailable")).toBe(true);
  });
  it("only links steps the role can use", () => {
    const viewer = readinessSteps({ ...base, canPayroll: false });
    expect(viewer[1].href).toBeNull();
    expect(viewer[2].href).toBeNull();
    expect(readinessSteps({ ...base, mode: "LIVE_TESTNET", canPay: true })[5].href).toBe("/settlement?run=r1");
  });
});

describe("dates", () => {
  it("counts whole days to the cutoff and says when it has passed", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    expect(daysLeftText(daysUntil("2026-10-27T23:59:00Z", now))).toBe("17 days left");
    expect(daysLeftText(daysUntil("2026-10-11T12:00:00Z", now))).toBe("1 day left");
    expect(daysLeftText(daysUntil("2026-10-10T12:00:00Z", now))).toBe("Due today");
    expect(daysLeftText(daysUntil("2026-10-08T12:00:00Z", now))).toBe("Passed 1 day ago"); // 1.5 days ago rounds toward zero, never up
    expect(daysLeftText(daysUntil("2026-10-07T12:00:00Z", now))).toBe("Passed 2 days ago");
    expect(daysLeftText(daysUntil("2026-10-09T23:00:00Z", now))).toBe("Passed today"); // one hour ago is not a day
    expect(daysUntil("not a date", now)).toBeNull();
    expect(daysLeftText(null)).toBeNull();
  });
  it("derives a pay date only from a schedule that has an anchor", () => {
    expect(payDateFor("MONTHLY", 31, "2026-10-31")).toBe("2026-10-31");
    expect(payDateFor("MONTHLY", 5, "2026-10-31")).toBe("2026-11-05");
    expect(payDateFor("MONTHLY", 28, "2026-10-31")).toBe("2026-11-28");
    expect(payDateFor("MONTHLY", 31, "2026-02-10")).toBe("2026-02-28");
    expect(payDateFor("WEEKLY", 5, "2026-10-31")).toBe("2026-11-06"); // Saturday -> next Friday
    expect(payDateFor("BIWEEKLY", 5, "2026-10-31")).toBeNull();
    expect(payDateFor("SEMI_MONTHLY", null, "2026-10-31")).toBeNull();
    expect(payDateFor("MONTHLY", null, "2026-10-31")).toBeNull();
    expect(payDateFor("MONTHLY", 5, "garbage")).toBeNull();
  });
});

describe("monthStrip", () => {
  const runs = [{ status: "SETTLED", period_end: "2026-01-31" }, { status: "RECONCILED", period_end: "2026-02-28" }, { status: "CALCULATION_VALIDATED", period_end: "2026-03-31" }, { status: "SETTLED", period_end: "2025-12-31" }];
  it("covers the whole calendar year, counts only settled or reconciled runs of that year and marks the selected month pending", () => {
    const { cells, settled } = monthStrip(runs, 2026, "2026-03-31");
    expect(cells).toHaveLength(12);
    expect(settled).toBe(2);
    expect(cells.map((c) => c.state)).toEqual(["settled", "settled", "pending", "none", "none", "none", "none", "none", "none", "none", "none", "none"]);
    expect(cells[2].label).toBe("March: not settled yet");
  });
  it("uses the same year rule for a past year: nothing is pending when the selected run is in another year", () => {
    const { cells, settled } = monthStrip(runs, 2025, "2026-03-31");
    expect(settled).toBe(1);
    expect(cells.some((c) => c.state === "pending")).toBe(false);
  });
  it("never counts a simulation-only history", () => {
    expect(monthStrip([{ status: "CALCULATION_VALIDATED", period_end: "2026-10-31" }], 2026, "2026-10-31").settled).toBe(0);
  });
});
