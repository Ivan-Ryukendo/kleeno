// PROTECTED. Reconciliation acceptance (PRD 8.5): the 4 exception types are detected with evidence, nothing is guessed,
// open exceptions block calculation (rule 14), unexplained time is never a deduction (rule 11), and resolved data prices correctly.
import { describe, expect, it } from "vitest";
import { calculatePayroll, type EngineEntry, type PayType } from "@/core/engine";
import { formatUsdc, parseUsdc } from "@/core/money";
import { analyse, OPTIONS, toDecimal, type ReconInput, type ResolutionAction } from "@/core/reconciliation";
import { ratio } from "@/core/money";
import { CONFIG as ENGINE_CONFIG } from "../../fixtures/payroll/cases";
import { CONFIG, DAYS, demo, lv, PERIOD, ts } from "../../fixtures/reconciliation/demo";

const resolve = (input: ReconInput, picks: Record<string, ResolutionAction> = {}) => analyse(input, new Map(Object.entries(picks)));
const keys = (input: ReconInput, picks?: Record<string, ResolutionAction>) => resolve(input, picks).exceptions.map((e) => e.key).sort();

describe("demo cast, stage by stage", () => {
  it("stage 1 raises the duplicate and the leave/work conflict, and nothing else yet", () => {
    const a = resolve(demo());
    expect(a.exceptions.map((e) => [e.category, e.workerId])).toEqual([
      ["DUPLICATE_TIMESHEET", "W005"],
      ["LEAVE_WORK_CONFLICT", "W006"],
    ]);
    expect(a.inputs).toBeNull();
  });

  it("evidence names only record IDs and hours", () => {
    const [dup, lw] = resolve(demo()).exceptions;
    expect(dup.evidence.recordIds).toHaveLength(2);
    expect(dup.evidence.facts).toMatchObject({ date: DAYS[2], rows: "2" });
    expect(lw.evidence.facts).toMatchObject({ date: DAYS[4], leaveHours: "8", workedHours: "8" });
    expect(JSON.stringify([dup, lw])).not.toMatch(/amount|salary|rate|\$/i);
  });

  it("once stage 1 is decided, stage 2 finds the missing hours of W004 only", () => {
    const stage1 = resolve(demo());
    const picks = { [stage1.exceptions[0].key]: "KEEP_FIRST" as const, [stage1.exceptions[1].key]: "KEEP_BOTH" as const };
    const a = resolve(demo(), picks);
    const stage2 = a.exceptions.filter((e) => e.category === "UNEXPLAINED_MISSING_HOURS");
    expect(stage2.map((e) => e.workerId)).toEqual(["W004"]);
    expect(stage2[0].evidence.facts).toEqual({ scheduledHours: "40", workedHours: "36", leaveHours: "0", missingHours: "4" });
    expect(a.inputs).toBeNull();
  });

  it("fully resolved, the inputs price correctly in the engine; unresolved time is never silently deducted", () => {
    const stage1 = resolve(demo());
    const picks: Record<string, ResolutionAction> = { [stage1.exceptions[0].key]: "KEEP_FIRST", [stage1.exceptions[1].key]: "KEEP_BOTH", "mh|W004": "TREAT_AS_UNPAID_LEAVE" };
    const a = resolve(demo(), picks);
    expect(a.inputs).not.toBeNull();

    const pay: Record<string, [PayType, string, string]> = { W001: ["RETAINER", "1500", "0"], W002: ["HOURLY", "0", "30"], W003: ["SALARIED", "2000", "0"], W004: ["SALARIED", "2000", "0"], W005: ["HOURLY", "0", "30"], W006: ["SALARIED", "2000", "0"] };
    const entries: EngineEntry[] = [...a.inputs!].map(([id, input]) => ({ worker: { workerId: id, payType: pay[id][0], baseAmount: parseUsdc(pay[id][1]), hourlyRate: parseUsdc(pay[id][2]) }, input }));
    const gross = Object.fromEntries(calculatePayroll(ENGINE_CONFIG, entries).lines.map((l) => [l.workerId, formatUsdc(l.gross)]));
    expect(gross).toEqual({ W001: "1500.00", W002: "1560.00", W003: "2000.00", W004: "1800.00", W005: "1200.00", W006: "2000.00" });
  });

  it("is deterministic: the same evidence and decisions give the same result", () => {
    const input = demo();
    const picks = { "mh|W004": "TREAT_AS_PAID_LEAVE" as const };
    expect(JSON.stringify(resolve(input, picks).exceptions)).toEqual(JSON.stringify(resolve(input, picks).exceptions));
  });
});

