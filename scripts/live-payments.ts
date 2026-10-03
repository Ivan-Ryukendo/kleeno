// Kill switch of the dev company. `on` needs a provisioned company with a payroll approver and a different payment approver
// (the database checks it); the Owner can also do it in the app with password + authenticator code (S66). Audited.
// Usage: npm run script -- scripts/live-payments.ts on|off [--close-open-runs]
//   --close-open-runs (with off): also closes every OPEN guard run and returns the unpaid funds to the approver wallet.
import { closeAllOpen } from "@/server/payments/execute";
import { db, must } from "@/server/db/client";
import { COMPANY_ID, fail } from "./_lib";

async function main() {
  const mode = process.argv[2];
  const closeRuns = process.argv.includes("--close-open-runs");
  if ((mode !== "on" && mode !== "off") || (closeRuns && mode !== "off")) fail("usage: live-payments.ts on|off [--close-open-runs]");
  const enabled = mode === "on";
  must(await db().from("companies").update({ live_payments_enabled: enabled }).eq("id", COMPANY_ID).select("id"), "switch");
  must(
    await db().from("audit_events").insert({ company_id: COMPANY_ID, event: "LIVE_PAYMENTS_SWITCHED", entity_type: "company", entity_id: COMPANY_ID, actor: "script", refs: { enabled } }).select("id"),
    "audit",
  );
  console.log(`live payments ${mode.toUpperCase()} for ${COMPANY_ID}`);
  if (closeRuns) {
    const { closed, skipped } = await closeAllOpen(COMPANY_ID, { id: "script", type: "script" });
    console.log(`closed ${closed.length} open run(s); ${skipped.length} left open because a payment is in flight (recover it, then run this again)`);
  }
}

main().catch((e) => {
  console.error("live-payments failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
