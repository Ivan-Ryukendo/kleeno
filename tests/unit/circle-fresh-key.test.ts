// Review finding M2: Circle replays the first result for a repeated idempotency key, so a FAILED step must get a fresh key.
import { describe, expect, it } from "vitest";
import { CircleTxFailed, deterministicUuid, withFreshKeyOnFailure } from "@/server/circle/client";

describe("withFreshKeyOnFailure", () => {
  it("uses the stable key first, so a retry after a crash is exactly-once", async () => {
    const keys: string[] = [];
    await withFreshKeyOnFailure("openRun:b1", async (k) => void keys.push(k));
    expect(keys).toEqual([deterministicUuid("openRun:b1")]);
  });

  it("moves to a fresh key only after Circle reported a terminal failure", async () => {
    const keys: string[] = [];
    const out = await withFreshKeyOnFailure("openRun:b1", async (k) => {
      keys.push(k);
      if (keys.length < 3) throw new CircleTxFailed("circle transaction FAILED");
      return "ok";
    });
    expect(out).toBe("ok");
    expect(new Set(keys).size).toBe(3);
  });

  it("never gives a timeout a fresh key (the first attempt may still land)", async () => {
    const keys: string[] = [];
    await expect(
      withFreshKeyOnFailure("openRun:b1", async (k) => {
        keys.push(k);
        throw new Error("circle transaction timeout");
      }),
    ).rejects.toThrow("timeout");
    expect(keys).toHaveLength(1);
  });

  it("gives up after the cap", async () => {
    let n = 0;
    await expect(withFreshKeyOnFailure("x", async () => { n++; throw new CircleTxFailed("circle transaction DENIED"); }, 3)).rejects.toBeInstanceOf(CircleTxFailed);
    expect(n).toBe(3);
  });
});
