import { describe, expect, it } from "vitest";
import { runGate } from "@/core/payments/gate";
import { baseContext, FakeChain, FakeRepo } from "../invariants/payments/harness";

describe("standing authorization remains live at the single payment gate", () => {
  it.each([false, undefined])("refuses expired, revoked, removed-role or missing evidence (%s)", async (standingValid) => {
    const context = baseContext();
    context.batch!.authorizationType = "STANDING";
    context.batch!.standingValid = standingValid;
    const result = await runGate(context.obligation.id, new FakeRepo(context), new FakeChain());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures).toContain("STANDING_NOT_VALID");
  });
  it("preserves existing human authorization behavior", async () => {
    const context = baseContext();
    context.batch!.authorizationType = "HUMAN";
    context.batch!.standingValid = false;
    const result = await runGate(context.obligation.id, new FakeRepo(context), new FakeChain());
    expect(result.ok).toBe(true);
  });
});
