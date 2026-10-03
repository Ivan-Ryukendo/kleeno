// S27: only a body signed with the key Circle names is accepted. Real ECDSA P-256 keys; the key lookup is injected, so no network.
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyCircleSignature } from "@/server/circle/webhook";

const pair = () => generateKeyPairSync("ec", { namedCurve: "P-256" });
const spkiB64 = (k: ReturnType<typeof pair>) => k.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const signBody = (k: ReturnType<typeof pair>, body: string) => sign("sha256", Buffer.from(body), { key: k.privateKey, dsaEncoding: "der" }).toString("base64");

const body = JSON.stringify({ notificationId: "n1", notificationType: "transactions.outbound", notification: { id: "tx-1" } });

describe("verifyCircleSignature", () => {
  it("accepts the exact body signed by the named key", async () => {
    const k = pair();
    expect(await verifyCircleSignature(body, signBody(k, body), randomUUID(), async () => spkiB64(k))).toBe(true);
  });

  it("rejects a changed body, another key's signature, a garbage signature, and a key ID that is not a UUID", async () => {
    const k = pair();
    const other = pair();
    const id = randomUUID();
    expect(await verifyCircleSignature(body.replace("tx-1", "tx-2"), signBody(k, body), id, async () => spkiB64(k))).toBe(false);
    expect(await verifyCircleSignature(body, signBody(other, body), randomUUID(), async () => spkiB64(k))).toBe(false);
    expect(await verifyCircleSignature(body, "not-a-signature", randomUUID(), async () => spkiB64(k))).toBe(false);
    expect(await verifyCircleSignature(body, signBody(k, body), "../../etc", async () => spkiB64(k))).toBe(false);
  });

  it("fails closed when the key cannot be fetched or is not a public key", async () => {
    const k = pair();
    expect(await verifyCircleSignature(body, signBody(k, body), randomUUID(), async () => Promise.reject(new Error("circle down")))).toBe(false);
    expect(await verifyCircleSignature(body, signBody(k, body), randomUUID(), async () => "AAAA")).toBe(false);
  });

  it("asks Circle for a key ID once, then uses the cache", async () => {
    const k = pair();
    const id = randomUUID();
    let fetches = 0;
    const get = async () => (fetches++, spkiB64(k));
    expect(await verifyCircleSignature(body, signBody(k, body), id, get)).toBe(true);
    expect(await verifyCircleSignature(body, signBody(k, body), id, get)).toBe(true);
    expect(fetches).toBe(1);
  });

  it("caps how many unknown key IDs one instance will look up per minute", async () => {
    const k = pair();
    let fetches = 0;
    const get = async () => (fetches++, spkiB64(k));
    const results = [];
    for (let i = 0; i < 40; i++) results.push(await verifyCircleSignature(body, signBody(k, body), randomUUID(), get));
    expect(fetches).toBeLessThanOrEqual(20);
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(20);
  });
});
