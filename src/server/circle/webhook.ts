import "server-only";
import { createPublicKey, verify, type KeyObject } from "node:crypto";

// Circle signs every webhook (S27): X-Circle-Signature is an ECDSA-SHA256 signature of the raw body, made with the public key
// named by X-Circle-Key-Id (fetched from Circle, then cached). A webhook is only a hint: nothing here changes payroll state.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keys = new Map<string, KeyObject>();

// An unauthenticated caller can name any key ID; cap how often one server instance asks Circle (per minute).
let window = { start: 0, calls: 0 };
const MAX_KEY_FETCHES_PER_MINUTE = 20;
function fetchBudgetLeft() {
  const now = Date.now();
  if (now - window.start > 60_000) window = { start: now, calls: 0 };
  return ++window.calls <= MAX_KEY_FETCHES_PER_MINUTE;
}

/** Base64 DER public key for a key ID, from Circle's notification-key endpoint. */
async function fetchPublicKey(keyId: string): Promise<string> {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error("circle is not configured");
  const res = await fetch(`https://api.circle.com/v2/notifications/publicKey/${keyId}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error("circle public key unavailable");
  const data = ((await res.json()) as { data?: { publicKey?: string; algorithm?: string } }).data;
  if (!data?.publicKey || data.algorithm !== "ECDSA_SHA_256") throw new Error("unexpected circle key");
  return data.publicKey;
}

/** True only for a genuine Circle signature over exactly this body. Any error, unknown key or odd input is false. */
export async function verifyCircleSignature(raw: string, signature: string, keyId: string, getKey: (id: string) => Promise<string> = fetchPublicKey): Promise<boolean> {
  if (!UUID.test(keyId)) return false;
  try {
    let pub = keys.get(keyId);
    if (!pub) {
      if (!fetchBudgetLeft()) return false;
      pub = createPublicKey({ key: Buffer.from(await getKey(keyId), "base64"), format: "der", type: "spki" });
      keys.set(keyId, pub);
    }
    return verify("sha256", Buffer.from(raw, "utf8"), { key: pub, dsaEncoding: "der" }, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
