import { defineConfig } from "vitest/config";
import path from "node:path";
import { assertMigrationUpgradeTarget } from "./scripts/migration-upgrade-target";

// No env-file loader: destructive resets are reserved for the fresh CI local stack.
assertMigrationUpgradeTarget(process.env);
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts") } },
  test: { include: ["tests/migrations/**/*.test.ts"], fileParallelism: false, testTimeout: 180_000, hookTimeout: 180_000 },
});
