import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as columnRoute } from "@/app/api/views/resources/route";
import { POST as inputRoute } from "@/app/api/views/resources/[id]/inputs/route";
import { GET as commentsGet, POST as commentsPost } from "@/app/api/views/comments/route";
import { GET as layoutGet, POST as layoutPost } from "@/app/api/views/layout/route";
import { POST as queryRoute } from "@/app/api/views/query/route";
import { defaultView } from "@/core/views";
import { createWorker } from "@/server/db/workers";
import { admin, call, cookieFor, makeCompany, userClient, withId, type TestCompany } from "./helpers";

let a: TestCompany, b: TestCompany, cookieA: string, cookieB: string, paymentCookie: string, workerId: string, columnId: string, columnKey: string;
const canary = "CONFIDENTIAL-CELL-CANARY-41520";
beforeAll(async () => {
  a = await makeCompany(); b = await makeCompany();
  cookieA = (await cookieFor(a.payroll)).cookie; cookieB = (await cookieFor(b.payroll)).cookie; paymentCookie = (await cookieFor(a.payment)).cookie;
  workerId = (await createWorker({ companyId: a.id, userId: a.payroll.id, correlationId: randomUUID() }, { pseudonym: "W900", payType: "HOURLY", compensation: { baseAmount: 0n, hourlyRate: 1_000_000n } })).id;
  const created = await call(columnRoute, { cookie: cookieA, body: { definition: { label: "Capacity", policy: null, rule: { kind: "INPUT", type: "number" } }, reason: canary } });
  expect(created.status).toBe(200);
  const column = await created.json(); columnId = column.id; columnKey = column.columnKey;
});

describe("tenant-scoped resources and immutable source revisions", () => {
  it("rejects wrong roles and forged tenant fields", async () => {
    const body = { definition: { label: "A", policy: null, rule: { kind: "INPUT", type: "text" } }, reason: "review" };
    expect((await call(columnRoute, { cookie: paymentCookie, body })).status).toBe(403);
    expect((await call(columnRoute, { cookie: cookieA, body: { ...body, companyId: b.id } })).status).toBe(400);
  });
  it("saves reviewed evidence, prevents stale edits and never reveals the resource to a payment-only role", async () => {
    const body = { workerId, input: { value: "12.5", sourceRef: "HR register", reason: canary }, expectedVersion: null };
    expect((await call(inputRoute, { cookie: cookieA, body }, withId(columnId))).status).toBe(200);
    expect((await call(inputRoute, { cookie: cookieA, body }, withId(columnId))).status).toBe(409);
    expect((await call(inputRoute, { cookie: cookieB, body }, withId(columnId))).status).toBe(400);
    const view = { ...defaultView("workers", a.payroll.roles), columns: ["code", columnKey] };
    const result = await (await call(queryRoute, { cookie: cookieA, body: { view, runId: null } })).json();
    expect(result.rows[0][columnKey]).toBe("12.5");
    expect(result.rowIds).toEqual([workerId]);
    expect((await call(queryRoute, { cookie: paymentCookie, body: { view, runId: null } })).status).toBe(400);
    const row = (await admin.from("resource_inputs").select("id,input_enc").eq("company_id", a.id).single()).data!;
    expect(row.input_enc).not.toContain(canary);
    expect((await admin.from("resource_inputs").update({ input_enc: "tampered" }).eq("id", row.id)).error).toBeTruthy();
    expect((await (await userClient(b.payroll)).from("resource_inputs").select("id").eq("company_id", a.id)).data).toEqual([]);
  });
});

describe("personal layout and authorized stable cell threads", () => {
  it("preserves order privately and rejects a stale saved version", async () => {
    const view = { ...defaultView("workers", a.payroll.roles), columns: [columnKey, "code"] };
    expect((await call(layoutPost, { cookie: cookieA, body: { view, expectedVersion: null } })).status).toBe(200);
    expect((await call(layoutPost, { cookie: cookieA, body: { view, expectedVersion: null } })).status).toBe(409);
    const own = await (await call(layoutGet, { method: "GET", cookie: cookieA, path: "/api/views/layout?table=workers" })).json();
    expect(own.view.columns).toEqual([columnKey, "code"]);
    expect((await (await call(layoutGet, { method: "GET", cookie: paymentCookie, path: "/api/views/layout?table=workers" })).json()).view).toBeNull();
  });
  it("binds comments to actual cells and encrypts content without granting workflow authority", async () => {
    const target = { table: "workers", runId: null, rowId: workerId, columnId: columnKey };
    expect((await call(commentsPost, { cookie: cookieA, body: { ...target, text: canary } })).status).toBe(200);
    expect((await call(commentsPost, { cookie: cookieB, body: { ...target, text: "intrusion" } })).status).toBe(400);
    expect((await call(commentsPost, { cookie: cookieA, body: { ...target, rowId: randomUUID(), text: "wrong row" } })).status).toBe(404);
    expect((await call(commentsPost, { cookie: cookieA, body: { ...target, text: "grant authority", approved: true } })).status).toBe(400);
    const result = await (await call(commentsGet, { method: "GET", cookie: cookieA, path: `/api/views/comments?table=workers&rowId=${workerId}&columnId=${columnKey}` })).json();
    expect(result.comments[0].text).toBe(canary);
    const row = (await admin.from("cell_comments").select("id,text_enc").eq("company_id", a.id).single()).data!;
    expect(row.text_enc).not.toContain(canary);
    expect((await admin.from("cell_comments").delete().eq("id", row.id)).error).toBeTruthy();
    const audit = (await admin.from("audit_events").select("event,refs").eq("company_id", a.id)).data!;
    expect(audit.some((e) => e.event === "cell_comments.reviewed")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(canary);
  });
});
