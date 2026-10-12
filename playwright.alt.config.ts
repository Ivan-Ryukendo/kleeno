import { defineConfig, devices } from "@playwright/test";

// CI supplies loopback settings; local runs may load only the designated test file.
try { process.loadEnvFile(".env.test"); } catch { /* CI supplies its isolated environment. */ }

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000, // hosted kleeno-test adds a network round trip per step
  expect: { timeout: 30_000 },
  reporter: "list",
  use: { baseURL: "http://localhost:3100", trace: "off", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx next start --hostname 127.0.0.1 --port 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    env: { SITE_MODE: "app", SITE_URL: "http://localhost:3100", NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ./tests/e2e/offline.mjs`.trim() },
    timeout: 120_000,
  },
});
