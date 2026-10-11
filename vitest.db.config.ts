import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";

// Disposable targets only: a loopback Supabase (CI) or the one hosted kleeno-test project named in .env.test.
// Never fall back to owner environment files; CI supplies loopback settings directly.
try {
  if (fs.existsSync(".env.test")) process.loadEnvFile(".env.test");
} catch {
  // no env file (CI): variables come from the environment
}

const target = process.env.SUPABASE_URL;
const host = target ? new URL(target).hostname : "";
const KLEENO_TEST_REF = "axcgcjpmcdujxkvroqox"; // the one hosted project DB tests may touch; pinned so a changed env cannot retarget dev/prod
const testRef = process.env.SUPABASE_TEST_PROJECT_REF;
const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(host);
const namedTestProject = testRef === KLEENO_TEST_REF && host === `${KLEENO_TEST_REF}.supabase.co`;
// Optional non-secret deny target for isolated test harnesses; never inspect production configuration.
const denyTarget = process.env.DB_TEST_FORBIDDEN_URL;
const forbidden = denyTarget && target && new URL(denyTarget).origin === new URL(target).origin;
if (!target || forbidden || !(loopback || namedTestProject)) {
  throw new Error("Database tests require an isolated loopback SUPABASE_URL or the pinned kleeno-test project; every other remote target (dev, prod) is refused");
}
// Owner-level fixtures (asOwner) connect straight to Postgres: that URL must be loopback or belong to the same pinned project.
const dbUrl = process.env.SUPABASE_TEST_DB_URL;
if (dbUrl) {
  const u = new URL(dbUrl);
  // pg-connection-string copies every query param (e.g. ?host=other) over the checked host, so none are allowed.
  if (u.search || u.hash) throw new Error("SUPABASE_TEST_DB_URL must not carry a query string or fragment");
  const dbLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  const dbPinned = u.hostname === `db.${KLEENO_TEST_REF}.supabase.co` || (u.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(u.username) === `postgres.${KLEENO_TEST_REF}`);
  if (!(dbLoopback || dbPinned)) throw new Error("SUPABASE_TEST_DB_URL must be loopback or the pinned kleeno-test database");
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/db/**/*.test.ts"],
    testTimeout: loopback ? 60_000 : 300_000, // hosted kleeno-test is a network round trip per step
    hookTimeout: 120_000,
    fileParallelism: false,
    passWithNoTests: true,
  },
});
