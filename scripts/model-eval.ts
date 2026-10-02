// Model eval (ARCHITECTURE 7): runs the synthetic policy fixture through the real pipeline on each model, N times, and prints
// how often it was ACCEPTED first try / REPAIRED / sent to a human. Synthetic data only; costs a few cents per run.
// Usage: npm run script -- scripts/model-eval.ts <model[,model...]> [runs=3] [verbose]
import { runValidated } from "@/core/ai";
import { policyInput } from "@/core/ai/inputs/policy";
import { policySpec } from "@/core/ai/policy";
import { splitPolicy } from "@/core/config";
import { openRouterProvider } from "@/server/ai/openrouter";
import { env } from "@/server/env";
import { POLICY_TEXT } from "../tests/fixtures/ai/policy";
import { fail } from "./_lib";

const models = (process.argv[2] ?? env.OPENROUTER_MODEL).split(",");
const runs = Number(process.argv[3] ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 10) fail("runs must be 1-10");

async function main() {
  const clauses = splitPolicy(POLICY_TEXT);
  for (const model of models) {
    const provider = openRouterProvider({ apiKey: env.OPENROUTER_API_KEY, models: [model] });
    const tally: Record<string, number> = { ACCEPTED: 0, REPAIRED: 0, NEEDS_HUMAN_REVIEW: 0 };
    const notes: string[] = [];
    for (let i = 0; i < runs; i++) {
      const r = await runValidated(provider, policySpec(clauses), policyInput(clauses, "eval"));
      tally[r.status]++;
      if (process.argv[4] === "verbose") console.log(`  run ${i + 1} output: ${JSON.stringify(r.output?.params)} | rejected attempts: ${JSON.stringify(r.repairs)}`);
      if (r.problems.length || r.flags.length) notes.push(`run ${i + 1}: ${[...r.problems, ...r.flags].join("; ")}`);
    }
    console.log(`${model}: ${JSON.stringify(tally)} of ${runs}`);
    for (const n of notes) console.log(`  ${n}`);
  }
}

main().catch((e) => {
  console.error("model-eval failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
