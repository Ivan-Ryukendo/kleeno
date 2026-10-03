import { createHmac, timingSafeEqual } from "node:crypto";

// Receipt tokens (S36, ARCHITECTURE 14.4): one obligation, HMAC-signed, 30-day expiry. The token carries nothing but the obligation ID and
// the expiry; every value shown on the receipt page is read from the database. Pure: the secret is passed in by the server.
export const RECEIPT_TTL_MS = 30 * 24 * 3600_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sign = (secret: string, body: string) => createHmac("sha256", secret).update(`kleeno-receipt.${body}`).digest("base64url");

export function mintReceiptToken(secret: string, obligationId: string, now = Date.now()): { token: string; expiresAt: Date } {
  const expiresAt = new Date(now + RECEIPT_TTL_MS);
  const body = Buffer.from(JSON.stringify({ o: obligationId, e: Math.floor(expiresAt.getTime() / 1000) })).toString("base64url");
  return { token: `${body}.${sign(secret, body)}`, expiresAt };
}

/** The obligation ID for a genuine, unexpired token; null for anything else (bad shape, bad signature, expired). Constant-time compare. */
export function readReceiptToken(secret: string, token: string, now = Date.now()): string | null {
  if (token.length > 300) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const want = Buffer.from(sign(secret, body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { o, e } = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { o?: unknown; e?: unknown };
    if (typeof o !== "string" || !UUID.test(o) || typeof e !== "number" || e * 1000 <= now) return null;
    return o;
  } catch {
    return null;
  }
}

/** What a receipt (page or paid answer) may show about an obligation. Net amount only: no names, worker IDs, gross, deductions or company. */
export interface ReceiptFacts {
  status: string;
  amount: bigint;
  txHash: string | null;
  network: "ARC-TESTNET";
  /** Kleeno Verify only: the obligation's amount and calculation hash equal the approved calculation line and approval. */
  matchesApproved: boolean;
}
