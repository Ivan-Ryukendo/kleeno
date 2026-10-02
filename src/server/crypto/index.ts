import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { canonicalString } from "@/core/canonical";
import { db, must } from "@/server/db/client";
import { env } from "@/server/env";
import { decrypt, encrypt, fieldAad, open, parseMasterKey, seal } from "./cipher";

// Envelope encryption (S41): DATA_ENCRYPTION_KEY wraps one random data key per company (company_keys);
// the data key encrypts fields. Called only by src/server/db repositories; core sees plaintext.
function masterKeys() {
  const current = parseMasterKey(env.DATA_ENCRYPTION_KEY);
  const all = new Map([[current.version, current.key]]);
  if (env.DATA_ENCRYPTION_KEY_PREVIOUS) {
    const prev = parseMasterKey(env.DATA_ENCRYPTION_KEY_PREVIOUS);
    all.set(prev.version, prev.key);
  }
  return { current, all };
}

const wrapAad = (companyId: string) => `company-key|${companyId}`;
const cache = new Map<string, Buffer>();

async function createCompanyKey(companyId: string) {
  const { current } = masterKeys();
  const wrapped = encrypt(current.key, wrapAad(companyId), randomBytes(32)).toString("base64");
  // Two racing first writes: the unique company_id wins, both then read the same row.
  await db().from("company_keys").upsert({ company_id: companyId, wrapped_key: wrapped, key_version: current.version }, { onConflict: "company_id", ignoreDuplicates: true });
}

export async function companyKey(companyId: string): Promise<Buffer> {
  const hit = cache.get(companyId);
  if (hit) return hit;
  let row = (await db().from("company_keys").select("wrapped_key, key_version").eq("company_id", companyId).maybeSingle()).data;
  if (!row) {
    await createCompanyKey(companyId);
    row = must(await db().from("company_keys").select("wrapped_key, key_version").eq("company_id", companyId).maybeSingle(), "company key");
  }
  const master = masterKeys().all.get(row.key_version);
  if (!master) throw new Error("data encryption key version unavailable");
  const key = decrypt(master, wrapAad(companyId), Buffer.from(row.wrapped_key, "base64"));
  cache.set(companyId, key);
  return key;
}

export async function sealField(companyId: string, table: string, column: string, rowId: string, plaintext: string) {
  return seal(await companyKey(companyId), fieldAad(companyId, table, column, rowId), plaintext);
}

export async function openField(companyId: string, table: string, column: string, rowId: string, sealed: string) {
  return open(await companyKey(companyId), fieldAad(companyId, table, column, rowId), sealed);
}

/** JSON helpers; bigint travels as a decimal string and callers convert back. */
export const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

export async function sealJson(companyId: string, table: string, column: string, rowId: string, value: unknown) {
  return sealField(companyId, table, column, rowId, toJson(value));
}

export async function openJson<T>(companyId: string, table: string, column: string, rowId: string, sealed: string): Promise<T> {
  return JSON.parse(await openField(companyId, table, column, rowId, sealed)) as T;
}

/** Rotation: re-wrap one company's data key under the current master key (scripts/rotate-data-key.ts). */
export async function rewrapCompanyKey(companyId: string): Promise<boolean> {
  const { current, all } = masterKeys();
  const row = must(await db().from("company_keys").select("wrapped_key, key_version").eq("company_id", companyId).maybeSingle(), "company key");
  if (row.key_version === current.version) return false;
  const old = all.get(row.key_version);
  if (!old) throw new Error("previous data encryption key not provided");
  const data = decrypt(old, wrapAad(companyId), Buffer.from(row.wrapped_key, "base64"));
  const wrapped = encrypt(current.key, wrapAad(companyId), data).toString("base64");
  must(await db().from("company_keys").update({ wrapped_key: wrapped, key_version: current.version }).eq("company_id", companyId).eq("key_version", row.key_version).select("company_id"), "rewrap");
  cache.delete(companyId);
  return true;
}

/** Keyed hash with the company data key: a stable fingerprint (idempotency, provenance) that cannot be brute-forced from small pay values. */
export async function fingerprint(companyId: string, value: unknown): Promise<string> {
  return createHmac("sha256", await companyKey(companyId)).update(`fingerprint|${canonicalString(value)}`).digest("hex");
}
