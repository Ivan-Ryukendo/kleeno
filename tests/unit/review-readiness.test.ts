import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rows: new Map<string, unknown>(), filters: [] as unknown[][] }));
vi.mock("@/server/env", () => ({ env: {} }));
vi.mock("@/server/db/client", () => ({
  db: () => reader,
  must: (result: { data: unknown; error: unknown }) => { if (result.error || result.data == null) throw Error("unavailable"); return result.data; },
}));
const reader = { from: (table: string) => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) query[method] = (...args: unknown[]) => { mock.filters.push([table, method, ...args]); return query; };
  query.maybeSingle = () => Promise.resolve(mock.rows.get(table));
  query.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(mock.rows.get(table)).then(resolve, reject);
  return query;
} };
import { reviewReadiness, assertReviewReady } from "@/server/db/review-readiness";
import { ReviewSettingsSchema } from "@/core/workflow/review-settings";
beforeEach(() => {
  mock.rows.clear(); mock.filters.length = 0;
  mock.rows.set("payroll_runs", { data: { id: "run", status: "CALCULATION_VALIDATED" }, error: null });
  mock.rows.set("payroll_review_settings", { data: null, error: null });
  mock.rows.set("exceptions", { data: [], error: null });
  mock.rows.set("import_batches", { data: [], error: null });
});
it("makes missing settings explicit and blocks signoff", async () => {
  const result = await reviewReadiness(reader as never, "company", "run");
  expect(result.settings).toBeNull(); expect(result.readiness.ready).toBe(false);
  await expect(assertReviewReady(reader as never, "company", "run")).rejects.toThrow();
});
it("does not turn a failed settings query into absent or ready data", async () => {
  mock.rows.set("payroll_review_settings", { data: null, error: { code: "08006" } });
  await expect(reviewReadiness(reader as never, "company", "run")).rejects.toThrow();
});
it.each([
  { row_count: 1, rejected_count: 0, created_at: "2026-10-01T00:00:00Z", ready: true },
  { row_count: 0, rejected_count: 0, created_at: "2026-10-01T00:00:00Z", ready: false },
  { row_count: 2, rejected_count: 1, created_at: "2026-10-01T00:00:00Z", ready: false },
  { row_count: 1, rejected_count: 0, created_at: "2099-10-01T00:00:00Z", ready: false },
])("checks accepted dataset evidence without implying worker coverage: %j", async ({ ready, ...batch }) => {
  mock.rows.set("payroll_review_settings", { data: { revision: 1, cutoff_at: "2099-10-30T00:00:00Z", time_zone: "UTC", required_types: ["TIMESHEETS"], fresh_after: null }, error: null });
  mock.rows.set("import_batches", { data: [{ id: "batch", ...batch }], error: null });
  const result = await reviewReadiness(reader as never, "company", "run");
  expect(result.readiness.ready).toBe(ready);
  expect(result.readiness.expected).toBe(1);
  expect(mock.filters).toContainEqual(["import_batches", "order", "id", { ascending: false }]);
  expect(mock.filters.filter(([, method, key]) => method === "eq" && key === "company_id").every(([, , , value]) => value === "company")).toBe(true);
});
it("keeps unresolved exceptions blocking despite received datasets", async () => {
  mock.rows.set("payroll_review_settings", { data: { revision: 1, cutoff_at: "2099-10-30T00:00:00Z", time_zone: "UTC", required_types: ["TIMESHEETS"], fresh_after: null }, error: null });
  mock.rows.set("import_batches", { data: [{ id: "batch", row_count: 1, rejected_count: 0, created_at: "2026-10-01T00:00:00Z" }], error: null });
  mock.rows.set("exceptions", { data: [{ id: "exception" }], error: null });
  await expect(assertReviewReady(reader as never, "company", "run")).rejects.toThrow("Review requirements are incomplete");
});
it("requires valid explicit instants, unique supported requirements and a real timezone", () => {
  const valid = { expectedRevision: 0, cutoffAt: "2026-10-30T17:00:00+06:00", timeZone: "Asia/Dhaka", requiredTypes: ["TIMESHEETS"], freshAfter: null };
  expect(ReviewSettingsSchema.safeParse(valid).success).toBe(true);
  expect(ReviewSettingsSchema.parse({ ...valid, timeZone: "asia/dhaka" }).timeZone).toBe("Asia/Dhaka");
  expect(ReviewSettingsSchema.safeParse({ ...valid, timeZone: "+06:00" }).success).toBe(false);
  for (const patch of [{ cutoffAt: "2026-10-30T17:00" }, { timeZone: "missing/zone" }, { requiredTypes: [] }, { requiredTypes: ["TIMESHEETS", "TIMESHEETS"] }, { freshAfter: "2026-11-01T00:00:00Z" }]) expect(ReviewSettingsSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
});
