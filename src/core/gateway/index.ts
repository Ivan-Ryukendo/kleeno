// Gateway top-up (S67, ARCHITECTURE 14.10): moves the company's OWN USDC from a source testnet chain into its OWN approver wallet on Arc.
// It never pays a worker and never touches PayrollGuard. Pure: limits, amounts and the burn-intent typed data. Values below come from
// Circle's Gateway docs (use-gateway skill) and must be used exactly as written, or the signature is invalid.
export const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"; // same on every EVM testnet
export const GATEWAY_MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
export const ARC = { walletChain: "ARC-TESTNET", domain: 26, usdc: "0x3600000000000000000000000000000000000000" } as const;
export const SOURCES = {
  "BASE-SEPOLIA": { walletChain: "BASE-SEPOLIA", domain: 6, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
} as const;
export type SourceChain = keyof typeof SOURCES;

export const TOPUP_MIN = 1_000_000n; // 1 USDC
export const TOPUP_CAP = 100_000_000n; // 100 USDC per request (S67); the demo run stays within this
const MAX_UINT256 = ((1n << 256n) - 1n).toString();

/** Cap on what Gateway may take as fees: 0.10 USDC (gas is about 0.01 on Base) plus 0.01% (the transfer fee is 0.005%). */
export const maxFeeFor = (amount: bigint) => 100_000n + amount / 10_000n;
/** What the source wallet deposits so the Gateway balance covers the transfer and the worst-case fee. Any leftover stays the company's. */
export const depositFor = (amount: bigint) => amount + maxFeeFor(amount);

export function checkTopupAmount(amount: bigint): string | null {
  if (amount < TOPUP_MIN) return "the minimum top-up is 1 USDC";
  if (amount > TOPUP_CAP) return "the maximum top-up per request is 100 USDC";
  return null;
}

const bytes32 = (address: string) => `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

export interface BurnIntentInput {
  source: SourceChain;
  depositor: string; // the company's approver address (the same address on the source chain)
  recipient: string; // the company's approver address on Arc, read from the database
  amount: bigint;
  maxFee: bigint;
  salt: string; // 0x + 32 random bytes, saved before the first use so a retry signs the identical intent
}

/** The EIP-712 BurnIntent, exactly as Circle documents it. Everything is a string so it serializes as is. */
export function burnIntentTypedData(i: BurnIntentInput) {
  const src = SOURCES[i.source];
  const message = {
    maxBlockHeight: MAX_UINT256,
    maxFee: i.maxFee.toString(),
    spec: {
      version: 1,
      sourceDomain: src.domain,
      destinationDomain: ARC.domain,
      sourceContract: bytes32(GATEWAY_WALLET),
      destinationContract: bytes32(GATEWAY_MINTER),
      sourceToken: bytes32(src.usdc),
      destinationToken: bytes32(ARC.usdc),
      sourceDepositor: bytes32(i.depositor),
      destinationRecipient: bytes32(i.recipient),
      sourceSigner: bytes32(i.depositor),
      destinationCaller: bytes32("0x0000000000000000000000000000000000000000"),
      value: i.amount.toString(),
      salt: i.salt,
      hookData: "0x",
    },
  };
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
      ],
      TransferSpec: [
        { name: "version", type: "uint32" },
        { name: "sourceDomain", type: "uint32" },
        { name: "destinationDomain", type: "uint32" },
        { name: "sourceContract", type: "bytes32" },
        { name: "destinationContract", type: "bytes32" },
        { name: "sourceToken", type: "bytes32" },
        { name: "destinationToken", type: "bytes32" },
        { name: "sourceDepositor", type: "bytes32" },
        { name: "destinationRecipient", type: "bytes32" },
        { name: "sourceSigner", type: "bytes32" },
        { name: "destinationCaller", type: "bytes32" },
        { name: "value", type: "uint256" },
        { name: "salt", type: "bytes32" },
        { name: "hookData", type: "bytes" },
      ],
      BurnIntent: [
        { name: "maxBlockHeight", type: "uint256" },
        { name: "maxFee", type: "uint256" },
        { name: "spec", type: "TransferSpec" },
      ],
    },
    domain: { name: "GatewayWallet", version: "1" },
    primaryType: "BurnIntent",
    message,
  };
}
