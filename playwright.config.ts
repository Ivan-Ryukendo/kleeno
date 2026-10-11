import { defineConfig, devices } from "@playwright/test";

// Disposable target first: E2E_ENV_FILE, else .env.test (kleeno-test), else .env. Specs refuse any host that is not loopback or the pinned kleeno-test.
for (const file of [process.env.E2E_ENV_FILE, ".env.test", ".env"]) { if (!file) continue; try { process.loadEnvFile(file); break; } catch { /* try the next file */ } }

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000, // hosted kleeno-test adds a network round trip per step
  expect: { timeout: 30_000 },
  reporter: "list",
  use: { baseURL: "http://localhost:3000", trace: "off", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1",
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    env: { SITE_MODE: "app", SITE_URL: "http://localhost:3000", NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ./tests/e2e/offline.mjs`.trim() },
    timeout: 120_000,
  },
});
