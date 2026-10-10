import { defineConfig } from "vitest/config";
import path from "node:path";

// Disposable loopback Supabase only; reject remote targets before test repositories load.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env (CI): variables come from the environment
}

const target = process.env.SUPABASE_URL;
if (!target || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(target).hostname)
  || (process.env.SUPABASE_PROD_URL && new URL(target).origin === new URL(process.env.SUPABASE_PROD_URL).origin)) {
  throw new Error("Database tests require an isolated loopback SUPABASE_URL; remote and production targets are refused");
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
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    passWithNoTests: true,
  },
});
