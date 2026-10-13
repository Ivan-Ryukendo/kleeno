import { afterEach, expect, it, vi } from "vitest";
import { assertMigrationUpgradeTarget, waitForMigrationApi } from "../../scripts/migration-upgrade-target";

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

afterEach(() => vi.useRealTimers());

it("probes only reads after reset until a transport failure recovers", async () => {
  vi.useFakeTimers();
  const probe = vi.fn().mockResolvedValueOnce({ error: {}, status: 0 }).mockResolvedValue({ error: null, status: 200 });
  const pending = waitForMigrationApi(probe);
  await vi.runAllTimersAsync();
  await pending;
  expect(probe).toHaveBeenCalledTimes(2);
});

it("refuses semantic or HTTP errors immediately instead of retrying", async () => {
  const probe = vi.fn().mockResolvedValue({ error: { code: "42501" }, status: 403 });
  await expect(waitForMigrationApi(probe)).rejects.toThrow("Migration API readiness check failed");
  expect(probe).toHaveBeenCalledTimes(1);
});

it("bounds repeated transport failures without proceeding to fixture writes", async () => {
  vi.useFakeTimers();
  const probe = vi.fn().mockResolvedValue({ error: {}, status: 0 });
  const pending = expect(waitForMigrationApi(probe)).rejects.toThrow("Migration API transport unavailable after reset");
  await vi.runAllTimersAsync();
  await pending;
  expect(probe).toHaveBeenCalledTimes(20);
});
