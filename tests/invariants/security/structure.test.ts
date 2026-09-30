// PROTECTED. S04 (owner calls isolated), S07 (one gate), S45 (no stray logging). Static structure checks.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");

function files(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name).replaceAll("\\", "/");
    if (e.isDirectory()) return files(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const src = files("src");
const scripts = files("scripts");
const importing = (needle: string, list: string[]) => list.filter((f) => read(f).includes(needle));

describe("S04 owner calls exist only in guard-owner", () => {
  it("guard-owner is imported only by allowed callers", () => {
    const allowed = ["scripts/seed-run.ts"]; // + batch authorization / close handlers from P4
    expect(importing("circle/guard-owner", [...src, ...scripts])).toEqual(allowed);
  });

  it("owner function signatures appear nowhere else in server code or scripts", () => {
    const owner = ["openRun(", "closeRun(", "replaceOperator("];
    const hits = [...src, ...scripts]
      .filter((f) => f !== "src/server/circle/guard-owner.ts" && f !== "src/server/arc/guard-abi.ts")
      .filter((f) => owner.some((s) => read(f).includes(`"${s}`) || read(f).includes(`"${s.slice(0, -1)}(bytes32`)));
    expect(hits).toEqual([]);
  });

  it("the rail encodes only pay(bytes32)", () => {
    const sigs = [...read("src/server/rails/arc-usdc-rail.ts").matchAll(/abiFunctionSignature:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(sigs).toEqual(["pay(bytes32)"]);
  });
});

describe("S07 one gate", () => {
  it("rail.submit is called only by the payment agent", () => {
    const callers = [...src, ...scripts].filter((f) => /\.\bsubmit\(/.test(read(f)));
    expect(callers).toEqual(["src/core/payments/agent.ts"]);
  });

  it("GatePass values are created only in gate.ts", () => {
    const makers = [...src, ...scripts].filter((f) => /as unknown as GatePass/.test(read(f)));
    expect(makers).toEqual(["src/core/payments/gate.ts"]);
  });

  it("the rail is wired only from scripts/ (P1) and asserts the pass", () => {
    expect(importing("rails/arc-usdc-rail", [...src, ...scripts])).toEqual(["scripts/pay-obligation.ts"]);
    expect(read("src/server/rails/arc-usdc-rail.ts")).toContain("assertGatePass(pass)");
  });
});

describe("S45 logging", () => {
  it("only the redacting logger writes to the console in src/", () => {
    const loud = src.filter((f) => f !== "src/server/log.ts" && /console\.(log|error|warn|info)/.test(read(f)));
    expect(loud).toEqual([]);
  });
});
