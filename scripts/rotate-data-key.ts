// Rotates DATA_ENCRYPTION_KEY (S41): set the new key as DATA_ENCRYPTION_KEY=v<N+1>:<secret> and the old one as
// DATA_ENCRYPTION_KEY_PREVIOUS=v<N>:<secret>, then run this. It re-wraps each company's data key; field ciphertext is untouched.
// Idempotent. Drop DATA_ENCRYPTION_KEY_PREVIOUS only after this reports 0 remaining on every environment.
import { rewrapCompanyKey } from "@/server/crypto";
import { db, must } from "@/server/db/client";

async function main() {
  const rows = must(await db().from("company_keys").select("company_id"), "company keys read");
  let done = 0;
  for (const r of rows) if (await rewrapCompanyKey(r.company_id)) done++;
  console.log(`re-wrapped ${done} of ${rows.length} company keys`);
}

main().catch((e) => {
  console.error("rotation failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
