import "server-only";
import { z } from "zod";
import { parseMasterKey } from "./crypto/cipher";

const masterKey = z.string().refine((v) => {
  try {
    parseMasterKey(v);
    return true;
  } catch {
    return false;
  }
}, "at least 32 random bytes, hex or base64");

// A blank line copied from .env.example means "not set", not "invalid".
const blankIsUnset = <T extends z.ZodType<string>>(inner: T) => z.preprocess((v) => (v === "" ? undefined : v), inner.optional());

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1), // public by design (rule 32): anon has no table rights
  // >= 32 random bytes (hex or base64); a "vN:" prefix sets the version (S41, docs/security.md §2)
  DATA_ENCRYPTION_KEY: masterKey,
  DATA_ENCRYPTION_KEY_PREVIOUS: masterKey.optional(),
  OPENROUTER_API_KEY: z.string().min(1),
  // Model and fallback are config, not code, so they can change freely (ARCHITECTURE 7).
  // Chosen by scripts/model-eval.ts on 2026-10-02 (docs/phases/P3.md decision 5).
  OPENROUTER_MODEL: z.string().min(1).default("google/gemini-2.5-flash-lite"),
  OPENROUTER_FALLBACK_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
  // Waitlist (docs/phases/W.md). WAITLIST_SECRET keys the IP hashes for rate limits (S55): >= 32 random characters.
  WAITLIST_SECRET: z.string().min(32),
  SITE_URL: z.string().url().default("http://localhost:3000"), // canonical URL for SEO (e.g. https://kleeno.orclide.com)
  CONTACT_EMAIL: z.string().email().optional(), // shown on /privacy for deletion requests
  // Invite emails (P3b, S62). Optional: without them the sender copies the invite link.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(), // e.g. "Kleeno <invites@orclide.com>"
  // P4 (S36, S68). Optional so the app boots without them; the receipt and Kleeno Verify paths fail closed when missing.
  RECEIPT_HMAC_SECRET: blankIsUnset(z.string().min(32)), // >= 32 random characters; rotating it voids every receipt link
  X402_SELLER_ADDRESS: blankIsUnset(z.string().regex(/^0x[0-9a-fA-F]{40}$/)), // receive-only platform wallet for Kleeno Verify
  // SITE_MODE and ADMIN_PATH are read in src/server/site.ts and src/proxy.ts (fail closed when missing).
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(`Missing or invalid environment variables: ${names}`);
}

export const env = parsed.data;
