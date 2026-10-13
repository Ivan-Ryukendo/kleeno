import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import AuditPage from "@/app/(app)/(workspace)/audit/page";

const runId = "10000000-0000-4000-8000-000000000001";
const eventId = "20000000-0000-4000-8000-000000000002";
const before = `2026-10-10T12:00:00Z~${eventId}`;
const state = vi.hoisted(() => ({ exists: true, failed: false, next: null as string | null, eq: vi.fn(), audit: vi.fn() }));
vi.mock("@/components/payroll/frame-data", () => ({ loadFrameData: async () => ({ facts: { workers: null, autoMatched: null, openExceptions: null }, runs: [] }) }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/server/auth/page-session", () => ({ pageSession: async () => ({
  actor: { companyId: "session-company", userId: "actor", roles: ["HR_APPROVER"] },
  client: { from: () => {
    const query = { select: () => query, eq: (...args: unknown[]) => { state.eq(...args); return query; }, maybeSingle: async () => ({ data: state.exists ? { id: "10000000-0000-4000-8000-000000000001", mode: "SIMULATION", status: "DRAFT", period_start: "2026-10-01", period_end: "2026-10-31" } : null, error: state.failed ? { code: "PRIVATE_DATABASE_ERROR" } : null }) };
    return query;
  } },
}) }));
vi.mock("@/server/db/audit", () => ({ auditView: async (...args: unknown[]) => {
  state.audit(...args);
  return { items: [], next: state.next, graphTruncated: false };
} }));

const page = async (query: { run?: string; before?: string; entity?: string } = {}) => renderToStaticMarkup(await AuditPage({ searchParams: Promise.resolve(query) }));
const hrefFor = (html: string, label: string) => html.match(new RegExp(`<a[^>]*href="([^"]*)"[^>]*>${label}</a>`))?.[1].replaceAll("&amp;", "&");

beforeEach(() => { state.exists = true; state.failed = false; state.next = null; state.eq.mockClear(); state.audit.mockClear(); });

it("returns to the selected run and retains its entity filter when showing newest events", async () => {
  const html = await page({ run: runId, entity: "exceptions", before });
  expect(html).toContain("Payroll</h1>");
  expect(html).toContain("Run views");
  expect(hrefFor(html, "Back to run")).toBe(`/runs/${runId}`);
  const newest = new URL(hrefFor(html, "Newest events")!, "https://example.invalid");
  expect(newest.pathname).toBe("/audit");
  expect(Object.fromEntries(newest.searchParams)).toEqual({ run: runId, entity: "exceptions" });
  expect(hrefFor(html, "Show all company activity")).toBe("/audit");
  expect(html).toContain(`name="run" value="${runId}"`);
  expect(html).not.toContain('name="before"');
  expect(state.eq.mock.calls).toEqual([["company_id", "session-company"], ["id", runId]]);
  expect(state.audit.mock.calls[0].slice(1)).toEqual(["session-company", { runId, before, entityType: "exceptions" }]);
});

it("retains an entity-only filter without adding a run scope", async () => {
  const html = await page({ entity: "worker", before });
  const newest = new URL(hrefFor(html, "Newest events")!, "https://example.invalid");
  expect(Object.fromEntries(newest.searchParams)).toEqual({ entity: "worker" });
  expect(hrefFor(html, "Back to Dashboard")).toBe("/dashboard");
  expect(state.eq).not.toHaveBeenCalled();
});

it("preserves run and entity on older links, and resets an unfiltered cursor to company activity", async () => {
  state.next = before;
  const scoped = await page({ run: runId, entity: "payment_batches" });
  const older = new URL(hrefFor(scoped, "Older events")!, "https://example.invalid");
  expect(Object.fromEntries(older.searchParams)).toEqual({ run: runId, entity: "payment_batches", before });
  const unscoped = await page({ before });
  expect(hrefFor(unscoped, "Newest events")).toBe("/audit");
});

it.each([{ run: "invalid" }, { entity: "private_unknown" }, { before: "invalid" }, { before: `not-a-date~${eventId}` }])("rejects invalid query %j before reading audit records", async (query) => {
  await expect(page(query)).rejects.toThrow("NOT_FOUND");
  expect(state.eq).not.toHaveBeenCalled();
  expect(state.audit).not.toHaveBeenCalled();
});

it("rejects a missing or other-company run without reading its activity", async () => {
  state.exists = false;
  await expect(page({ run: runId })).rejects.toThrow("NOT_FOUND");
  expect(state.eq.mock.calls).toEqual([["company_id", "session-company"], ["id", runId]]);
  expect(state.audit).not.toHaveBeenCalled();
});

it("does not convert a failed tenant lookup into another timeline", async () => {
  state.failed = true;
  await expect(page({ run: runId })).rejects.toThrow("audit run read failed");
  expect(state.audit).not.toHaveBeenCalled();
});
