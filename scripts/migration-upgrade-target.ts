export function assertMigrationUpgradeTarget(env: Record<string, string | undefined>) {
  const fail = () => { throw new Error("Migration upgrade tests require explicit disposable CI loopback targets"); };
  if (env.CI !== "true" || env.MIGRATION_UPGRADE_TEST !== "1") fail();
  const parse = (value: string | undefined) => {
    if (!value || !URL.canParse(value)) return fail();
    const url = new URL(value);
    if (url.search || url.hash || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) fail();
    return url;
  };
  const api = parse(env.SUPABASE_URL), browser = parse(env.NEXT_PUBLIC_SUPABASE_URL), db = parse(env.SUPABASE_TEST_DB_URL);
  for (const url of [api, browser]) if (url.protocol !== "http:" || url.port !== "54321" || url.pathname !== "/" || url.username || url.password) fail();
  if (browser.origin !== api.origin || !["postgres:", "postgresql:"].includes(db.protocol) || db.port !== "54322" || db.pathname !== "/postgres") fail();
  if (env.DB_TEST_FORBIDDEN_URL && (!URL.canParse(env.DB_TEST_FORBIDDEN_URL) || new URL(env.DB_TEST_FORBIDDEN_URL).origin === api.origin)) fail();
}

/** Retry only read probes while the disposable API reconnects after a database reset. */
export async function waitForMigrationApi(probe: () => PromiseLike<{ error: unknown; status: number }>) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await probe();
    if (!result.error) return;
    if (result.status !== 0) throw new Error("Migration API readiness check failed");
    if (attempt < 19) await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Migration API transport unavailable after reset");
}
