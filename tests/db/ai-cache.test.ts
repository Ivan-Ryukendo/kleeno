import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { proposeConfig } from "@/server/ai/policy";
import { GOOD, POLICY_TEXT, scripted } from "../fixtures/ai/policy";
import { admin, makeCompany, userClient } from "./helpers";

it("S72 cache is company/model/prompt/schema bound, encrypted, immutable and still creates a human-review proposal", async () => {
  const a = await makeCompany(), b = await makeCompany();
  const who = (c: typeof a) => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles, correlationId: randomUUID() });
  const first = await proposeConfig(who(a), POLICY_TEXT, { ...scripted([GOOD]), models: ["fake-model"] });
  const second = await proposeConfig(who(a), POLICY_TEXT, { name: "fake", models: ["fake-model"], complete: async () => { throw new Error("cache must avoid another call"); } });
  expect(second.cacheHit).toBe(true);
  expect(second.config?.id).not.toBe(first.config?.id);
  expect(second.executionId).not.toBe(first.executionId);
  expect((await admin.from("payroll_configurations").select("status").eq("id", second.config!.id).single()).data?.status).toBe("HUMAN_REVIEW");
  const row = (await admin.from("policy_proposal_cache").select("*").eq("company_id", a.id).single()).data!;
  expect(JSON.stringify(row)).not.toContain("Full-time staff");
  expect(row.payload_enc).toBeTruthy();
  expect((await admin.from("policy_proposal_cache").update({ model: "changed" }).eq("id", row.id)).error).not.toBeNull();
  const clientB = await userClient(b.payroll);
  expect((await clientB.from("policy_proposal_cache").select("id").eq("company_id", a.id)).data).toEqual([]);
  expect((await proposeConfig(who(b), POLICY_TEXT, { ...scripted([GOOD]), models: ["fake-model"] })).cacheHit).toBe(false);
  const miss = await proposeConfig(who(a), POLICY_TEXT, { name: "fake", models: ["changed-model"], complete: async () => { throw new Error("unavailable"); } });
  expect(miss.status).toBe("NEEDS_HUMAN_REVIEW");
});
