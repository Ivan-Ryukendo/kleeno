import { beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ download: vi.fn(), options: null as { roles: string[] } | null }));
vi.mock("@/server/auth/guard", () => ({ guarded: (options: { roles: string[] }, handler: unknown) => { calls.options = options; return handler; } }));
vi.mock("@/server/db/evidence-pack", () => ({ downloadEvidencePack: calls.download }));
import { GET } from "@/app/api/runs/[id]/evidence/route";

const id = "10000000-0000-4000-8000-000000000001";
const actor = { companyId: id, userId: id, roles: ["HR_APPROVER"] };
beforeEach(() => { calls.download.mockReset(); });

it("returns a private ZIP attachment with exact bytes and integrity header through financial-role guard", async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]);
  calls.download.mockResolvedValue({ bytes, filename: `kleeno-signed-calculation-v1-${id}.zip`, byteHash: "a".repeat(64) });
  const client = {};
  const response = await GET({ actor, client, params: { id } } as never);
  expect(calls.options?.roles).toEqual(["HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"]);
  expect(calls.download).toHaveBeenCalledWith(client, actor, id);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-content-sha256")).toBe("a".repeat(64));
  expect(response.headers.get("content-disposition")).toBe(`attachment; filename="kleeno-signed-calculation-v1-${id}.zip"`);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
});

it("rejects malformed IDs before repository access and propagates blocked evidence to the guard", async () => {
  await expect(GET({ actor, client: {}, params: { id: "not-a-run" } } as never)).rejects.toThrow();
  expect(calls.download).not.toHaveBeenCalled();
  calls.download.mockRejectedValue(new Error("Evidence blocked"));
  await expect(GET({ actor, client: {}, params: { id } } as never)).rejects.toThrow("Evidence blocked");
});
