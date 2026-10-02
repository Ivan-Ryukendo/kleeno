// P3 slice 1: AI policy -> config in HUMAN_REVIEW, flag confirmation, immutable executions, company isolation (S13, S19, S22).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { TransitionError } from "@/core/domain/machines";
import { WorkflowError } from "@/core/workflow";
import { proposeConfig } from "@/server/ai/policy";
import { configAction } from "@/server/db/configs";
import { GOOD, POLICY_TEXT, scripted } from "../fixtures/ai/policy";
import { admin, makeCompany, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
const who = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, role: c.payroll.role, correlationId: randomUUID() });
const guessed = { ...GOOD, params: { ...GOOD.params!, overtimeMultiplier: "2" } };

beforeAll(async () => {
  a = await makeCompany();
  b = await makeCompany();
});

describe("proposeConfig", () => {
  it("a valid proposal lands in HUMAN_REVIEW with an immutable AI execution and AI audit events", async () => {
    const r = await proposeConfig(who(a), POLICY_TEXT, scripted([GOOD]));
    expect(r).toMatchObject({ status: "ACCEPTED", flags: [] });
    const cfg = (await admin.from("payroll_configurations").select("status, ai_execution_id").eq("id", r.config!.id).single()).data!;
    expect(cfg).toMatchObject({ status: "HUMAN_REVIEW", ai_execution_id: r.executionId });

    const exec = (await admin.from("ai_executions").select("*").eq("id", r.executionId).single()).data!;
    expect(exec).toMatchObject({ operation: "POLICY_INTERPRET", status: "ACCEPTED", retries: 0, provider: "fake", model: "fake-model" });
    expect(JSON.stringify(exec)).not.toContain("Full-time staff"); // the input is never stored, only its reference
    expect((await admin.from("ai_executions").update({ status: "REPAIRED" }).eq("id", r.executionId)).error).not.toBeNull();
    expect((await admin.from("ai_executions").delete().eq("id", r.executionId)).error).not.toBeNull();

    const audit = (await admin.from("audit_events").select("event, actor_type").eq("entity_id", r.config!.id)).data!;
    expect(audit.filter((e) => e.actor_type === "ai").map((e) => e.event)).toEqual(["config.propose_ai"]);
  });

  it("a failed pipeline records the execution and creates no config", async () => {
    const before = (await admin.from("payroll_configurations").select("id").eq("company_id", b.id)).data!.length;
    const r = await proposeConfig(who(b), POLICY_TEXT, scripted(["nope"]));
    expect(r).toMatchObject({ status: "NEEDS_HUMAN_REVIEW", config: null });
    expect((await admin.from("ai_executions").select("status, retries").eq("id", r.executionId).single()).data).toEqual({ status: "NEEDS_HUMAN_REVIEW", retries: 2 });
    expect((await admin.from("payroll_configurations").select("id").eq("company_id", b.id)).data!.length).toBe(before);
  });

  it("a non-payroll role cannot propose", async () => {
    await expect(proposeConfig({ ...who(a), role: "PAYMENT_APPROVER" }, POLICY_TEXT, scripted([GOOD]))).rejects.toBeInstanceOf(WorkflowError);
  });
});

describe("flagged values", () => {
  it("approval needs an explicit confirmation, recorded with who and when; then the version is immutable", async () => {
    const r = await proposeConfig(who(a), POLICY_TEXT, scripted([guessed]));
    expect(r.flags).toHaveLength(1);
    const id = r.config!.id;
    await expect(configAction(who(a), id, "approve")).rejects.toMatchObject({ code: "FLAGS_UNCONFIRMED" });
    expect(await configAction(who(a), id, "approve", { confirmFlags: true })).toBe("APPROVED");
    const v = (await admin.from("payroll_configurations").select("validation").eq("id", id).single()).data!.validation;
    expect(v).toMatchObject({ confirmedBy: a.payroll.id });
    expect((await admin.from("payroll_configurations").update({ validation: { flags: [] } }).eq("id", id)).error).not.toBeNull();
  });

  it("an unflagged proposal approves without confirmation", async () => {
    const r = await proposeConfig(who(a), POLICY_TEXT, scripted([GOOD]));
    expect(await configAction(who(a), r.config!.id, "approve")).toBe("APPROVED");
  });
});

describe("S13 isolation", () => {
  it("another company cannot act on a config; its executions are invisible to it", async () => {
    const r = await proposeConfig(who(a), POLICY_TEXT, scripted([GOOD]));
    await expect(configAction(who(b), r.config!.id, "approve")).rejects.toBeInstanceOf(TransitionError);
    const seen = (await admin.from("ai_executions").select("id").eq("company_id", b.id).eq("id", r.executionId)).data!;
    expect(seen).toEqual([]);
  });
});
