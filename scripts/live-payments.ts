// Kill switch. `on` exists only here (rule 17); `off` also exists in the UI from P4. Audited.
// Usage: npm run script -- scripts/live-payments.ts on|off
import { db, must } from "@/server/db/client";
import { COMPANY_ID, fail } from "./_lib";

async function main() {
  const mode = process.argv[2];
  if (mode !== "on" && mode !== "off") fail("usage: live-payments.ts on|off");
  const enabled = mode === "on";
  must(await db().from("companies").update({ live_payments_enabled: enabled }).eq("id", COMPANY_ID).select("id"), "switch");
  must(
    await db().from("audit_events").insert({ company_id: COMPANY_ID, event: "LIVE_PAYMENTS_SWITCHED", entity_type: "company", entity_id: COMPANY_ID, actor: "script", refs: { enabled } }).select("id"),
    "audit",
  );
  console.log(`live payments ${mode.toUpperCase()} for ${COMPANY_ID}`);
}

main().catch((e) => {
  console.error("live-payments failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
