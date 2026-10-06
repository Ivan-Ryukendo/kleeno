import { defineConfig, devices } from "@playwright/test";

try { process.loadEnvFile(".env"); } catch { /* CI supplies its isolated environment. */ }

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3000", trace: "off", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: false,
    env: { SITE_MODE: "app", SITE_URL: "http://127.0.0.1:3000", NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ./tests/e2e/offline.mjs`.trim() },
    timeout: 120_000,
  },
});
