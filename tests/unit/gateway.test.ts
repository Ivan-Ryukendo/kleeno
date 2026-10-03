// S67: limits, fee cap and the burn intent (values must match the documented Gateway types exactly).
import { describe, expect, it } from "vitest";
import { ARC, burnIntentTypedData, checkTopupAmount, depositFor, GATEWAY_MINTER, GATEWAY_WALLET, maxFeeFor, TOPUP_CAP, TOPUP_MIN } from "@/core/gateway";

const approver = "0x1111111111111111111111111111111111111111";
const salt = `0x${"ab".repeat(32)}`;

describe("top-up limits", () => {
  it("accepts the range [1, 100] USDC and nothing outside it", () => {
    expect(checkTopupAmount(TOPUP_MIN)).toBeNull();
    expect(checkTopupAmount(TOPUP_CAP)).toBeNull();
    expect(checkTopupAmount(TOPUP_MIN - 1n)).toMatch(/minimum/);
    expect(checkTopupAmount(TOPUP_CAP + 1n)).toMatch(/maximum/);
  });
  it("deposits the amount plus the worst-case fee, and the fee cap covers gas plus 0.005%", () => {
    expect(maxFeeFor(100_000_000n)).toBe(110_000n);
    expect(maxFeeFor(100_000_000n)).toBeGreaterThan(10_000n + (100_000_000n * 5n) / 100_000n);
    expect(depositFor(5_000_000n)).toBe(5_000_000n + maxFeeFor(5_000_000n));
  });
});

describe("burn intent", () => {
  const input = { source: "BASE-SEPOLIA", depositor: approver, recipient: approver, amount: 5_000_000n, maxFee: 100_500n, salt } as const;
  const t = burnIntentTypedData(input);
  const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
  it("goes from Base Sepolia (domain 6) to Arc testnet (26) for the approver, with the documented contracts", () => {
    expect(t.primaryType).toBe("BurnIntent");
    expect(t.domain).toEqual({ name: "GatewayWallet", version: "1" });
    const s = t.message.spec;
    expect([s.sourceDomain, s.destinationDomain]).toEqual([6, ARC.domain]);
    expect(s.sourceContract).toBe(pad(GATEWAY_WALLET));
    expect(s.destinationContract).toBe(pad(GATEWAY_MINTER));
    expect(s.destinationToken).toBe(pad(ARC.usdc));
    expect([s.sourceDepositor, s.destinationRecipient, s.sourceSigner]).toEqual([pad(approver), pad(approver), pad(approver)]);
    expect(s.destinationCaller).toBe(pad("0x0000000000000000000000000000000000000000"));
    expect([s.value, t.message.maxFee, s.salt, s.hookData]).toEqual(["5000000", "100500", salt, "0x"]);
  });
  it("is identical for the same inputs, so a retry signs the same intent", () => {
    expect(JSON.stringify(burnIntentTypedData(input))).toBe(JSON.stringify(t));
  });
});
