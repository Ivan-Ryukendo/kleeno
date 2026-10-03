// PROTECTED. S27: the Circle webhook handler only verifies, dedupes and triggers a re-check. Static structure checks.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const route = read("src/app/api/circle/webhook/route.ts");

describe("S27 webhook handler", () => {
  it("imports no rail, gate, state machine or state setter", () => {
    for (const forbidden of ["rails/", "payments/gate", "payments/agent", "domain/transition", "domain/machines", "circle/guard-owner", "db/store", "db/runs"]) {
      expect(route.includes(forbidden), forbidden).toBe(false);
    }
  });

  it("checks the signature before it parses or acts on the body", () => {
    const verify = route.indexOf("verifyCircleSignature(raw");
    expect(verify).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(route.indexOf("JSON.parse"));
    expect(verify).toBeLessThan(route.indexOf("onCircleNotification("));
  });

  it("limits the body size and never reads an amount, recipient or state from the payload", () => {
    expect(route).toMatch(/MAX_BODY/);
    for (const field of ["amount", "recipient", "state", "status", "txHash"]) expect(route.includes(`notification.${field}`), field).toBe(false);
  });

  it("the handler's only sink is the re-check function, which dedupes on the notification ID", () => {
    expect(route.match(/await on\w+\(/g)).toEqual(["await onCircleNotification("]);
    expect(read("src/server/payments/execute.ts")).toContain('provider: "circle", notification_id');
  });
});
