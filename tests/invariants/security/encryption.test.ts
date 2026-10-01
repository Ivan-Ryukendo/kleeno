// PROTECTED. S41 field encryption: round trip, tamper, wrong AAD (row/company/column move), unique IV, key parsing.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fieldAad, open, parseMasterKey, seal } from "@/server/crypto/cipher";

const key = randomBytes(32);
const aad = fieldAad("co-1", "compensations", "payload_enc", "row-1");

describe("S41 field encryption", () => {
  it("round-trips and hides the plaintext", () => {
    const sealed = seal(key, aad, "SECRET-CANARY-1234.56");
    expect(sealed).not.toContain("SECRET-CANARY");
    expect(Buffer.from(sealed.slice(3), "base64").toString("latin1")).not.toContain("CANARY");
    expect(open(key, aad, sealed)).toBe("SECRET-CANARY-1234.56");
  });

  it("uses a fresh IV per write", () => {
    const a = seal(key, aad, "same");
    const b = seal(key, aad, "same");
    expect(a).not.toBe(b);
    expect(Buffer.from(a.slice(3), "base64").subarray(0, 12).equals(Buffer.from(b.slice(3), "base64").subarray(0, 12))).toBe(false);
  });

  it("fails on tampered ciphertext", () => {
    const raw = Buffer.from(seal(key, aad, "x").slice(3), "base64");
    raw[14] ^= 1;
    expect(() => open(key, aad, "e1:" + raw.toString("base64"))).toThrow();
  });

  it("ciphertext cannot move between rows, columns, tables or companies", () => {
    const sealed = seal(key, aad, "x");
    for (const moved of [
      fieldAad("co-1", "compensations", "payload_enc", "row-2"),
      fieldAad("co-1", "compensations", "other_enc", "row-1"),
      fieldAad("co-1", "workers", "payload_enc", "row-1"),
      fieldAad("co-2", "compensations", "payload_enc", "row-1"),
    ]) {
      expect(() => open(key, moved, sealed)).toThrow();
    }
  });

  it("fails with the wrong key and on non-ciphertext", () => {
    expect(() => open(randomBytes(32), aad, seal(key, aad, "x"))).toThrow();
    expect(() => open(key, aad, "plain text")).toThrow();
  });

  it("derives a stable 32-byte key from any long-enough secret; versions; rejects short ones", () => {
    const k = randomBytes(48);
    const a = parseMasterKey(k.toString("base64"));
    expect(a.key).toHaveLength(32);
    expect(a.version).toBe(1);
    expect(parseMasterKey(k.toString("base64")).key.equals(a.key)).toBe(true);
    expect(parseMasterKey(k.toString("hex")).key.equals(a.key)).toBe(true);
    expect(parseMasterKey(`v3:${k.toString("hex")}`).version).toBe(3);
    expect(a.key.equals(k.subarray(0, 32))).toBe(false); // never the raw secret
    expect(() => parseMasterKey("short")).toThrow();
    expect(() => parseMasterKey(randomBytes(16).toString("hex"))).toThrow();
  });
});
