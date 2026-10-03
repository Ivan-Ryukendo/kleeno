// PROTECTED. S67 (Gateway only tops up the company's own approver wallet), S68 (Kleeno Verify is read-only), S36 (public receipt).
// Static structure checks; the behaviour is covered by unit/x402, unit/gateway, db/gateway and db/receipts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
function files(dir: string): string[] {
  if (!existsSync(path.join(root, dir))) return [];
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name).replaceAll("\\", "/");
    if (e.isDirectory()) return files(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // comments may talk about what the code must never do
const src = [...files("src"), ...files("scripts")];
const GATEWAY = "src/server/circle/gateway.ts";

describe("S67 Gateway funding", () => {
  it("only the gateway routes import the gateway module", () => {
    const users = src.filter((f) => f !== GATEWAY && /circle\/gateway["']/.test(read(f)));
    expect(users.sort()).toEqual(["src/app/api/gateway/topup/[id]/route.ts", "src/app/api/gateway/topup/route.ts"]);
  });

  it("gateway code cannot reach pay, openRun, closeRun, the rail, the agent, batches or obligations", () => {
    const text = read(GATEWAY);
    expect(text).not.toMatch(/guard-owner|rails\/|core\/payments|db\/batches|db\/approval|payments\/execute/);
    expect(text).not.toMatch(/"(pay|openRun|closeRun|replaceOperator)\(/);
    expect(text).not.toMatch(/from\("(obligations|payment_batches|payment_attempts|workers|payroll_runs)"\)/);
  });

  it("the only contract calls are approve, deposit and gatewayMint, on the documented contracts", () => {
    const text = read(GATEWAY);
    const sigs = [...text.matchAll(/signature: (?:approve \?|"[^"]+")/g)];
    expect(sigs.length).toBeGreaterThan(0);
    const named = [...text.matchAll(/"((?:approve|deposit|gatewayMint|transfer\w*|pay\w*)\([^"]*\))"/g)].map((m) => m[1]).sort();
    expect(named).toEqual(["approve(address,uint256)", "deposit(address,uint256)", "gatewayMint(bytes,bytes)"]);
    expect(text).toContain("contract: approve ? src.usdc : GATEWAY_WALLET"); // approve USDC for, then deposit into, the Gateway Wallet and nowhere else
    expect(text).toContain("contract: GATEWAY_MINTER");
  });

  it("the request never names a destination: the routes accept only a request ID, an amount and a password", () => {
    for (const f of ["src/app/api/gateway/topup/route.ts", "src/app/api/gateway/topup/[id]/route.ts"]) {
      const text = code(f);
      expect(text, f).not.toMatch(/recipient|depositor|address|wallet|body\.(to|destination)/i);
      expect(text, f).toMatch(/guarded/);
    }
    expect(read("src/app/api/gateway/topup/route.ts")).toMatch(/z\.object\(\{ requestId: uuid, amount: usdc, password: z\.string\(\)\.min\(1\)\.max\(200\) \}\)\.strict\(\)/);
    expect(read("src/app/api/gateway/topup/route.ts")).toContain("requireReauth(");
  });

  it("the recipient is read from the company's approver wallet row, never from input", () => {
    const text = read(GATEWAY);
    expect(text).toContain('.from("company_wallets")');
    expect(text).toMatch(/recipient: approver\.address/);
  });

  it("the burn-intent signature goes through Circle wallets: no private key in Gateway or x402 code", () => {
    for (const f of [GATEWAY, "src/core/gateway/index.ts", ...files("src/server/x402"), ...files("src/core/x402")]) expect(read(f), f).not.toMatch(/privateKey|private_key|privateKeyToAccount|PRIVATE_KEY/);
    expect(read(GATEWAY)).toContain("signTypedData(");
  });
});

describe("S68 Kleeno Verify", () => {
  const writers = /\.(insert|update|upsert|delete)\(/;
  it("the paid route and its modules write nothing but the x402 payment ledger", () => {
    for (const f of files("src/server/x402")) expect(read(f), f).not.toMatch(writers);
    expect(read("src/server/db/receipts.ts")).not.toMatch(writers); // receipts read; the only write is the audit helper
    expect([...read("src/server/db/x402.ts").matchAll(/from\("(\w+)"\)/g)].map((m) => m[1])).toEqual(["x402_payments", "x402_payments"]);
  });

  it("the route is GET only and rate limited", () => {
    const route = read("src/app/api/x402/verify/route.ts");
    expect(route).toMatch(/export const GET/);
    expect(route).not.toMatch(/export const (POST|PUT|PATCH|DELETE)/);
    expect(read("src/server/x402/live.ts")).toMatch(/allow\("x402-verify"/);
  });

  it("the answer is built only from the allow-listed fields (no company, name, worker, gross, deductions)", () => {
    const core = read("src/core/x402/index.ts");
    expect(core).toContain("VERIFY_ANSWER_FIELDS");
    expect(code("src/server/db/receipts.ts")).not.toMatch(/gross|deductions|trace|pseudonym|workers|companies/);
  });

  it("the seller address is configuration, not a key", () => {
    expect(read("src/server/env.ts")).toContain("X402_SELLER_ADDRESS");
  });
});

describe("S36 public receipt", () => {
  const page = "src/app/receipt/[token]/page.tsx";
  it("is outside the app shell, checks the lockdown itself, is noindex, rate limited and reads one signed token", () => {
    const text = read(page);
    expect(text).toMatch(/siteMode\(\) === "waitlist"\) notFound\(\)/);
    expect(text).toMatch(/robots: \{ index: false/);
    expect(text).toMatch(/referrer: "no-referrer"/);
    expect(text).toMatch(/allow\("receipt"/);
    expect(text).toContain("receiptByToken(token)");
    expect(files("src/app/(app)").some((f) => f.includes("receipt"))).toBe(false);
  });

  it("shows no worker, company or pay-breakdown data", () => {
    expect(code(page)).not.toMatch(/pseudonym|worker|gross|deduction/i);
  });

  it("minting is guarded, role-scoped and audited", () => {
    const route = read("src/app/api/receipts/route.ts");
    expect(route).toMatch(/guarded</);
    expect(route).toContain("roles: RECEIPT_ROLES");
    expect(read("src/server/db/receipts.ts")).toMatch(/event: "receipt\.minted"/);
    expect(read("src/server/db/receipts.ts")).toMatch(/status !== "SETTLED"/);
  });

  it("the proxy lets the receipt through only in app mode (waitlist mode allowlist excludes it)", () => {
    const proxy = read("src/proxy.ts");
    const waitlist = proxy.match(/const WAITLIST_PATHS = new Set\(\[([^\]]*)\]/)?.[1] ?? "";
    expect(waitlist).not.toContain("receipt");
    expect(proxy).toContain('path.startsWith("/receipt/")');
  });
});
