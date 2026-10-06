// P3 slice 1: AI policy -> config in HUMAN_REVIEW, flag confirmation, immutable executions, company isolation (S13, S19, S22).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { WorkflowError } from "@/core/workflow";
import { proposeConfig } from "@/server/ai/policy";
import { configAction, createConfigDraft } from "@/server/db/configs";
import { GOOD, POLICY_TEXT, scripted } from "../fixtures/ai/policy";
import { activeConfig, admin, CONFIG_PARAMS, makeCompany, userClient, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
const who = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles, correlationId: randomUUID() });
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
    await expect(proposeConfig({ ...who(a), roles: ["PAYMENT_APPROVER"] }, POLICY_TEXT, scripted([GOOD]))).rejects.toBeInstanceOf(WorkflowError);
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
    await expect(configAction(who(b), r.config!.id, "approve")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const seen = (await admin.from("ai_executions").select("id").eq("company_id", b.id).eq("id", r.executionId)).data!;
    expect(seen).toEqual([]);
  });
});

describe("S18 atomic configuration activation", () => {
  it("invalid, absent and foreign targets leave the active configuration and its audit unchanged", async () => {
    const c = await makeCompany(), other = await makeCompany();
    const current = await activeConfig(c), foreign = await activeConfig(other);
    const draft = await createConfigDraft(who(c), { params: CONFIG_PARAMS, clauses: [{ id: "C1", text: "Synthetic baseline policy." }] });
    for (const [id, code] of [[draft.id, "INVALID_TRANSITION"], [current.id, "INVALID_TRANSITION"], [randomUUID(), "NOT_FOUND"], [foreign.id, "NOT_FOUND"]]) {
      await expect(configAction(who(c), id, "activate")).rejects.toMatchObject({ code });
      expect((await admin.from("payroll_configurations").select("id").eq("company_id", c.id).eq("status", "ACTIVE")).data).toEqual([{ id: current.id }]);
    }
    expect((await admin.from("audit_events").select("id").eq("entity_id", current.id).eq("event", "config.supersede")).data).toEqual([]);
  });

  it("concurrent activation of the same target wins once and audits the replacement exactly once", async () => {
    const c = await makeCompany(), current = await activeConfig(c);
    const proposal = await proposeConfig(who(c), POLICY_TEXT, scripted([GOOD]));
    const id = proposal.config!.id;
    await configAction(who(c), id, "approve");
    const actor = who(c);
    const results = await Promise.allSettled([configAction(actor, id, "activate"), configAction(actor, id, "activate")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "INVALID_TRANSITION" });
    expect((await admin.from("payroll_configurations").select("id").eq("company_id", c.id).eq("status", "ACTIVE")).data).toEqual([{ id }]);
    const events = (await admin.from("audit_events").select("entity_id,event,correlation_id,refs").eq("company_id", c.id).eq("correlation_id", actor.correlationId)).data!;
    expect(events).toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity_id: current.id, event: "config.supersede", refs: { from: "ACTIVE", to: "SUPERSEDED" } }),
      expect.objectContaining({ entity_id: id, event: "config.activate", refs: { from: "APPROVED", to: "ACTIVE" } }),
    ]));
  });

  it("activation is service-only and rechecks the actor's current role without changing either version", async () => {
    const c = await makeCompany(), current = await activeConfig(c);
    const proposal = await proposeConfig(who(c), POLICY_TEXT, scripted([GOOD]));
    const id = proposal.config!.id;
    await configAction(who(c), id, "approve");
    const args = { p_company: c.id, p_id: id, p_actor: c.payroll.id, p_correlation: randomUUID() };
    const reader = await userClient(c.payroll);
    expect((await reader.rpc("activate_payroll_config", args)).error).not.toBeNull();
    expect((await admin.rpc("activate_payroll_config", { ...args, p_actor: c.payment.id })).data).toBe("FORBIDDEN");
    expect((await admin.from("payroll_configurations").select("id").eq("company_id", c.id).eq("status", "ACTIVE")).data).toEqual([{ id: current.id }]);
    expect((await admin.from("payroll_configurations").select("status").eq("id", id).single()).data).toEqual({ status: "APPROVED" });
    expect((await admin.from("audit_events").select("id").eq("entity_id", current.id).eq("event", "config.supersede")).data).toEqual([]);
    expect((await admin.from("memberships").update({ roles: ["OWNER", "VIEWER"] }).eq("company_id", c.id).eq("user_id", c.payroll.id)).error).toBeNull();
    await expect(configAction(who(c), id, "activate")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
