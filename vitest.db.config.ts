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
const testRef = process.env.SUPABASE_TEST_PROJECT_REF;
const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(host);
const namedTestProject = !!testRef && /^[a-z0-9]{20}$/.test(testRef) && host === `${testRef}.supabase.co`;
const forbidden = [process.env.SUPABASE_PROD_URL, readDotEnvUrl()].some((u) => u && new URL(u).origin === new URL(target ?? "http://x").origin);
if (!target || forbidden || !(loopback || namedTestProject)) {
  throw new Error("Database tests require a loopback SUPABASE_URL or the kleeno-test project named by SUPABASE_TEST_PROJECT_REF; every other remote target (dev, prod) is refused");
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
