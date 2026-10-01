import { defineConfig } from "vitest/config";
import path from "node:path";

// DB tests run against a real Supabase (kleeno-dev locally; the local Supabase stack in CI, which sets the variables itself).
// Never against prod (tests/db/helpers.ts refuses).
try {
  process.loadEnvFile(".env");
} catch {
  // no .env (CI): variables come from the environment
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
