import { execFileSync } from "node:child_process";

// Browser specs seed through their own tsx process (same entry as npm run seed:demo): Playwright's loader cannot resolve @/ aliases in
// lazily imported server modules on newer Node 22, so no spec imports src/server code in-process.
function runTsx(script: string, env: Record<string, string>) {
  const out = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--conditions=react-server", script], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 600_000 });
  return JSON.parse(out.trim().split(String.fromCharCode(10)).pop()!.trim());
}

export function seedDemo(companyId: string, userId: string) {
  return runTsx("scripts/seed-demo.ts", { DEMO_COMPANY_ID: companyId, DEMO_OWNER_ID: userId }) as { runId: string; mode: string; status: string };
}

/** Intake spec: an ACCEPTED synthetic policy proposal plus worker W001 (hourly 20 USDC), created by tests/e2e/seed-intake.ts. */
export function seedIntake(companyId: string, userId: string, roles: readonly string[]) {
  return runTsx("tests/e2e/seed-intake.ts", { SEED_COMPANY_ID: companyId, SEED_USER_ID: userId, SEED_ROLES: roles.join(",") }) as { status: string; workerId: string };
}
