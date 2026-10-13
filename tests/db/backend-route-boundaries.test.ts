import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { POST as closeBatch } from "@/app/api/batches/[id]/close/route";
import { POST as discardBatch } from "@/app/api/batches/[id]/discard/route";
import { POST as openBatch } from "@/app/api/batches/[id]/open/route";
import { POST as checkout } from "@/app/api/billing/checkout/route";
import { POST as reconcileBilling } from "@/app/api/billing/reconcile/route";
import { POST as configAction } from "@/app/api/configs/[id]/route";
import { POST as resolveException } from "@/app/api/exceptions/[id]/route";
import { POST as bulkResolve } from "@/app/api/exceptions/bulk/route";
import { POST as changePassword } from "@/app/api/auth/password/route";
import { POST as recoverPayments } from "@/app/api/payments/recover/route";
import { POST as adjustments } from "@/app/api/runs/[id]/adjustments/route";
import { POST as createObligations } from "@/app/api/runs/[id]/obligations/route";
import { POST as planBatch } from "@/app/api/runs/[id]/plan/route";
import { GET as readinessGet, POST as readinessPost } from "@/app/api/runs/[id]/readiness/route";
import { POST as reconcileRun } from "@/app/api/runs/[id]/reconcile/route";
import { POST as retryReconciliation } from "@/app/api/runs/[id]/reconcile/retry/route";
import { POST as rejectRun } from "@/app/api/runs/[id]/reject/route";
import { GET as thresholdsGet, POST as thresholdsPost } from "@/app/api/runs/[id]/thresholds/route";
import { GET as namedViewGet, POST as namedViewPost } from "@/app/api/tables/[table]/named-views/[id]/route";
import { POST as proposeResources } from "@/app/api/views/resources/propose/route";
import { GET as compensationGet, POST as compensationPost } from "@/app/api/workers/[id]/effective-compensation/route";
import { POST as compensationPreview } from "@/app/api/workers/[id]/effective-compensation/preview/route";
import { POST as workerMetadata } from "@/app/api/workers/[id]/metadata/route";
import { POST as changeRecipient } from "@/app/api/workers/[id]/recipient/route";
import { admin, call, cookieFor, makeCompany, withId } from "./helpers";

type Handler = Parameters<typeof call>[0];
type RouteCase = { name: string; handler: Handler; method: "GET" | "POST"; path: string; ctx?: unknown };
const id = randomUUID();
const route = (name: string, handler: Handler, method: RouteCase["method"], path: string, ctx: unknown = withId(id)): RouteCase => ({ name, handler, method, path, ctx });
const cases: RouteCase[] = [
  route("batch close", closeBatch, "POST", `/api/batches/${id}/close`),
  route("batch discard", discardBatch, "POST", `/api/batches/${id}/discard`),
  route("batch open", openBatch, "POST", `/api/batches/${id}/open`),
  route("billing checkout", checkout, "POST", "/api/billing/checkout"),
  route("billing reconcile", reconcileBilling, "POST", "/api/billing/reconcile"),
  route("configuration action", configAction, "POST", `/api/configs/${id}`),
  route("single exception resolution", resolveException, "POST", `/api/exceptions/${id}`),
  route("bulk exception resolution", bulkResolve, "POST", "/api/exceptions/bulk"),
  route("password change", changePassword, "POST", "/api/auth/password"),
  route("payment recovery", recoverPayments, "POST", "/api/payments/recover"),
  route("run adjustments", adjustments, "POST", `/api/runs/${id}/adjustments`),
  route("run obligations", createObligations, "POST", `/api/runs/${id}/obligations`),
  route("payment plan", planBatch, "POST", `/api/runs/${id}/plan`),
  route("readiness read", readinessGet, "GET", `/api/runs/${id}/readiness`),
  route("readiness update", readinessPost, "POST", `/api/runs/${id}/readiness`),
  route("run reconciliation", reconcileRun, "POST", `/api/runs/${id}/reconcile`),
  route("reconciliation retry", retryReconciliation, "POST", `/api/runs/${id}/reconcile/retry`),
  route("run rejection", rejectRun, "POST", `/api/runs/${id}/reject`),
  route("threshold read", thresholdsGet, "GET", `/api/runs/${id}/thresholds`),
  route("threshold update", thresholdsPost, "POST", `/api/runs/${id}/thresholds`),
  route("named view read", namedViewGet, "GET", `/api/tables/workers/named-views/${id}`, { params: Promise.resolve({ table: "workers", id }) }),
  route("named view action", namedViewPost, "POST", `/api/tables/workers/named-views/${id}`, { params: Promise.resolve({ table: "workers", id }) }),
  route("resource proposal", proposeResources, "POST", "/api/views/resources/propose"),
  route("compensation read", compensationGet, "GET", `/api/workers/${id}/effective-compensation?effectiveFrom=2026-01-01`),
  route("compensation schedule", compensationPost, "POST", `/api/workers/${id}/effective-compensation`),
  route("compensation preview", compensationPreview, "POST", `/api/workers/${id}/effective-compensation/preview`),
  route("worker metadata", workerMetadata, "POST", `/api/workers/${id}/metadata`),
  route("worker recipient", changeRecipient, "POST", `/api/workers/${id}/recipient`),
];

const viewerDenied = cases.filter(({ name }) => !["password change", "readiness read", "named view read", "named view action"].includes(name));
let viewerCookie: string;

beforeAll(async () => {
  const company = await makeCompany();
  const { error } = await admin.from("memberships").update({ roles: ["VIEWER"] }).eq("company_id", company.id).eq("user_id", company.payment.id);
  if (error) throw new Error("viewer fixture update failed");
  viewerCookie = (await cookieFor(company.payment)).cookie;
});

it.each(cases)("$name rejects a request without a session", async ({ handler, method, path, ctx }) => {
  const response = await call(handler, { method, path, body: method === "POST" ? {} : undefined }, ctx);
  expect(response.status).toBe(401);
});

it.each(viewerDenied)("$name rejects a VIEWER before a protected mutation or restricted read", async ({ handler, method, path, ctx }) => {
  const response = await call(handler, { method, path, cookie: viewerCookie, body: method === "POST" ? {} : undefined }, ctx);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
});
