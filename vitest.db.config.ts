import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";

// Disposable targets only: a loopback Supabase (CI) or the one hosted kleeno-test project named in .env.test.
// .env.test wins when present, so the kleeno-dev keys in .env are never loaded for DB tests.
const testFile = fs.existsSync(".env.test");
try {
  process.loadEnvFile(testFile ? ".env.test" : ".env");
} catch {
  // no env file (CI): variables come from the environment
}

const target = process.env.SUPABASE_URL;
const host = target ? new URL(target).hostname : "";
const KLEENO_TEST_REF = "axcgcjpmcdujxkvroqox"; // the one hosted project DB tests may touch; pinned so a changed env cannot retarget dev/prod
const testRef = process.env.SUPABASE_TEST_PROJECT_REF;
const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(host);
const namedTestProject = testRef === KLEENO_TEST_REF && host === `${KLEENO_TEST_REF}.supabase.co`;
const forbidden = [process.env.SUPABASE_PROD_URL, readDotEnvUrl()].some((u) => u && new URL(u).origin === new URL(target ?? "http://x").origin);
if (!target || forbidden || !(loopback || namedTestProject)) {
  throw new Error("Database tests require a loopback SUPABASE_URL or the pinned kleeno-test project; every other remote target (dev, prod) is refused");
}
// Owner-level fixtures (asOwner) connect straight to Postgres: that URL must be loopback or belong to the same pinned project.
const dbUrl = process.env.SUPABASE_TEST_DB_URL;
if (dbUrl) {
  const u = new URL(dbUrl);
  const dbLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  const dbPinned = u.hostname === `db.${KLEENO_TEST_REF}.supabase.co` || (u.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(u.username) === `postgres.${KLEENO_TEST_REF}`);
  if (!(dbLoopback || dbPinned)) throw new Error("SUPABASE_TEST_DB_URL must be loopback or the pinned kleeno-test database");
}

// kleeno-dev lives in .env; read only its URL so it can be refused by name.
function readDotEnvUrl(): string | undefined {
  try {
    return fs.readFileSync(".env", "utf8").match(/^SUPABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
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
