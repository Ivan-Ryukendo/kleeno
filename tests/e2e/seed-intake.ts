import { createHash, randomUUID } from "node:crypto";
import { parseUsdc } from "../../src/core/money";
import { env } from "../../src/server/env";
import { proposeConfig } from "../../src/server/ai/policy";
import { createWorker } from "../../src/server/db/workers";
import { GOOD, POLICY_TEXT } from "../fixtures/ai/policy";

// Child process for the intake browser spec (see ./seed.ts). Synthetic cached proposal, not a live-model call.
async function main() {
  const who = { companyId: process.env.SEED_COMPANY_ID!, userId: process.env.SEED_USER_ID!, roles: process.env.SEED_ROLES!.split(",") as never, correlationId: randomUUID() };
  // Match reviewDocuments' unchanged TXT provenance without importing its browser PDF worker into Node.
  const policyText = POLICY_TEXT.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join("\n");
  const documents = [{ id: randomUUID(), format: "txt" as const,
    contentHash: createHash("sha256").update(policyText).digest("hex"),
    clauses: policyText.split("\n").map((text, i) => ({ id: `C${String(i + 1).padStart(3, "0")}`, text, anchor: `paragraph:${i + 1}` })),
  }];
  const output = { ...GOOD, params: { ...GOOD.params!, rules: GOOD.params!.rules.map(r => ({ ...r, clauseIds: r.clauseIds.map(id => `C${id.slice(1).padStart(3, "0")}`) })) } };
  const prepared = await proposeConfig(who, policyText, {
    name: "openrouter", models: [env.OPENROUTER_MODEL, env.OPENROUTER_FALLBACK_MODEL],
    complete: async () => ({ model: env.OPENROUTER_MODEL, text: JSON.stringify(output) }),
  }, documents);
  const { id: workerId } = await createWorker(who, { pseudonym: "W001", payType: "HOURLY", compensation: { baseAmount: 0n, hourlyRate: parseUsdc("20") } });
  console.log(JSON.stringify({ status: prepared.status, workerId }));
}
main().catch(() => { console.error("intake seed failed"); process.exitCode = 1; });