describe("each category on its own", () => {
  const solo = (payType: PayType, timesheets: ReconInput["timesheets"], leave: ReconInput["leave"] = [], config: ReconInput["config"] = CONFIG): ReconInput => ({ config, period: PERIOD, workers: [{ id: "A", payType }], timesheets, leave });
  const week = (h: string[], extra: string[] = []) => DAYS.map((d, i) => ts("A", d, h[i], extra[i] ?? "0"));

  it("UNAPPROVED_OVERTIME (salaried): hours above the weekly threshold without approval; approval clears it", () => {
    const base = solo("SALARIED", week(["10", "10", "10", "10", "8"]));
    const a = resolve(base);
    expect(a.exceptions.map((e) => e.category)).toEqual(["UNAPPROVED_OVERTIME"]);
    expect(a.exceptions[0].evidence.facts).toMatchObject({ overtimeHours: "8", approvedHours: "0", unapprovedHours: "8" });
    const approved = resolve(solo("SALARIED", week(["10", "10", "10", "10", "8"], ["0", "0", "0", "0", "8"])));
    expect(approved.exceptions).toEqual([]);
    expect(approved.inputs!.get("A")).toMatchObject({ approvedOvertimeHours: "8" });
    expect(resolve(base, { [a.exceptions[0].key]: "APPROVE_HOURS" }).inputs!.get("A")).toMatchObject({ approvedOvertimeHours: "8" });
    expect(resolve(base, { [a.exceptions[0].key]: "EXCLUDE_HOURS" }).inputs!.get("A")).toMatchObject({ approvedOvertimeHours: "0" });
  });

  it("UNAPPROVED_OVERTIME (hourly): hours above the contracted cap", () => {
    const a = resolve(solo("HOURLY", week(["10", "10", "10", "10", "8"])));
    expect(a.exceptions[0]).toMatchObject({ category: "UNAPPROVED_OVERTIME", key: "uo|A|period" });
    expect(resolve(solo("HOURLY", week(["10", "10", "10", "10", "8"])), { "uo|A|period": "EXCLUDE_HOURS" }).inputs!.get("A")).toMatchObject({ workedHours: "48", approvedAboveCapHours: "0" });
  });

  it("no overtime rule (threshold 0, no cap): long weeks are not flagged", () => {
    const none = { ...CONFIG, weeklyOvertimeThresholdHours: "0", hourlyCapHours: null };
    expect(resolve(solo("SALARIED", week(["10", "10", "10", "10", "10"]), [], none)).exceptions).toEqual([]);
    expect(resolve(solo("HOURLY", week(["10", "10", "10", "10", "10"]), [], none)).exceptions).toEqual([]);
  });

  it("a partial week scales the threshold by its weekdays / 5 (P2 decision 1)", () => {
    const input: ReconInput = { ...solo("SALARIED", [ts("A", "2026-10-08", "9"), ts("A", "2026-10-09", "9")]), period: { start: "2026-10-08", end: "2026-10-11" } }; // Thu-Sun: 2 weekdays -> limit 16
    expect(resolve(input).exceptions.find((e) => e.category === "UNAPPROVED_OVERTIME")?.evidence.facts).toMatchObject({ overtimeHours: "2" });
  });

  it("UNEXPLAINED_MISSING_HOURS: a salaried worker with no time at all is flagged, never deducted", () => {
    const a = resolve(solo("SALARIED", []));
    expect(a.exceptions[0]).toMatchObject({ category: "UNEXPLAINED_MISSING_HOURS", key: "mh|A" });
    expect(a.exceptions[0].evidence.facts.missingHours).toBe("40");
    expect(a.inputs).toBeNull();
    expect(resolve(solo("SALARIED", []), { "mh|A": "TREAT_AS_PAID_LEAVE" }).inputs!.get("A")).toMatchObject({ paidLeaveHours: "40", unpaidLeaveHours: "0" });
  });

  it("leave covers missing time; salary workers with enough hours raise nothing", () => {
    expect(resolve(solo("SALARIED", week(["8", "8", "8", "8", "0"]), [lv("A", DAYS[4], "UNPAID", "8")])).exceptions).toEqual([]);
    expect(resolve(solo("SALARIED", week(["8", "8", "8", "8", "8"]))).exceptions).toEqual([]);
  });

  it("DUPLICATE_TIMESHEET: KEEP_FIRST / KEEP_LATEST / KEEP_ALL change what counts", () => {
    const rows = [...week(["7", "7", "7", "7", "7"]), ts("A", DAYS[0], "5")];
    const key = `dup|A|${DAYS[0]}`;
    const worked = (a: ResolutionAction) => resolve(solo("HOURLY", rows), { [key]: a }).inputs!.get("A")!.workedHours;
    expect(worked("KEEP_FIRST")).toBe("35");
    expect(worked("KEEP_LATEST")).toBe("33");
    expect(worked("KEEP_ALL")).toBe("40");
  });

  it("LEAVE_WORK_CONFLICT: an hourly worker's leave is never ignored silently; only KEEP_WORK is offered", () => {
    const a = resolve(solo("HOURLY", week(["8", "8", "8", "8", "0"]), [lv("A", DAYS[4], "PAID", "8")]));
    expect(a.exceptions[0]).toMatchObject({ category: "LEAVE_WORK_CONFLICT", options: ["KEEP_WORK"] });
    expect(resolve(solo("HOURLY", week(["8", "8", "8", "8", "0"]), [lv("A", DAYS[4], "PAID", "8")]), { [a.exceptions[0].key]: "KEEP_WORK" }).inputs!.get("A")).toMatchObject({ workedHours: "32" });
  });

  it("LEAVE_WORK_CONFLICT: KEEP_LEAVE drops the worked hours of that day, KEEP_WORK drops the leave", () => {
    const input = solo("SALARIED", week(["8", "8", "8", "8", "8"]), [lv("A", DAYS[4], "PAID", "8")]);
    const key = `lw|A|${DAYS[4]}`;
    expect(resolve(input, { [key]: "KEEP_LEAVE" }).inputs!.get("A")).toMatchObject({ workedHours: "32", paidLeaveHours: "8" });
    expect(resolve(input, { [key]: "KEEP_WORK" }).inputs!.get("A")).toMatchObject({ workedHours: "40", paidLeaveHours: "0" });
  });

  it("retainer: approved extra hours are summed; plain hours raise nothing", () => {
    const a = resolve(solo("RETAINER", week(["8", "8", "8", "8", "8"], ["0", "2", "0", "0", "0"])));
    expect(a.exceptions).toEqual([]);
    expect(a.inputs!.get("A")).toMatchObject({ approvedExtraHours: "2" });
  });
});

describe("rules that must always hold", () => {
  it("every decision offered is in the category's allowed list (the AI may only suggest from these)", () => {
    for (const e of resolve(demo()).exceptions) for (const o of e.options) expect(OPTIONS[e.category]).toContain(o);
  });

  it("exception keys are stable identities, so reconciling again cannot duplicate them", () => {
    const input = demo();
    expect(keys(input)).toEqual(keys(input));
    expect(new Set(keys(input)).size).toBe(keys(input).length);
  });

  it("hours stay exact decimals; a non-terminating value fails closed", () => {
    expect(toDecimal(ratio(3n, 5n))).toBe("0.6");
    expect(toDecimal(ratio(40n))).toBe("40");
    expect(() => toDecimal(ratio(1n, 3n))).toThrow();
  });
});
