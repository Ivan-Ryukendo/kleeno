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
it("allows only the pinned kleeno-test project among remote targets", () => {
  const withRef = (ref: string, url: string) => execFileSync(process.execPath, ["--import", "tsx", "--eval", "import('./vitest.db.config.ts')"], { env: { ...process.env, SUPABASE_URL: url, SUPABASE_TEST_PROJECT_REF: ref, SUPABASE_PROD_URL: "https://production.example" }, stdio: "pipe", timeout: 20_000 });
  expect(() => withRef("axcgcjpmcdujxkvroqox", "https://axcgcjpmcdujxkvroqox.supabase.co")).not.toThrow();
  expect(() => withRef("abcdefghijklmnopqrst", "https://abcdefghijklmnopqrst.supabase.co")).toThrow("isolated loopback");
});
it("refuses an owner-fixture database URL that is not loopback or the pinned project", () => {
  expect(() => execFileSync(process.execPath, ["--import", "tsx", "--eval", "import('./vitest.db.config.ts')"], { env: { ...process.env, SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PROD_URL: "https://production.example", SUPABASE_TEST_DB_URL: "postgresql://u:p@db.abcdefghijklmnopqrst.supabase.co:5432/postgres" }, stdio: "pipe", timeout: 20_000 })).toThrow("pinned kleeno-test database");
});
