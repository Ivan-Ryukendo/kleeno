import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

function loadConfig(url: string, production = "https://production.example") {
  return execFileSync(process.execPath, ["--import", "tsx", "--eval", "import('./vitest.db.config.ts')"], {
    env: { ...process.env, SUPABASE_URL: url, SUPABASE_PROD_URL: production },
    stdio: "pipe", timeout: 20_000,
  });
}
it("refuses remote database tests before loading test repositories", () => {
  expect(() => loadConfig("https://development.example")).toThrow("isolated loopback");
});
it("rejects a loopback address explicitly designated production", () => {
  expect(() => loadConfig("http://127.0.0.1:54321", "http://127.0.0.1:54321")).toThrow("isolated loopback");
});
it("allows an isolated loopback configuration without contacting it", () => {
  expect(() => loadConfig("http://127.0.0.1:54321")).not.toThrow();
});
