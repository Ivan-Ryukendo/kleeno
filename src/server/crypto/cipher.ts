import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// AES-256-GCM (S41). Fresh 12-byte IV per write; AAD binds ciphertext to its place so it cannot move between rows.
const IV = 12;
const TAG = 16;
const PREFIX = "e1:";

export function encrypt(key: Buffer, aad: string, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  return Buffer.concat([iv, c.update(plaintext), c.final(), c.getAuthTag()]);
}

export function decrypt(key: Buffer, aad: string, blob: Buffer): Buffer {
  if (blob.length < IV + TAG) throw new Error("ciphertext too short");
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(0, IV));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(blob.subarray(blob.length - TAG));
  return Buffer.concat([d.update(blob.subarray(IV, blob.length - TAG)), d.final()]); // throws on tamper or wrong AAD
}

export const seal = (key: Buffer, aad: string, text: string) => PREFIX + encrypt(key, aad, Buffer.from(text, "utf8")).toString("base64");

export function open(key: Buffer, aad: string, sealed: string): string {
  if (!sealed.startsWith(PREFIX)) throw new Error("not an encrypted field");
  return decrypt(key, aad, Buffer.from(sealed.slice(PREFIX.length), "base64")).toString("utf8");
}

/** AAD = company + table + column + row (S41). */
export const fieldAad = (companyId: string, table: string, column: string, rowId: string) => `${companyId}|${table}|${column}|${rowId}`;

/**
 * The secret is >= 32 random bytes as hex or base64; "vN:" prefixes a version (default 1).
 * The AES key is derived with HKDF-SHA256, so any long-enough random secret works and the raw value is never used directly.
 */
export function parseMasterKey(text: string): { version: number; key: Buffer } {
  const m = /^(?:v(\d+):)?(.+)$/.exec(text.trim());
  if (!m) throw new Error("invalid data encryption key");
  const raw = /^([0-9a-fA-F]{2}){32,}$/.test(m[2]) ? Buffer.from(m[2], "hex") : Buffer.from(m[2], "base64");
  if (raw.length < 32) throw new Error("data encryption key must be at least 32 bytes");
  const key = Buffer.from(hkdfSync("sha256", raw, "kleeno", "kleeno-data-encryption-key", 32));
  return { version: m[1] ? Number(m[1]) : 1, key };
}
