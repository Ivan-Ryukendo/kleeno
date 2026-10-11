import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

const testEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP };

function loadConfig(url: string, production = "https://production.example") {
  return execFileSync(process.execPath, ["--import", "tsx", "--eval", "import('./vitest.db.config.ts')"], {
    env: { ...testEnv, SUPABASE_URL: url, DB_TEST_FORBIDDEN_URL: production },
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
  const withRef = (ref: string, url: string) => execFileSync(process.execPath, ["--import", "tsx", "--eval", "import('./vitest.db.config.ts')"], { env: { ...testEnv, SUPABASE_URL: url, SUPABASE_TEST_PROJECT_REF: ref, DB_TEST_FORBIDDEN_URL: "https://production.example" }, stdio: "pipe", timeout: 20_000 });
  expect(() => withRef("axcgcjpmcdujxkvroqox", "https://axcgcjpmcdujxkvroqox.supabase.co")).not.toThrow();
  expect(() => withRef("abcdefghijklmnopqrst", "https://abcdefghijklmnopqrst.supabase.co")).toThrow("isolated loopback");
});
it("refuses an owner-fixture database URL that is not loopback or the pinned project", () => {
  expect(() => execFileSync(process.execPath, ["--import", "tsx", "--eval", "import('./vitest.db.config.ts')"], { env: { ...testEnv, SUPABASE_URL: "http://127.0.0.1:54321", DB_TEST_FORBIDDEN_URL: "https://production.example", SUPABASE_TEST_DB_URL: "postgresql://u:p@db.abcdefghijklmnopqrst.supabase.co:5432/postgres" }, stdio: "pipe", timeout: 20_000 })).toThrow("pinned kleeno-test database");
});
it("refuses an owner-fixture database URL with a query string that could override the host", () => {
  const run = (db: string) => execFileSync(process.execPath, ["--import", "tsx", "--eval", "import('./vitest.db.config.ts')"], { env: { ...testEnv, SUPABASE_URL: "http://127.0.0.1:54321", DB_TEST_FORBIDDEN_URL: "https://production.example", SUPABASE_TEST_DB_URL: db }, stdio: "pipe", timeout: 20_000 });
  expect(() => run("postgresql://u:p@127.0.0.1:54322/postgres?host=db.abcdefghijklmnopqrst.supabase.co")).toThrow("query string");
  expect(() => run("postgresql://u:p@127.0.0.1:54322/postgres?sslmode=disable")).toThrow("query string");
  expect(() => run("postgresql://u:p@127.0.0.1:54322/postgres")).not.toThrow();
});
