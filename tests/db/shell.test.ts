// P4u: the app shell's read-only queries (Ctrl+K index, bell to-dos, sidebar exception count). Real RLS, real sessions.
// They are scoped by the session's company and roles, never show names or amounts, and fail soft.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { shellData } from "@/server/db/shell";
import { ADDR, activeConfig, admin, approvedRun, CANARY_BASE, makeCompany, pendingRun, proposedBatch, userClient, type TestCompany, type TestUser } from "./helpers";

let c: TestCompany;
let other: TestCompany;
let pendingRunId: string;
let approvedRunId: string;

const view = async (co: TestCompany, u: TestUser, roles = u.roles) => shellData(await userClient(u, co.id), { companyId: co.id, userId: u.id, roles });
const setRoles = (u: TestUser, roles: string[]) => admin.from("memberships").update({ roles }).eq("user_id", u.id).eq("company_id", c.id);

beforeAll(async () => {
  c = await makeCompany({ live: true });
  other = await makeCompany();
  const cfg = await activeConfig(c);
  const approved = await approvedRun(c, cfg, 1); // W101: payroll approved by c.payroll, obligation created
  approvedRunId = approved.runId;
  await proposedBatch(c, approved, null); // a plan waiting for a payment approver's signature
  const pending = await pendingRun(c, cfg, 2); // W102: waiting for payroll approval
  pendingRunId = pending.runId;
  // W102's address was set by hand by the payroll user and not confirmed yet.
  await admin.from("workers").update({ wallet_address: ADDR(0xbeef01), wallet_confirmed_address: null, wallet_set_by: c.payroll.id }).eq("id", pending.workerId);
  const ex = await admin.from("exceptions").insert({ id: randomUUID(), company_id: c.id, run_id: pendingRunId, worker_id: pending.workerId, category: "UNAPPROVED_OVERTIME", severity: "LOW", status: "OPEN" });
  if (ex.error) throw new Error(`exception insert failed: ${ex.error.message}`);
});

describe("to-dos follow the role", () => {
  it("payroll side: a run waiting for my approval and the open exceptions, with a matching sidebar count", async () => {
    const d = await view(c, c.payroll);
    expect(d.todos.map((t) => t.id).sort()).toEqual([`approve-${pendingRunId}`, `exceptions-${pendingRunId}`].sort());
    expect(d.todos.find((t) => t.id === `approve-${pendingRunId}`)?.href).toBe(`/runs/${pendingRunId}`);
    expect(d.todos.find((t) => t.id.startsWith("exceptions-"))?.reason).toMatch(/^1 open exception in /);
    expect(d.openExceptions).toBe(1);
  });

  it("payment side: the plan waiting for my signature and the address another role set; nothing from the payroll side", async () => {
    const d = await view(c, c.payment);
    expect(d.todos.map((t) => t.id).sort()).toEqual([`recipient-W102`, `sign-${approvedRunId}`].sort());
    expect(d.todos.find((t) => t.id === `sign-${approvedRunId}`)?.href).toBe(`/settlement?run=${approvedRunId}`);
    expect(d.openExceptions).toBe(0);
  });

  it("four-eyes: the person who approved the payroll or set the address is not asked to sign or confirm it", async () => {
    await setRoles(c.payroll, ["OWNER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"]);
    const d = await view(c, c.payroll, ["OWNER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"]);
    expect(d.todos.map((t) => t.id).some((id) => id.startsWith("sign-") || id.startsWith("recipient-"))).toBe(false);
    await setRoles(c.payroll, ["OWNER", "PAYROLL_APPROVER"]);
  });

  it("a viewer has no to-dos and no exception count", async () => {
    const d = await view(c, c.payment, ["VIEWER"]);
    expect(d.todos).toEqual([]);
    expect(d.openExceptions).toBe(0);
  });
});

describe("search index and isolation", () => {
  it("holds recent runs and worker codes of the session's company only", async () => {
    const d = await view(c, c.payroll);
    expect(d.runs.map((r) => r.id).sort()).toEqual([approvedRunId, pendingRunId].sort());
    expect(d.workerCodes).toEqual(["W101", "W102"]);
  });

  it("another company sees none of it", async () => {
    const d = await view(other, other.payroll);
    expect(d).toEqual({ todos: [], openExceptions: 0, runs: [], workerCodes: [] });
  });

  it("never carries amounts or names", async () => {
    const text = JSON.stringify(await view(c, c.payroll)) + JSON.stringify(await view(c, c.payment));
    expect(text).not.toContain(CANARY_BASE);
    expect(text).not.toMatch(/dbtest-/); // emails of the test members
  });

  it("fails soft: a broken client degrades to an empty shell instead of breaking the page", async () => {
    const broken = { from: () => { throw new Error("boom"); } } as never;
    expect(await shellData(broken, { companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles })).toEqual({ todos: [], openExceptions: 0, runs: [], workerCodes: [] });
  });
});
