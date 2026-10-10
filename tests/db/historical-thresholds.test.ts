// Authored local isolated DB acceptance; no remote target is authorized.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadHistoricalThresholds, saveHistoricalThresholds } from "@/server/db/historical-thresholds";
import { admin, makeCompany, pendingRun, userClient } from "./helpers";

describe("encrypted immutable historical threshold acceptance", () => {
  it("checks current roles, exact replay/conflict/revisions, self-tenant reads and sign-off freeze", async () => {
    const company = await makeCompany(); const fixture = await pendingRun(company);
    const actor = { companyId: company.id, userId: company.payroll.id, roles: company.payroll.roles, correlationId: randomUUID() };
    const reader = await userClient(company.payroll);
    const input = { expectedRevision: 0, idempotencyKey: randomUUID(), rules: [{ id: "net-delta", component: null, absolute: "1000000", percent: null }] };
    const version = await saveHistoricalThresholds(reader, actor, fixture.runId, input);
    expect(version).toMatchObject({ revision: 1, rules: input.rules, canConfigure: true });
    expect(await saveHistoricalThresholds(reader, actor, fixture.runId, input)).toEqual(version);
    await expect(saveHistoricalThresholds(reader, actor, fixture.runId, { ...input, rules: [{ ...input.rules[0], absolute: "2000000" }] })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(saveHistoricalThresholds(reader, actor, fixture.runId, { ...input, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    const persisted = (await admin.from("historical_threshold_versions").select("id,payload_enc,configuration_hash").eq("company_id", company.id).eq("run_id", fixture.runId)).data!;
    expect(persisted).toHaveLength(1); expect(JSON.stringify(persisted)).not.toContain("1000000");
    expect((await admin.from("historical_threshold_versions").update({ payload_enc: "tamper" }).eq("id", version.version!)).error).not.toBeNull();
    expect((await reader.from("historical_threshold_versions").delete().eq("run_id", fixture.runId).select("id")).data ?? []).toEqual([]);
    const payment = { ...actor, userId: company.payment.id, roles: company.payment.roles };
    const paymentReader = await userClient(company.payment);
    expect((await loadHistoricalThresholds(paymentReader, payment, fixture.runId)).canConfigure).toBe(false);
    await expect(saveHistoricalThresholds(paymentReader, payment, fixture.runId, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreign = await makeCompany(); const foreignReader = await userClient(foreign.payroll);
    expect((await foreignReader.from("historical_threshold_versions").select("id").eq("run_id", fixture.runId)).data).toEqual([]);
    const calc = (await admin.from("calculations").select("id,calculation_hash").eq("company_id", company.id).eq("run_id", fixture.runId).single()).data!;
    // An immutable signed-review fixture exercises the settings freeze without inventing import readiness evidence.
    const signed = await admin.from("payroll_review_events").insert({ id: randomUUID(), company_id: company.id, run_id: fixture.runId, calculation_id: calc.id, calculation_hash: calc.calculation_hash, revision: 1, action: "SIGNOFF", actor_id: actor.userId, idempotency_key: randomUUID(), command_hash: "a".repeat(64), payload_enc: null, related_id: null });
    if (signed.error) throw new Error("threshold sign-off fixture failed");
    expect((await loadHistoricalThresholds(reader, actor, fixture.runId)).canConfigure).toBe(false);
    await expect(saveHistoricalThresholds(reader, actor, fixture.runId, { ...input, expectedRevision: 1, idempotencyKey: randomUUID(), rules: [] })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await saveHistoricalThresholds(reader, actor, fixture.runId, input)).version).toBe(version.version);
    const audit = (await admin.from("audit_events").select("refs").eq("company_id", company.id).eq("event", "review.thresholds")).data!;
    expect(audit).toHaveLength(1); expect(JSON.stringify(audit)).not.toContain("1000000");
  });
});
