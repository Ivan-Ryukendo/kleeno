import { afterEach, expect, it, vi } from "vitest";
import { postJson } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());
it("keeps the HTTP denial available so support threads can close on lost access", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Access changed" }, correlationId: "support-123" }), { status: 403 })));
  await expect(postJson("/api/support/ticket", {})).resolves.toEqual({ ok: false, status: 403, error: "Access changed (support code support-123)" });
});
