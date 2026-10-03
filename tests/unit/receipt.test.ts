// S36: receipt tokens are signed, expire after 30 days, name one obligation and nothing else.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintReceiptToken, readReceiptToken, RECEIPT_TTL_MS } from "@/core/receipt";

const secret = "s".repeat(40);
const id = randomUUID();
const now = Date.UTC(2026, 9, 4);

describe("receipt tokens", () => {
  it("round-trips the obligation ID and expires in 30 days", () => {
    const { token, expiresAt } = mintReceiptToken(secret, id, now);
    expect(expiresAt.getTime() - now).toBe(RECEIPT_TTL_MS);
    expect(readReceiptToken(secret, token, now + 1000)).toBe(id);
    expect(readReceiptToken(secret, token, now + RECEIPT_TTL_MS - 2000)).toBe(id);
    expect(readReceiptToken(secret, token, now + RECEIPT_TTL_MS + 1000)).toBeNull();
  });

  it("carries only the obligation ID and the expiry", () => {
    const body = JSON.parse(Buffer.from(mintReceiptToken(secret, id, now).token.split(".")[0], "base64url").toString());
    expect(Object.keys(body).sort()).toEqual(["e", "o"]);
  });

  it("rejects another secret, a changed body, a changed signature and garbage", () => {
    const { token } = mintReceiptToken(secret, id, now);
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ o: randomUUID(), e: Math.floor(now / 1000) + 99999 })).toString("base64url");
    expect(readReceiptToken("x".repeat(40), token, now)).toBeNull();
    expect(readReceiptToken(secret, `${forged}.${mac}`, now)).toBeNull();
    expect(readReceiptToken(secret, `${body}.${mac.slice(0, -2)}AA`, now)).toBeNull();
    for (const bad of ["", ".", "a.b.c", "x".repeat(400), `${body}`, `.${mac}`]) expect(readReceiptToken(secret, bad, now)).toBeNull();
  });

  it("rejects a correctly signed token whose payload is not a UUID", () => {
    const { token } = mintReceiptToken(secret, "not-a-uuid", now);
    expect(readReceiptToken(secret, token, now)).toBeNull();
  });
});
