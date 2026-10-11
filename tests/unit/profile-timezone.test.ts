import { beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ from: vi.fn(), schema: vi.fn(), writes: [] as unknown[], reads: [] as { table: string; filters: [string, unknown][] }[], member: true, timezone: null as string | null, companyTimezone: "Asia/Dhaka" as string | null }));
vi.mock("@/server/db/client", () => ({ db: () => calls, must: (value: { data: unknown; error: unknown }) => { if (value.error || value.data == null) throw new Error("database unavailable"); return value.data; } }));
vi.mock("@/server/auth/guard", () => ({ guarded: (_options: unknown, handler: unknown) => handler }));
import { loadProfileTimezone, saveProfileTimezone } from "@/server/db/profile-timezone";
import { GET, PATCH } from "@/app/api/profile/timezone/route";
const who = { userId: "current-user", companyId: "current-company" };

beforeEach(() => {
  vi.clearAllMocks(); calls.writes.length = 0; calls.reads.length = 0; calls.member = true; calls.timezone = null; calls.companyTimezone = "Asia/Dhaka";
  calls.schema.mockReturnValue(calls);
  calls.from.mockImplementation((table: string) => {
    const read = { table, filters: [] as [string, unknown][] }; calls.reads.push(read);
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { read.filters.push([key, value]); return query; }, is: (key: string, value: unknown) => { read.filters.push([key, value]); return query; },
      maybeSingle: async () => ({ data: table === "memberships" ? calls.member ? { user_id: who.userId } : null : table === "companies" ? { timezone: calls.companyTimezone } : calls.timezone === null ? null : { timezone: calls.timezone }, error: null }),
      upsert: (row: { user_id: string; timezone: string | null }, options: unknown) => { calls.writes.push({ row, options }); calls.timezone = row.timezone; return Promise.resolve({ error: null }); },
    };
    return query;
  });
});

it("loads only the actor's preference and active company fallback", async () => {
  expect(await loadProfileTimezone(who)).toMatchObject({ preferenceTimezone: null, companyTimezone: "Asia/Dhaka", timeZone: "Asia/Dhaka", source: "company" });
  expect(calls.reads.find(read => read.table === "user_preferences")?.filters).toEqual([["user_id", who.userId]]);
  expect(calls.reads.find(read => read.table === "memberships")?.filters).toEqual([["company_id", who.companyId], ["user_id", who.userId], ["removed_at", null]]);
  expect(calls.reads.find(read => read.table === "companies")?.filters).toEqual([["id", who.companyId]]);
});
it("writes only authenticated identity and clearing restores fallback", async () => {
  expect(await saveProfileTimezone(who, { timezone: "America/New_York" })).toMatchObject({ timeZone: "America/New_York", source: "user" });
  expect(calls.writes[0]).toEqual({ row: { user_id: who.userId, timezone: "America/New_York" }, options: { onConflict: "user_id" } });
  expect(await saveProfileTimezone(who, { timezone: null })).toMatchObject({ timeZone: "Asia/Dhaka", source: "company" });
});
it("refuses invalid preferences and user/company injection before writing", async () => {
  await expect(saveProfileTimezone(who, { timezone: "UTC+6" })).rejects.toThrow();
  await expect(saveProfileTimezone(who, { timezone: "UTC", userId: "other" })).rejects.toThrow();
  expect(calls.writes).toHaveLength(0);
});
it("refuses removed company membership before reading or changing preferences", async () => {
  calls.member = false;
  await expect(loadProfileTimezone(who)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(saveProfileTimezone(who, { timezone: "UTC" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(calls.writes).toHaveLength(0);
  expect(calls.reads.every(read => read.table === "memberships")).toBe(true);
});
it("uses UTC if neither stored preference nor company timezone is valid", async () => {
  calls.timezone = "invalid"; calls.companyTimezone = "bad-zone";
  expect(await loadProfileTimezone(who)).toMatchObject({ timeZone: "UTC", source: "utc", label: "UTC" });
});
it("wires GET/PATCH to actor context (schema enforcement is verified by DB handler tests)", async () => {
  const read = await GET({ actor: who } as never);
  expect(read.headers.get("Cache-Control")).toBe("no-store");
  expect(await read.json()).toMatchObject({ timeZone: "Asia/Dhaka" });
  const saved = await PATCH({ actor: who, body: { timezone: "UTC" } } as never);
  expect(saved.headers.get("Cache-Control")).toBe("no-store");
  expect(await saved.json()).toMatchObject({ timeZone: "UTC", source: "user" });
});
