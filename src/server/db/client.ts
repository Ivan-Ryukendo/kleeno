import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/server/env";

// Service-role client: the only write path (rule 32). Used by repositories and scripts, never by the browser.
let client: ReturnType<typeof make> | undefined;

function make() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export function db() {
  return (client ??= make());
}

export function must<T>(res: { data: T; error: { code?: string } | null }, what: string): NonNullable<T> {
  // Never surface raw driver messages (they can echo values); name the step and the code only.
  if (res.error || res.data == null) throw new Error(`db ${what} failed${res.error?.code ? ` (${res.error.code})` : ""}`);
  return res.data as NonNullable<T>;
}
