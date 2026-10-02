import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

// The active company is a signed, httpOnly cookie (S61). The signature only stops casual tampering: the server still checks
// the value against `memberships` on every request, and RLS checks it again from the request header.
export const COMPANY_COOKIE = "kleeno-company";
export const COMPANY_HEADER = "x-kleeno-company";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Its own HKDF key from the master secret, so the encryption key itself never signs anything (the crypto module stays in src/server/db, S41).
const signingKey = () => Buffer.from(hkdfSync("sha256", env.DATA_ENCRYPTION_KEY, "kleeno", "kleeno-company-cookie", 32));
const mac = (companyId: string) => createHmac("sha256", signingKey()).update(`active-company|${companyId}`).digest("base64url");

export const signCompany = (companyId: string) => `${companyId}.${mac(companyId)}`;

/** The company ID in a validly signed cookie, "forged" for any other non-empty value, null when there is none. */
export function readCompany(value: string | undefined): string | "forged" | null {
  if (!value) return null;
  const [id, sig, ...rest] = value.split(".");
  if (rest.length || !id || !sig || !UUID.test(id)) return "forged";
  const want = Buffer.from(mac(id));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id.toLowerCase() : "forged";
}

export const companyCookie = (companyId: string) => ({ name: COMPANY_COOKIE, value: signCompany(companyId), options: { path: "/", maxAge: 60 * 60 * 24 * 30 } });
export const clearCompanyCookie = () => ({ name: COMPANY_COOKIE, value: "", options: { path: "/", maxAge: 0 } });
