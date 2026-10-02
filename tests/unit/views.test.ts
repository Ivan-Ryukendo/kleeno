// S59: a view is strict data checked against a per-table allow-list; S60/S25: exports are role-scoped and escaped.
import { describe, expect, it } from "vitest";
import { applyView, columnsFor, defaultView, toCsv, totalsFor, validateView, ViewError, ViewSchema, type Row, type ViewDef } from "@/core/views";

const view = (over: Partial<ViewDef> = {}): ViewDef => ({ ...defaultView("lines", ["HR_APPROVER"]), ...over });
const rows: Row[] = [
  { worker: "W001", gross: "2000.00", deductions: "200.00", net: "1800.00", paid: "1800.00" },
  { worker: "W002", gross: "1560.00", deductions: "156.00", net: "1404.00", paid: "1000.00" },
  { worker: "W010", gross: "900.50", deductions: "90.05", net: "810.45", paid: "" },
];

describe("S59 the allow-list", () => {
  it("accepts a clean view", () => expect(validateView(view({ filters: [{ column: "net", op: "gt", value: "1000" }], sort: { column: "net", dir: "desc" } }), ["HR_APPROVER"])).toBeTruthy());

  it.each([
    ["an unknown column", view({ columns: ["worker", "salary"] })],
    ["SQL in a column name", view({ sort: { column: "net; drop table workers", dir: "asc" } })],
    ["an operator the type does not have", view({ filters: [{ column: "worker", op: "gt", value: "5" }] })],
    ["a money filter that is not a number", view({ filters: [{ column: "net", op: "gt", value: "1; select 1" }] })],
    ["a date filter that is not a date", { ...defaultView("timesheets", ["HR_APPROVER"]), filters: [{ column: "date", op: "after", value: "yesterday" }] }],
  ])("rejects %s", (_n, v) => expect(() => validateView(v as ViewDef, ["HR_APPROVER"])).toThrow(ViewError));

  it("rejects fields outside the schema (the AI cannot smuggle SQL or write fields)", () => {
    expect(ViewSchema.safeParse({ ...view(), sql: "select 1" }).success).toBe(false);
    expect(ViewSchema.safeParse({ ...view(), table: "app_users" }).success).toBe(false);
    expect(ViewSchema.safeParse({ ...view(), filters: Array(9).fill({ column: "net", op: "gt", value: "1" }) }).success).toBe(false);
  });

  it("a role cannot use or see a column it is not allowed", () => {
    expect(columnsFor("workers", ["VIEWER"]).map((c) => c.id)).not.toContain("base");
    expect(() => validateView({ ...defaultView("workers", ["HR_APPROVER"]), columns: ["code", "base"] }, ["VIEWER"])).toThrow(ViewError);
    expect(defaultView("workers", ["VIEWER"]).columns).not.toContain("base");
  });
});

describe("filter, sort, search and totals", () => {
  it("filters by amount exactly, sorts numerically, searches by worker", () => {
    expect(applyView(rows, view({ filters: [{ column: "net", op: "gte", value: "1404" }] })).map((r) => r.worker)).toEqual(["W001", "W002"]);
    expect(applyView(rows, view({ sort: { column: "net", dir: "asc" } })).map((r) => r.worker)).toEqual(["W010", "W002", "W001"]); // 810.45 < 1404 < 1800, not text order
    expect(applyView(rows, view({ search: "w00" })).map((r) => r.worker)).toEqual(["W001", "W002"]);
    expect(applyView(rows, view({ filters: [{ column: "worker", op: "contains", value: "010" }] })).map((r) => r.worker)).toEqual(["W010"]);
  });

  it("totals are exact sums over the rows shown, blanks count as zero", () => {
    expect(totalsFor(rows, view())).toEqual({ gross: "4460.50", deductions: "446.05", net: "4014.45", paid: "2800.00" });
    expect(totalsFor(applyView(rows, view({ filters: [{ column: "worker", op: "equals", value: "w001" }] })), view())).toMatchObject({ net: "1800.00" });
  });

  it("only visible columns are totalled", () => {
    expect(totalsFor(rows, view({ columns: ["worker", "net"] }))).toEqual({ net: "4014.45" });
  });

  it("enum filters compare case-insensitively; dates compare as dates", () => {
    const d = defaultView("timesheets", ["HR_APPROVER"]);
    const ts: Row[] = [{ worker: "W001", date: "2026-10-05", match: "EXCEPTION" }, { worker: "W002", date: "2026-10-09", match: "AUTO_MATCHED" }];
    expect(applyView(ts, { ...d, filters: [{ column: "match", op: "is", value: "exception" }] })).toHaveLength(1);
    expect(applyView(ts, { ...d, filters: [{ column: "date", op: "after", value: "2026-10-06" }] }).map((r) => r.worker)).toEqual(["W002"]);
  });
});

describe("export", () => {
  it("contains only the columns shown and visible to the role, with formulas defused and quotes escaped", () => {
    const d = { ...defaultView("workers", ["HR_APPROVER"]), columns: ["code", "base", "payType"] };
    const csv = toCsv([{ code: '=HYPERLINK("x")', base: "2000.00", payType: "SALARIED" }, { code: "W002", base: "10", payType: "A,B" }], d, ["VIEWER"]);
    expect(csv).toBe(`Code,Pay type\r\n"'=HYPERLINK(""x"")",SALARIED\r\nW002,"A,B"\r\n`);
    expect(csv).not.toContain("2000");
  });
});
