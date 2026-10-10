import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { proposeConfig } from "@/server/ai/policy";
import { policyDuplicateWarnings } from "@/server/db/policy-cache";
import { createConfigDraft } from "@/server/db/configs";
import { GOOD, POLICY_TEXT, scripted } from "../fixtures/ai/policy";
import { admin, CONFIG_PARAMS, makeCompany, userClient, type TestCompany } from "./helpers";

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

it("S72 duplicate warnings are tenant-local before the recent-20 bound and compare exact, near and old clauses", async () => {
  const local = await makeCompany(), other = await makeCompany();
  const save = (company: TestCompany, text: string) => createConfigDraft(
    { companyId: company.id, userId: company.payroll.id, roles: company.payroll.roles },
    { params: CONFIG_PARAMS, clauses: [{ id: "C1", text }] },
  );
  const token = randomUUID();
  const oldLocal = `OLDLOCAL${token}`;
  const exact = "Employees may receive overtime for approved hours at two times the hourly rate.";
  const near = "Employees may receive overtime for approved hours at two times their hourly rate.";
  const foreign = `FOREIGN${token} applies only to the separate company and must never appear in this tenant review.`;

  // These are company-local immutable versions: v1 falls outside its latest 20 after the loop.
  await save(local, oldLocal);
  await save(local, exact);
  await save(local, near);
  for (let version = 4; version <= 21; version++) {
    await save(local, `Unrelated local policy clause ${token} filler version ${version}.`);
  }
  // More than 20 higher-numbered foreign versions would evict local matches if the limit
  // were applied to a cross-tenant corpus before the company predicate.
  for (let version = 1; version <= 25; version++) {
    await save(other, `${foreign} foreign version ${version}.`);
  }

  const warnings = await policyDuplicateWarnings(local.id, [{ id: "PROBE", text: exact }]);
  expect(warnings.some(warning => warning.includes("exact duplicate of v2/C1"))).toBe(true);
  expect(warnings.some(warning => warning.includes("near duplicate of v3/C1"))).toBe(true);
  expect(await policyDuplicateWarnings(local.id, [{ id: "OLD", text: oldLocal }])).toEqual([]);
  expect(await policyDuplicateWarnings(local.id, [{ id: "FOREIGN", text: foreign }])).toEqual([]);
});
