// Name key file (S42, rule 35): maps real names to W-codes and never leaves the user's computer. It is encrypted in the
// browser with a passphrase (PBKDF2-SHA256, 600,000 iterations -> AES-256-GCM, Web Crypto). Nothing here uploads anything.
export const KDF_ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 12;

export interface NameKey {
  next: number; // the next W-code number to hand out
  names: Record<string, string>; // normalized name -> "W001"
}

export class NameKeyError extends Error {
  constructor(readonly code: "WEAK_PASSPHRASE" | "WRONG_PASSPHRASE" | "BAD_FILE") {
    super(code === "WEAK_PASSPHRASE" ? `The passphrase needs at least ${MIN_PASSPHRASE} characters.` : code === "WRONG_PASSPHRASE" ? "Wrong passphrase, or the file was changed." : "That is not a Kleeno name key file.");
  }
}

export const emptyNameKey = (startAt = 1): NameKey => ({ next: startAt, names: {} });
export const normalizeName = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export const WORKER_CODE = /^W\d{3,}$/;

/** Stable code for a name: the same name always gets the same code; new names take the next number. Mutates `key`. */
export function codeFor(key: NameKey, rawName: string): string | null {
  const name = normalizeName(rawName);
  if (!name) return null;
  return (key.names[name] ??= `W${String(key.next++).padStart(3, "0")}`);
}

type Bytes = Uint8Array<ArrayBuffer>;
const b64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): Bytes => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(passphrase: string, salt: Bytes, iterations: number) {
  if (passphrase.length < MIN_PASSPHRASE) throw new NameKeyError("WEAK_PASSPHRASE");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealNameKey(key: NameKey, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(passphrase, salt, KDF_ITERATIONS), new TextEncoder().encode(JSON.stringify(key)));
  return JSON.stringify({ format: "kleeno-name-key", v: 1, kdf: "PBKDF2-SHA256", iter: KDF_ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) });
}

/** Fails closed: a wrong passphrase or any edit to the file is an error, never an empty key (which would re-use codes). */
export async function openNameKey(file: string, passphrase: string): Promise<NameKey> {
  let f: { format?: string; v?: number; iter?: number; salt?: string; iv?: string; ct?: string };
  try {
    f = JSON.parse(file);
    if (f.format !== "kleeno-name-key" || f.v !== 1 || !f.salt || !f.iv || !f.ct || typeof f.iter !== "number" || f.iter < KDF_ITERATIONS) throw new Error();
  } catch {
    throw new NameKeyError("BAD_FILE");
  }
  const key = await aesKey(passphrase, unb64(f.salt!), f.iter!);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(f.iv!) }, key, unb64(f.ct!));
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as NameKey;
    if (!Number.isInteger(parsed.next) || typeof parsed.names !== "object") throw new Error();
    return parsed;
  } catch {
    throw new NameKeyError("WRONG_PASSPHRASE");
  }
}
