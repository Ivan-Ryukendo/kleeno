import { expect, it } from "vitest";
import { assertMigrationUpgradeTarget } from "../../scripts/migration-upgrade-target";

const local = { CI: "true", MIGRATION_UPGRADE_TEST: "1", SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_TEST_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" };

it("accepts only explicit disposable CI targets matching the local stack", () => {
  expect(() => assertMigrationUpgradeTarget(local)).not.toThrow();
});

it.each([
  { CI: undefined }, { MIGRATION_UPGRADE_TEST: undefined },
  { SUPABASE_URL: "https://axcgcjpmcdujxkvroqox.supabase.co" },
  { NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" },
  { SUPABASE_URL: "http://127.0.0.1:9999" },
  { SUPABASE_URL: "http://127.0.0.1:54321/other" },
  { SUPABASE_TEST_DB_URL: "postgresql://postgres:secret@remote.example:54322/postgres" },
  { SUPABASE_TEST_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres?host=remote.example" },
  { SUPABASE_TEST_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres#remote" },
  { SUPABASE_TEST_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/other" },
  { SUPABASE_TEST_DB_URL: "http://127.0.0.1:54322/postgres" },
  { DB_TEST_FORBIDDEN_URL: local.SUPABASE_URL },
  { SUPABASE_URL: "invalid-sensitive-url" },
])("refuses unsafe or unapproved targets without echoing their values: %j", change => {
  expect(() => assertMigrationUpgradeTarget({ ...local, ...change })).toThrow();
  try { assertMigrationUpgradeTarget({ ...local, ...change }); } catch (error) {
    expect(String(error)).not.toContain("secret");
    expect(String(error)).not.toContain("invalid-sensitive-url");
  }
});
